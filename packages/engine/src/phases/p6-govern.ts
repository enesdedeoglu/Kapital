import type { Sql } from '@kapital/db';
import {
  decidePrice, inputBid, outputThrottle, planInventory, representativeDistance,
  shippingPerUnit, type PriceDecision,
} from '@kapital/economy';
import { asMoney, asQty, qtyFromNumber, TICKS_PER_DAY, type Money } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';
import { loadReferencePrices, type ReferencePrices } from '../reference-prices.js';

interface NpcRow {
  company_id: string; name: string; cash: bigint;
  archetype: string; target_margin: number; price_aggressiveness: number;
  inventory_target_ticks: number; cash_reserve_ratio: number;
  strategy_interval_ticks: number; last_strategy_tick: bigint;
}

interface NpcFacilityRow {
  facility_id: string; company_id: string; city_id: number; inventory_id: string;
  category: string; base_capacity: number; level_multiplier: number;
  free_capacity: bigint; utilization: number;
  recipe_id: number | null; output_product_id: number | null; output_quantity: bigint | null;
}

interface StockRow {
  inventory_id: string; product_id: number; available: bigint; unit_cost: bigint; quality: string;
}

export interface GovernPhaseResult {
  npcs: number;
  pricesSet: number;
  buyOrders: number;
  sellOrders: number;
  retailOffers: number;
  strategicDecisions: number;
  throttled: number;
}

/** Perakendede satılabilen ürünler — NPC perakendecileri bunları stoklar. */
const RETAIL_BUFFER_TICKS = 2;

/**
 * P6 — YÖNETİŞİM. NPC operasyonel kararları.
 *
 * NPC'ler oyunun kurallarını BİLEN ajanlardır, ayrıcalıklı varlıklar değil
 * (ADR-0003): aynı formülleri okur, aynı emir defterinde eşleşir, aynı
 * deftere yazarlar. Ayrıcalıkları yalnızca kararlarının kod tarafından
 * verilmesidir.
 *
 * Amaçları oyuncuları yenmek DEĞİL, piyasaya likidite sağlamaktır (madde 25).
 *
 * ★ Bu turda verdikleri emirler BİR SONRAKİ turun P2 fazında eşleşir. Bu
 * gecikme kasıtlıdır: aynı tur içinde geri besleme döngüsü oluşmasını engeller.
 */
export async function runGovernPhase(sql: Sql, tick: EngineTick): Promise<GovernPhaseResult> {
  const npcCfg = configValue<{ priceBandPerTick: number; emergencyBandPerTick: number; emergencyHealthBelow: number }>(
    tick, 'npc.population',
    { priceBandPerTick: 0.03, emergencyBandPerTick: 0.10, emergencyHealthBelow: 35 },
  );
  const invCfg = configValue<{ minTicks: number; targetTicks: number; maxTicks: number }>(
    tick, 'npc.inventory', { minTicks: 4, targetTicks: 12, maxTicks: 24 },
  );
  const throttleCfg = configValue<{ targetTicks: number; maxStepPerTick: number; floor: number }>(
    tick, 'npc.throttle', { targetTicks: 8, maxStepPerTick: 0.05, floor: 0.10 },
  );

  const npcs = await sql<NpcRow[]>`
    SELECT c.id AS company_id, c.name, c.cash, p.archetype, p.target_margin,
           p.price_aggressiveness, p.inventory_target_ticks, p.cash_reserve_ratio,
           p.strategy_interval_ticks, p.last_strategy_tick
    FROM npc_profiles p
    JOIN companies c ON c.id = p.company_id AND c.kind = 'NPC' AND c.status = 'ACTIVE'`;
  if (npcs.length === 0) {
    return { npcs: 0, pricesSet: 0, buyOrders: 0, sellOrders: 0, retailOffers: 0,
             strategicDecisions: 0, throttled: 0 };
  }

  const references = await loadReferencePrices(sql, tick.seq);
  const health = await loadMarketHealth(sql, tick);
  const facilities = await loadFacilities(sql, tick, npcs.map((n) => n.company_id));
  const stock = await loadStock(sql, facilities.map((f) => f.inventory_id));
  const inputs = await loadRecipeInputs(sql, facilities);
  const openOrders = await loadOpenOrders(sql, npcs.map((n) => n.company_id));
  const retailDemand = await loadRetailProducts(sql);
  const freight = await buildFreightTable(sql, tick);

  const out = { npcs: npcs.length, pricesSet: 0, buyOrders: 0, sellOrders: 0, retailOffers: 0,
                strategicDecisions: 0, throttled: 0 };
  const byCompany = new Map<string, NpcFacilityRow[]>();
  for (const f of facilities) {
    (byCompany.get(f.company_id) ?? byCompany.set(f.company_id, []).get(f.company_id)!).push(f);
  }

  for (const npc of npcs) {
    let budget = npc.cash - BigInt(Math.round(Number(npc.cash) * npc.cash_reserve_ratio));

    for (const facility of byCompany.get(npc.company_id) ?? []) {
      const isRetail = facility.category === 'RETAIL';

      // ---- ÜRETİCİ: girdi al, çıktı sat ----------------------------------
      if (facility.recipe_id !== null && facility.output_product_id !== null) {
        const perTick = facility.base_capacity * facility.level_multiplier;

        for (const input of inputs.get(facility.recipe_id) ?? []) {
          const needPerTick = perTick * Number(input.quantity) / Number(facility.output_quantity ?? 1n);
          const held = stockOf(stock, facility.inventory_id, input.product_id);
          const plan = planInventory({
            onHand: asQty(held.available), consumptionPerTick: needPerTick,
            minTicks: invCfg.minTicks, targetTicks: npc.inventory_target_ticks,
            maxTicks: invCfg.maxTicks,
          });
          if (plan.buyQuantity <= 0n) continue;

          const reference = references.get(input.product_id);
          if (!reference) continue;
          // Acil ihtiyaçta piyasanın biraz üstünü ödemeye razı olur; navlun payı
          // olmadan yalnızca aynı şehirdeki satıcıya erişebilirdi (R20).
          const bid = inputBid({
            reference, urgent: plan.urgent,
            freightAllowance: freight(facility.city_id, input.product_id),
          });
          const placed = await upsertOrder(sql, tick, openOrders, {
            companyId: npc.company_id, facilityId: facility.facility_id,
            cityId: facility.city_id, productId: input.product_id, side: 'BUY',
            quantity: plan.buyQuantity, price: bid, budget,
          });
          if (placed > 0n) { out.buyOrders++; budget -= placed; }
        }

        // Çıktının tamamı satılıktır; üretim zaten her tur devam eder
        const output = stockOf(stock, facility.inventory_id, facility.output_product_id);
        if (output.available > 0n) {
          const decision = priceFor(npc, output.unit_cost, facility.output_product_id, references, health, npcCfg);
          if (decision) {
            await upsertOrder(sql, tick, openOrders, {
              companyId: npc.company_id, facilityId: facility.facility_id,
              cityId: facility.city_id, productId: facility.output_product_id, side: 'SELL',
              quantity: asQty(output.available), price: decision.price, quality: Number(output.quality),
            });
            out.sellOrders++;
            await logDecision(sql, tick, npc.company_id, facility.output_product_id, 'SELL',
              output.unit_cost, decision.price, decision.reason);
          }
        }

        // ---- ÜRETİM KISMA: satılmayan stok birikiyorsa kapasiteyi düşür ----
        // Kapasiteye üreten tesis, malı satılmasa bile her tur işçilik öder ve
        // o para ekonomiden çıkar. Kapsam = kaç turluk üretim satılmadan duruyor.
        const coverage = perTick > 0 ? Number(output.available) / 1000 / perTick : 0;
        const nextUtilization = outputThrottle({
          coverageTicks: coverage,
          targetTicks: throttleCfg.targetTicks,
          previous: facility.utilization,
          maxStep: throttleCfg.maxStepPerTick,
          floor: throttleCfg.floor,
        });
        if (Math.abs(nextUtilization - facility.utilization) > 1e-9) {
          await sql`UPDATE facilities SET utilization = ${nextUtilization}
                     WHERE id = ${facility.facility_id}::uuid`;
          out.throttled++;
        }
      }

      // ---- PERAKENDECİ / TÜCCAR: nihai ürün al, rafa koy -----------------
      if (isRetail) {
        for (const product of retailDemand) {
          const held = stockOf(stock, facility.inventory_id, product.id);
          const salesPerTick = product.base_demand * 0.35; // şehir payı tahmini

          // Rafa fiyat koy
          if (held.available > 0n) {
            const decision = priceFor(npc, held.unit_cost, product.id, references, health, npcCfg, facility.facility_id);
            if (decision) {
              await sql`
                INSERT INTO retail_offers (facility_id, product_id, selling_price, enabled)
                VALUES (${facility.facility_id}::uuid, ${product.id}, ${decision.price}, TRUE)
                ON CONFLICT (facility_id, product_id)
                DO UPDATE SET selling_price = EXCLUDED.selling_price, enabled = TRUE,
                              updated_at = NOW()`;
              out.retailOffers++;
              out.pricesSet++;
            }
          }

          // Stok tamamla
          const plan = planInventory({
            onHand: asQty(held.available), consumptionPerTick: salesPerTick,
            minTicks: RETAIL_BUFFER_TICKS, targetTicks: Math.min(npc.inventory_target_ticks, 10),
            maxTicks: invCfg.maxTicks,
          });
          if (plan.buyQuantity <= 0n) continue;
          const reference = references.get(product.id);
          if (!reference) continue;

          const bid = inputBid({
            reference, urgent: plan.urgent,
            freightAllowance: freight(facility.city_id, product.id),
            normalPremium: 0.01, urgentPremium: 0.08,
          });
          const placed = await upsertOrder(sql, tick, openOrders, {
            companyId: npc.company_id, facilityId: facility.facility_id,
            cityId: facility.city_id, productId: product.id, side: 'BUY',
            quantity: plan.buyQuantity, price: bid, budget,
          });
          if (placed > 0n) { out.buyOrders++; budget -= placed; }
        }
      }
    }

    // ---- STRATEJİK KARAR: her turda değil, aralıkla ---------------------
    if (tick.seq - npc.last_strategy_tick >= BigInt(npc.strategy_interval_ticks)) {
      await sql`UPDATE npc_profiles SET last_strategy_tick = ${tick.seq}
                 WHERE company_id = ${npc.company_id}::uuid`;
      out.strategicDecisions++;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */

function priceFor(
  npc: NpcRow, unitCost: bigint, productId: number,
  references: ReferencePrices, health: Map<number, number>,
  cfg: { priceBandPerTick: number; emergencyBandPerTick: number; emergencyHealthBelow: number },
  facilityId?: string,
): PriceDecision | null {
  const reference = references.get(productId);
  if (!reference) return null;
  return decidePrice({
    unitCost: asMoney(unitCost > 0n ? unitCost : reference / 2n),
    reference,
    currentPrice: null, // bant, upsertOrder içinde önceki fiyata göre uygulanır
    targetMargin: npc.target_margin,
    priceAggressiveness: npc.price_aggressiveness,
    marketHealth: health.get(productId) ?? 100,
    normalBand: cfg.priceBandPerTick,
    emergencyBand: cfg.emergencyBandPerTick,
    emergencyHealthBelow: cfg.emergencyHealthBelow,
  });
}

interface OrderKey { facilityId: string; productId: number; side: 'BUY' | 'SELL' }
type OpenOrderMap = Map<string, { id: bigint; price: bigint }>;
const keyOf = (k: OrderKey) => `${k.facilityId}:${k.productId}:${k.side}`;

/**
 * NPC'nin duran emrini tazeler; yoksa açar. Her tur yeni emir açmak yerine
 * mevcut emri güncellemek defter şişmesini engeller.
 *
 * ★ Fiyat bandı BURADA uygulanır: NPC'nin önceki emri varsa yeni fiyat
 * ±%3 (krizde ±%10) ile sınırlanır (madde 25, R4).
 */
async function upsertOrder(
  sql: Sql, tick: EngineTick, open: OpenOrderMap,
  input: {
    companyId: string; facilityId: string; cityId: number; productId: number;
    side: 'BUY' | 'SELL'; quantity: bigint; price: Money; quality?: number; budget?: bigint;
  },
): Promise<bigint> {
  let quantity = input.quantity;

  // Alışta bütçe sınırı: nakdinin ötesinde emir vermez
  if (input.side === 'BUY' && input.budget !== undefined) {
    const affordable = (input.budget * 1000n) / (input.price as bigint);
    if (affordable <= 0n) return 0n;
    if (quantity > affordable) quantity = affordable;
  }
  if (quantity <= 0n) return 0n;

  const key = keyOf(input);
  const existing = open.get(key);

  let price = input.price as bigint;
  if (existing) {
    // ±%3 bant: NPC fiyatı bir turda sıçratmaz
    const upper = (existing.price * 103n) / 100n;
    const lower = (existing.price * 97n) / 100n;
    if (price > upper) price = upper;
    else if (price < lower) price = lower;

    await sql`
      UPDATE market_orders
         SET quantity = ${quantity}, remaining_quantity = ${quantity},
             price_per_unit = ${price}, status = 'OPEN',
             expires_at_tick = ${tick.seq + BigInt(TICKS_PER_DAY)}
       WHERE id = ${existing.id}`;
    open.set(key, { id: existing.id, price });
  } else {
    const [row] = await sql<{ id: bigint }[]>`
      INSERT INTO market_orders (company_id, facility_id, product_id, city_id, side,
                                 quantity, remaining_quantity, price_per_unit, quality,
                                 expires_at_tick)
      VALUES (${input.companyId}::uuid, ${input.facilityId}::uuid, ${input.productId},
              ${input.cityId}, ${input.side}::order_side, ${quantity}, ${quantity},
              ${price}, ${(input.quality ?? 70).toFixed(3)}, ${tick.seq + BigInt(TICKS_PER_DAY)})
      RETURNING id`;
    open.set(key, { id: row!.id, price });
  }

  return input.side === 'BUY' ? (price * quantity) / 1000n : 0n;
}

async function logDecision(
  sql: Sql, tick: EngineTick, companyId: string, productId: number,
  kind: string, oldValue: bigint, newValue: Money, reason: string,
): Promise<void> {
  await sql`
    INSERT INTO npc_decisions (tick_id, company_id, product_id, kind, old_value, new_value, reason)
    VALUES (${tick.seq}, ${companyId}::uuid, ${productId}, ${kind}, ${oldValue}, ${newValue}, ${reason})
    ON CONFLICT (tick_id, company_id, product_id, kind) DO NOTHING`;
}

function stockOf(rows: StockRow[], inventoryId: string, productId: number) {
  const found = rows.find((r) => r.inventory_id === inventoryId && r.product_id === productId);
  return found ?? { available: 0n, unit_cost: 0n, quality: '70' };
}

async function loadFacilities(sql: Sql, tick: EngineTick, companyIds: string[]): Promise<NpcFacilityRow[]> {
  return sql<NpcFacilityRow[]>`
    SELECT f.id AS facility_id, f.company_id, f.city_id, i.id AS inventory_id,
           ft.category::text AS category, ft.base_capacity,
           COALESCE(lc.capacity_multiplier, 1) AS level_multiplier,
           (i.capacity - i.used_capacity)::bigint AS free_capacity, f.utilization,
           r.id AS recipe_id, r.output_product_id, r.output_quantity
    FROM facilities f
    JOIN facility_types ft ON ft.id = f.facility_type_id
    JOIN inventories i ON i.facility_id = f.id
    LEFT JOIN facility_level_curve lc ON lc.level = f.level
    LEFT JOIN production_recipes r ON r.id = f.active_recipe_id
    WHERE f.company_id = ANY(${companyIds}::uuid[])
      AND f.closed_at IS NULL AND f.construction_complete_at_tick <= ${tick.seq}`;
}

async function loadStock(sql: Sql, inventoryIds: string[]): Promise<StockRow[]> {
  if (inventoryIds.length === 0) return [];
  return sql<StockRow[]>`
    SELECT b.inventory_id, b.product_id,
           SUM(b.quantity - b.reserved_quantity)::bigint AS available,
           (SUM(b.quantity * b.unit_cost) / NULLIF(SUM(b.quantity), 0))::bigint AS unit_cost,
           (SUM(b.quantity * b.quality) / NULLIF(SUM(b.quantity), 0))::text AS quality
    FROM inventory_batches b
    WHERE b.inventory_id = ANY(${inventoryIds}::uuid[])
    GROUP BY b.inventory_id, b.product_id
    HAVING SUM(b.quantity - b.reserved_quantity) > 0`;
}

async function loadRecipeInputs(
  sql: Sql, facilities: NpcFacilityRow[],
): Promise<Map<number, { product_id: number; quantity: bigint }[]>> {
  const recipeIds = [...new Set(facilities.map((f) => f.recipe_id).filter((r): r is number => r !== null))];
  const map = new Map<number, { product_id: number; quantity: bigint }[]>();
  if (recipeIds.length === 0) return map;
  const rows = await sql<{ recipe_id: number; product_id: number; quantity: bigint }[]>`
    SELECT recipe_id, product_id, quantity FROM recipe_inputs
    WHERE recipe_id = ANY(${recipeIds.map(String)}::int[])`;
  for (const row of rows) {
    (map.get(row.recipe_id) ?? map.set(row.recipe_id, []).get(row.recipe_id)!).push(row);
  }
  return map;
}

async function loadOpenOrders(sql: Sql, companyIds: string[]): Promise<OpenOrderMap> {
  const rows = await sql<{ id: bigint; facility_id: string; product_id: number; side: string; price_per_unit: bigint }[]>`
    SELECT id, facility_id, product_id, side::text, price_per_unit FROM market_orders
    WHERE company_id = ANY(${companyIds}::uuid[]) AND status IN ('OPEN','PARTIAL')
      AND facility_id IS NOT NULL`;
  const map: OpenOrderMap = new Map();
  for (const r of rows) {
    map.set(`${r.facility_id}:${r.product_id}:${r.side}`, { id: r.id, price: r.price_per_unit });
  }
  return map;
}

/**
 * Şehir × ürün için birim başına navlun payı — R20.
 *
 * NPC teklifini verirken hangi satıcıyla eşleşeceğini bilmez, bu yüzden
 * şehrinin diğer şehirlere olan MEDYAN mesafesini kullanır. Beş şehir için
 * tabloyu bir kerede kurmak, tur başına iki küçük sorgu demektir.
 */
async function buildFreightTable(
  sql: Sql, tick: EngineTick,
): Promise<(cityId: number, productId: number) => Money> {
  const baseRate = asMoney(
    BigInt(configValue<{ baseRatePerKgDistance: string }>(
      tick, 'economy.shipping', { baseRatePerKgDistance: '3500' },
    ).baseRatePerKgDistance),
  );

  const distanceRows = await sql<{ origin_city_id: number; distance_index: number }[]>`
    SELECT origin_city_id, distance_index FROM city_distances`;
  const perCity = new Map<number, number[]>();
  for (const row of distanceRows) {
    (perCity.get(row.origin_city_id) ?? perCity.set(row.origin_city_id, []).get(row.origin_city_id)!)
      .push(Number(row.distance_index));
  }
  const median = new Map<number, number>();
  for (const [cityId, list] of perCity) median.set(cityId, representativeDistance(list));

  const productRows = await sql<{ id: number; weight_per_unit: number }[]>`
    SELECT id, weight_per_unit FROM products`;
  const weight = new Map<number, number>(productRows.map((r) => [r.id, Number(r.weight_per_unit)]));

  const cache = new Map<string, Money>();
  return (cityId, productId) => {
    const key = `${cityId}:${productId}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = shippingPerUnit({
      weightPerUnit: weight.get(productId) ?? 1,
      distanceIndex: median.get(cityId) ?? 0,
      baseRate,
      logisticsModifier: 1,
    });
    cache.set(key, value);
    return value;
  };
}

async function loadRetailProducts(sql: Sql): Promise<{ id: number; base_demand: number }[]> {
  return sql<{ id: number; base_demand: number }[]>`
    SELECT id, base_demand FROM products
    WHERE is_active AND is_retail_product AND base_demand > 0 ORDER BY id`;
}

async function loadMarketHealth(sql: Sql, tick: EngineTick): Promise<Map<number, number>> {
  const rows = await sql<{ product_id: number; score: string }[]>`
    SELECT product_id, score::text FROM market_health
    WHERE tick_id = (SELECT MAX(tick_id) FROM market_health WHERE tick_id < ${tick.seq})
      AND city_id = 0`.catch(() => [] as { product_id: number; score: string }[]);
  return new Map(rows.map((r) => [r.product_id, Number(r.score)]));
}
