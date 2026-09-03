/**
 * Oyuncu davranışının yürütülmesi.
 *
 * ★ Yazma eylemleri GERÇEK servislerden geçer (`@kapital/api/services`):
 * doğrulama, seviye kilidi, nakit kontrolü, defter kaydı — hepsi aynı.
 * Simülasyon yalnızca KARARI verir, kuralı değil.
 *
 * Okuma tarafı toplu yapılır: 1000 oyuncunun her biri için servis sorgusu
 * atmak turu dakikalara çıkarırdı. Kararın girdisi tek sorguda toplanır,
 * eylem tek tek servisten geçer.
 */
import { FacilityService, LoanService, OrderService, RetailService } from '@kapital/api/services';
import type { Sql } from '@kapital/db';
import { representativeDistance, shippingPerUnit } from '@kapital/economy';
import { asMoney, type Money } from '@kapital/shared';
import { canInvest, restockBid, retailPrice, tradeAsk, tradeBid } from './profiles.js';
import type { SimPlayer } from './world.js';

export interface PlayerState {
  company_id: string;
  cash: bigint;
  level: number;
  debt: bigint;
  /** Son 24 turun net kârı — yatırım kapısı buna bakar. */
  recent_profit: bigint;
}

export interface FacilityState {
  company_id: string;
  facility_id: string;
  city_id: number;
  city_code: string;
  category: string;
  type_code: string;
  inventory_id: string;
  recipe_id: number | null;
  output_product_id: number | null;
  output_code: string | null;
  base_capacity: number;
  free_capacity: bigint;
}

export interface StockState {
  inventory_id: string;
  product_id: number;
  product_code: string;
  available: bigint;
  unit_cost: bigint;
}

export interface ActionCounters {
  retailPrices: number;
  buyOrders: number;
  sellOrders: number;
  builds: number;
  recipes: number;
  loans: number;
  errors: number;
  /** Reddedilme nedenleri — yutulan hata ölçülemez, ölçülemeyen ayarlanamaz. */
  errorsByCode: Map<string, number>;
}

export interface DecisionContext {
  readonly references: ReadonlyMap<number, bigint>;
  readonly retailProducts: { id: number; code: string }[];
  readonly recipeInputs: Map<number, { product_id: number; code: string; quantity: bigint }[]>;
  readonly buildable: { code: string; category: string; cost: bigint; unlock: number }[];
  /** Tesis tipi kodu → üretebileceği ürün kodu. Reçete ataması için. */
  readonly recipeByFacilityType: Map<string, string>;
  /** (şehir, ürün) → birim başına tipik navlun. Teklif tavanı buna göre kurulur. */
  readonly freight: (cityId: number, productId: number) => Money;
  /** Ürün → rakiplerin ortalama raf fiyatı. Fiyat konumlanması buna göre. */
  readonly marketPrices: ReadonlyMap<number, bigint>;
}

/** Karar girdileri — tek turda tek sorgu seti. */
export async function loadDecisionContext(
  sql: Sql, references: ReadonlyMap<number, bigint>,
) {
  const retailProducts = await sql<{ id: number; code: string }[]>`
    SELECT id, code FROM products WHERE is_retail_product AND is_active ORDER BY id`;
  const inputRows = await sql<
    { recipe_id: number; product_id: number; code: string; quantity: bigint }[]
  >`SELECT ri.recipe_id, ri.product_id, p.code, ri.quantity
      FROM recipe_inputs ri JOIN products p ON p.id = ri.product_id`;
  const recipeInputs = new Map<number, { product_id: number; code: string; quantity: bigint }[]>();
  for (const row of inputRows) {
    const list = recipeInputs.get(row.recipe_id) ?? [];
    list.push(row);
    recipeInputs.set(row.recipe_id, list);
  }
  const buildable = await sql<{ code: string; category: string; cost: bigint; unlock: number }[]>`
    SELECT code, category::text, base_cost AS cost, unlock_level AS unlock
      FROM facility_types WHERE is_active ORDER BY base_cost`;
  const recipeRows = await sql<{ facility_code: string; product_code: string }[]>`
    SELECT ft.code AS facility_code, p.code AS product_code
      FROM production_recipes r
      JOIN facility_types ft ON ft.id = r.facility_type_id
      JOIN products p ON p.id = r.output_product_id
     WHERE r.is_active`;
  const recipeByFacilityType = new Map(
    recipeRows.map((r) => [r.facility_code, r.product_code]),
  );
  const freight = await buildFreightTable(sql);
  // Rakiplerin raf fiyatı: oyuncu piyasaya göre konumlanır, boşluğa değil.
  const shelfRows = await sql<{ product_id: number; price: bigint }[]>`
    SELECT product_id, AVG(selling_price)::bigint AS price
      FROM retail_offers WHERE enabled GROUP BY 1`;
  const marketPrices = new Map(shelfRows.map((r) => [r.product_id, r.price]));
  return {
    references, retailProducts, recipeInputs, buildable, recipeByFacilityType,
    freight, marketPrices,
  } satisfies DecisionContext;
}

/**
 * Şehir × ürün navlun payı — NPC tarafındaki (`p6-govern`) ile aynı kural.
 * Alıcı hangi satıcıyla eşleşeceğini bilmez, şehrinin MEDYAN mesafesini
 * bütçeler.
 */
async function buildFreightTable(sql: Sql) {
  const [cfg] = await sql<{ value: { baseRatePerKgDistance: string } }[]>`
    SELECT value FROM game_configs WHERE key = 'economy.shipping'`;
  const baseRate = asMoney(BigInt(cfg?.value?.baseRatePerKgDistance ?? '3500'));

  const distances = await sql<{ origin_city_id: number; distance_index: number }[]>`
    SELECT origin_city_id, distance_index FROM city_distances`;
  const perCity = new Map<number, number[]>();
  for (const row of distances) {
    const list = perCity.get(row.origin_city_id) ?? [];
    list.push(Number(row.distance_index));
    perCity.set(row.origin_city_id, list);
  }
  const median = new Map<number, number>();
  for (const [cityId, list] of perCity) median.set(cityId, representativeDistance(list));

  const products = await sql<{ id: number; weight_per_unit: number }[]>`
    SELECT id, weight_per_unit FROM products`;
  const weight = new Map(products.map((p) => [p.id, Number(p.weight_per_unit)]));

  const cache = new Map<string, Money>();
  return (cityId: number, productId: number): Money => {
    const key = `${cityId}:${productId}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = shippingPerUnit({
      weightPerUnit: weight.get(productId) ?? 1,
      distanceIndex: median.get(cityId) ?? 0,
      baseRate, logisticsModifier: 1,
    });
    cache.set(key, value);
    return value;
  };
}

export async function loadPlayerStates(sql: Sql, companyIds: string[]) {
  if (companyIds.length === 0) return { players: [], facilities: [], stock: [] };
  const players = await sql<PlayerState[]>`
    SELECT c.id AS company_id, c.cash, c.level,
           COALESCE((SELECT SUM(remaining_balance) FROM loans l
                      WHERE l.company_id = c.id AND l.status = 'ACTIVE'), 0)::bigint AS debt,
           COALESCE((SELECT SUM(cf.net_profit) FROM company_financials cf
                      WHERE cf.company_id = c.id
                        AND cf.tick_id > (SELECT COALESCE(MAX(seq), 0) - 24 FROM economic_ticks)
                    ), 0)::bigint AS recent_profit
      FROM companies c WHERE c.id = ANY(${companyIds}::uuid[])`;
  const facilities = await sql<FacilityState[]>`
    SELECT f.company_id, f.id AS facility_id, f.city_id, ci.code AS city_code,
           ft.category::text AS category, ft.code AS type_code, i.id AS inventory_id,
           ft.base_capacity, (i.capacity - i.used_capacity)::bigint AS free_capacity,
           r.id AS recipe_id, r.output_product_id, p.code AS output_code
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN cities ci ON ci.id = f.city_id
      JOIN inventories i ON i.facility_id = f.id
      LEFT JOIN production_recipes r ON r.id = f.active_recipe_id
      LEFT JOIN products p ON p.id = r.output_product_id
     WHERE f.company_id = ANY(${companyIds}::uuid[]) AND f.closed_at IS NULL`;
  const stock = await sql<StockState[]>`
    SELECT b.inventory_id, b.product_id, p.code AS product_code,
           SUM(b.quantity - b.reserved_quantity)::bigint AS available,
           (SUM(b.quantity * b.unit_cost) / NULLIF(SUM(b.quantity), 0))::bigint AS unit_cost
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      JOIN inventories i ON i.id = b.inventory_id
      JOIN facilities f ON f.id = i.facility_id
     WHERE f.company_id = ANY(${companyIds}::uuid[])
     GROUP BY 1, 2, 3
    HAVING SUM(b.quantity - b.reserved_quantity) > 0`;
  return { players, facilities, stock };
}

interface Services {
  facilities: FacilityService;
  orders: OrderService;
  retail: RetailService;
  loans: LoanService;
}

export function makeServices(sql: Sql): Services {
  return {
    facilities: new FacilityService(sql),
    orders: new OrderService(sql),
    retail: new RetailService(sql),
    loans: new LoanService(sql),
  };
}

/**
 * Bir oyuncunun bir turdaki tüm eylemleri.
 *
 * Servisler hata fırlatabilir (nakit yetmez, seviye kilidi, stok yok). Bunlar
 * BEKLENEN sonuçlardır — gerçek oyuncu da aynı duvara çarpar. Sayılır ve
 * geçilir; simülasyonu durdurmazlar.
 */
export async function actPlayer(
  services: Services, player: SimPlayer, ctx: DecisionContext,
  state: PlayerState, facilities: FacilityState[], stockByInventory: Map<string, StockState[]>,
  counters: ActionCounters,
): Promise<void> {
  const { profile } = player;

  for (const facility of facilities) {
    const stock = stockByInventory.get(facility.inventory_id) ?? [];

    // ---- PERAKENDE: raftaki mala fiyat koy --------------------------------
    if (facility.category === 'RETAIL') {
      const prices = stock
        .filter((s) => ctx.retailProducts.some((p) => p.id === s.product_id))
        .map((s) => ({
          productCode: s.product_code,
          sellingPrice: toNumber(retailPrice(
            profile, asMoney(s.unit_cost),
            asMoney(ctx.references.get(s.product_id) ?? s.unit_cost),
            asMoney(ctx.marketPrices.get(s.product_id) ?? 0n),
          )),
          enabled: true,
        }));
      if (prices.length > 0) {
        await attempt(counters, () => services.retail.setPrices(player.userId, facility.facility_id, { prices }));
        counters.retailPrices += prices.length;
      }

      // Stok tamamla: rafı boşalan ürün için alış emri
      for (const product of ctx.retailProducts) {
        const held = stock.find((s) => s.product_id === product.id);
        const reference = ctx.references.get(product.id);
        if (!reference) continue;
        const target = BigInt(profile.inventoryTargetTicks) * 40n * 1000n; // ~40 birim/tur hedef
        const onHand = held?.available ?? 0n;
        if (onHand >= target / 2n) continue;
        const want = target - onHand;
        if (want <= 0n || facility.free_capacity < want) continue;
        const bid = restockBid(profile, asMoney(reference), ctx.freight(facility.city_id, product.id));
        if (!affordable(state, bid, want)) continue;
        await attempt(counters, () => services.orders.place(player.userId, {
          side: 'BUY', facilityId: facility.facility_id, productCode: product.code,
          quantity: toQtyNumber(want), pricePerUnit: toNumber(bid),
        }));
        counters.buyOrders++;
      }
      continue;
    }

    // ---- ÜRETİM: girdi al, çıktı sat --------------------------------------
    if (facility.recipe_id !== null && facility.output_product_id !== null) {
      for (const input of ctx.recipeInputs.get(facility.recipe_id) ?? []) {
        const held = stock.find((s) => s.product_id === input.product_id);
        const reference = ctx.references.get(input.product_id);
        if (!reference) continue;
        const need = BigInt(Math.round(facility.base_capacity * profile.inventoryTargetTicks)) * 1000n;
        const onHand = held?.available ?? 0n;
        if (onHand >= need / 2n) continue;
        const want = need - onHand;
        if (facility.free_capacity < want) continue;
        // Girdi alışında navlun payı: teklif nakliye dahil tavandır (R20).
        const bid = restockBid(profile, asMoney(reference), ctx.freight(facility.city_id, input.product_id));
        if (!affordable(state, bid, want)) continue;
        await attempt(counters, () => services.orders.place(player.userId, {
          side: 'BUY', facilityId: facility.facility_id, productCode: input.code,
          quantity: toQtyNumber(want), pricePerUnit: toNumber(bid),
        }));
        counters.buyOrders++;
      }

      const output = stock.find((s) => s.product_id === facility.output_product_id);
      if (output && output.available > 0n && facility.output_code) {
        const reference = ctx.references.get(facility.output_product_id) ?? output.unit_cost;
        const ask = tradeAsk(profile, asMoney(output.unit_cost), asMoney(reference));
        await attempt(counters, () => services.orders.place(player.userId, {
          side: 'SELL', facilityId: facility.facility_id, productCode: facility.output_code!,
          quantity: toQtyNumber(output.available), pricePerUnit: toNumber(ask),
        }));
        counters.sellOrders++;
      }
    }
  }

  // ---- TÜCCAR / SPEKÜLATÖR: üretmeden al-sat -----------------------------
  if (profile.trades && facilities.length > 0) {
    const base = facilities[0]!;
    const stock = stockByInventory.get(base.inventory_id) ?? [];
    for (const product of ctx.retailProducts) {
      const reference = ctx.references.get(product.id);
      if (!reference) continue;
      const held = stock.find((s) => s.product_id === product.id);
      if (held && held.available > 0n) {
        // Elde mal var: kâr marjıyla satışa çıkar
        const ask = tradeAsk(profile, asMoney(held.unit_cost), asMoney(reference));
        await attempt(counters, () => services.orders.place(player.userId, {
          side: 'SELL', facilityId: base.facility_id, productCode: product.code,
          quantity: toQtyNumber(held.available), pricePerUnit: toNumber(ask),
        }));
        counters.sellOrders++;
      } else {
        const bid = tradeBid(profile, asMoney(reference));
        const want = 200n * 1000n;
        if (base.free_capacity < want || !affordable(state, bid, want)) continue;
        await attempt(counters, () => services.orders.place(player.userId, {
          side: 'BUY', facilityId: base.facility_id, productCode: product.code,
          quantity: toQtyNumber(want), pricePerUnit: toNumber(bid),
        }));
        counters.buyOrders++;
      }
    }
  }

  // ---- YATIRIM ------------------------------------------------------------
  const wanted = ctx.buildable.filter((b) =>
    b.unlock <= state.level &&
    (profile.builds === 'BOTH'
      || (profile.builds === 'RETAIL' && b.category === 'RETAIL')
      || (profile.builds === 'PRODUCTION' && b.category !== 'RETAIL' && b.category !== 'LOGISTICS')),
  );
  if (wanted.length > 0) {
    const pick = wanted[Math.floor(player.rng() * wanted.length)]!;
    const stocked = facilities.filter(
      (f) => (stockByInventory.get(f.inventory_id) ?? []).length > 0,
    ).length;
    if (canInvest(profile, {
      cash: asMoney(state.cash), cost: asMoney(pick.cost), roll: player.rng(),
      recentProfit: asMoney(state.recent_profit), owned: facilities.length,
      stockedRatio: facilities.length > 0 ? stocked / facilities.length : 0,
    })) {
      const built = await attempt(counters, () => services.facilities.build(player.userId, {
        facilityTypeCode: pick.code, cityCode: player.cityCode,
      }));
      if (built) {
        counters.builds++;
        // ★ Reçete atanmazsa tesis hiçbir şey üretmez. İlk koşuda oyuncular
        //   29 tesis kurup NPC payını %100'de bıraktı: hepsi boş duruyordu.
        const output = ctx.recipeByFacilityType.get(pick.code);
        if (output) {
          const ok = await attempt(counters, () => services.facilities.setRecipe(
            player.userId, (built as { id: string }).id, { outputProductCode: output, enabled: true },
          ));
          if (ok) counters.recipes++;
        }
      }
    }
  }

  // ---- KREDİ: nakit dibe vurduysa ve iştah varsa --------------------------
  if (profile.creditAppetite > 0 && state.debt === 0n
      && state.cash < 20_000n * 10_000n && player.rng() < profile.creditAppetite / 8) {
    const taken = await attempt(counters, () => services.loans.take(player.userId, {
      amount: 50_000, termTicks: 2688,
    }));
    if (taken) counters.loans++;
  }
}

/* ------------------------------------------------------------------ */

/**
 * Servis hataları beklenen sonuçtur: gerçek oyuncu da aynı duvara çarpar
 * (nakit yetmez, seviye kilidi, stok yok). Ama SAYILMALIdır — yutulan hata
 * ölçülemez, ölçülemeyen davranış da ayarlanamaz.
 */
async function attempt<T>(counters: ActionCounters, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    counters.errors++;
    const code = (error as { code?: string }).code
      ?? (error as { name?: string }).name
      ?? 'UNKNOWN';
    counters.errorsByCode.set(code, (counters.errorsByCode.get(code) ?? 0) + 1);
    return null;
  }
}

const toNumber = (value: Money | bigint) => Number(value) / 10_000;
const toQtyNumber = (value: bigint) => Number(value) / 1_000;

/** Nakit yetiyor mu — servise gitmeden önce ucuz ön eleme. */
function affordable(state: PlayerState, price: Money, quantity: bigint): boolean {
  const cost = (price * quantity) / 1000n;
  return state.cash > cost * 2n;
}
