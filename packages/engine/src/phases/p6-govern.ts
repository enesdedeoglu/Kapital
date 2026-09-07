import { transfer, type Sql } from '@kapital/db';
import {
  clearanceFactor, decidePrice, inputBid, investmentScore, leverMultiplier, outputThrottle,
  priceTrendScore,
  shouldDivest,
  strategicNeed,
  PRICE_MARKUP_BAND,
  planInventory, representativeDistance, shippingPerUnit, softFloor,
  type DirectiveLever, type PriceDecision,
} from '@kapital/economy';
import { asMoney, asQty, TICKS_PER_DAY, type Money } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';
import { loadReferencePrices, type ReferencePrices } from '../reference-prices.js';
import { runDirector, type DirectorResult } from './director.js';
import { runStandingOrders, type StandingOrderResult } from './standing-orders.js';

interface NpcRow {
  company_id: string; name: string; cash: bigint;
  archetype: string; target_margin: number; price_aggressiveness: number;
  inventory_target_ticks: number; cash_reserve_ratio: number;
  strategy_interval_ticks: number; last_strategy_tick: bigint;
  investment_aggressiveness: number; home_city_id: number;
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
  /** Kapatılan zarar eden tesis sayısı. */
  divested: number;
  built: number;
  director: DirectorResult;
  standing: StandingOrderResult;
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
  const divestCfg = configValue<{ minIdleTicks: number; minCoverageTicks: number }>(
    tick, 'npc.divest', { minIdleTicks: 192, minCoverageTicks: 96 },
  );
  const clearCfg = configValue<{ targetTicks: number; maxDiscount: number }>(
    tick, 'retail.clearance', { targetTicks: 8, maxDiscount: 0.25 },
  );
  const retailCfg = configValue<{ retailMarkup: number }>(
    tick, 'economy.retail', { retailMarkup: 1.35 },
  );

  // ★ DİREKTÖR ÖNCE KOŞAR: bu turda yayınladığı direktifleri NPC'ler aynı
  // turda tüketir. Sonra koşsaydı direktifler bir tur gecikir ve acil
  // müdahalenin etkisi bir tur sonra görünürdü.
  const director = await runDirector(sql, tick);

  /*
   * ★ Kalıcı emirler NPC kararlarından ÖNCE işlenir. Oyuncunun önceden
   * tanımladığı kural, NPC'nin o turki kararından önce defterde yerini
   * almalı: aksi halde oyuncu her turda NPC'nin arkasına düşerdi.
   */
  const standing = await runStandingOrders(sql, tick);

  /*
   * ★ SIRA BELİRLEYİCİ OLMALI (R56).
   *
   * Postgres, ORDER BY olmadan satır sırasını GARANTİ ETMEZ ve satırlar
   * güncellendikçe fiziksel düzen değişir. Bu döngü durumu sırayla değiştirir:
   * tur içi taahhüt defteri (R45) ilk karar verene açığı kaptırır, bütçe ve
   * fırsat sırayla tükenir. Sıra değişince sonuç değişir.
   *
   * Ölçüldü: aynı tohum ve AYNI KOD iki kapı koşusunda 10/13 ve 7/13 verdi.
   * "Tohum varyansı" sandığım şeyin bir kısmı buydu.
   */
  const npcs = await sql<NpcRow[]>`
    SELECT c.id AS company_id, c.name, c.cash, c.home_city_id, p.archetype, p.target_margin,
           p.price_aggressiveness, p.inventory_target_ticks, p.cash_reserve_ratio,
           p.strategy_interval_ticks, p.last_strategy_tick, p.investment_aggressiveness
    FROM npc_profiles p
    JOIN companies c ON c.id = p.company_id AND c.kind = 'NPC' AND c.status = 'ACTIVE'
    ORDER BY c.id`;
  // Oyuncu kısması NPC'lerin varlığına bağlı değildir: erken çıkıştan önce.
  const directives = await loadDirectives(sql, tick);
  const playerThrottled = await throttlePlayerFacilities(sql, directives, throttleCfg);

  if (npcs.length === 0) {
    return { npcs: 0, pricesSet: 0, buyOrders: 0, sellOrders: 0, retailOffers: 0,
             strategicDecisions: 0, throttled: playerThrottled, built: 0, divested: 0,
             director, standing };
  }

  const references = await loadReferencePrices(sql, tick.seq);
  const health = await loadMarketHealth(sql, tick);
  const facilities = await loadFacilities(sql, tick, npcs.map((n) => n.company_id));
  const stock = await loadStock(sql, facilities.map((f) => f.inventory_id));

  /*
   * Dükkânın KENDİ satış hızı — raf fiyatına stok baskısı bunun üzerinden
   * hesaplanır. Tahmin (`base_demand × 0,35`) kullanılamaz: dükkânlar arası
   * fark tam da ölçmek istediğimiz şey.
   */
  // Ürünün piyasa genelindeki arz/talep oranı — indirim yalnız GERÇEK fazlada
  // uygulanır (R53). Sağlık kaydı yoksa oran bilinmiyor sayılır.
  const marketRatio = new Map<number, number>();
  for (const row of await sql<{ product_id: number; ratio: number }[]>`
    SELECT product_id, (supply_units::float8 / NULLIF(demand_units, 0)) AS ratio
      FROM market_health
     WHERE city_id = 0 AND demand_units > 0
       AND tick_id = (SELECT MAX(tick_id) FROM market_health WHERE tick_id <= ${tick.seq})`) {
    marketRatio.set(row.product_id, row.ratio);
  }

  const salesRate = new Map<string, number>();
  for (const row of await sql<{ facility_id: string; product_id: number; per_tick: number }[]>`
    SELECT facility_id, product_id, (SUM(quantity) / 1000.0 / 96)::float8 AS per_tick
      FROM retail_sales
     WHERE tick_id > ${tick.seq - 96n} AND tick_id <= ${tick.seq}
     GROUP BY 1, 2`) {
    salesRate.set(`${row.facility_id}:${row.product_id}`, row.per_tick);
  }
  const inputs = await loadRecipeInputs(sql, facilities);
  const openOrders = await loadOpenOrders(sql, npcs.map((n) => n.company_id));
  const retailDemand = await loadRetailProducts(sql);
  const freight = await buildFreightTable(sql, tick);

  const support = await loadSupportGuard(sql, tick);
  const opportunities = await loadOpportunities(sql, tick);
  await logOpportunities(sql, tick, opportunities, directives);
  // Fırsat listesi tur başında bir kez hesaplanır; bu defter onu tur içinde
  // güncel tutar — bkz. `maybeInvest` içindeki taahhüt kuralı.
  const committed = new Map<number, number>();

  const out = { npcs: npcs.length, pricesSet: 0, buyOrders: 0, sellOrders: 0, retailOffers: 0,
                strategicDecisions: 0, throttled: 0, built: 0, divested: 0, director, standing };
  out.throttled += playerThrottled;
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
          // ED direktifi: hedef stok tur sayısı ±%40'a kadar kaydırılabilir.
          const plan = planInventory({
            onHand: asQty(held.available), consumptionPerTick: needPerTick,
            minTicks: invCfg.minTicks,
            targetTicks: npc.inventory_target_ticks
              * lever(directives, input.product_id, 'INVENTORY_TARGET'),
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
            quantity: biasedQuantity(plan.buyQuantity, directives, support, input.product_id),
            price: bid, budget,
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
        /*
         * ED direktifi: kıtlıkta üretim teşviki, bolluk yönünde kısma.
         *
         * ★ Kaldıraç yalnız HEDEFİ kaydırır, SONUCU değil — kademelilik
         * (≤%5/tur) böyle korunur. Önce ikisine birden uygulanıyordu ve
         * kıtlıkta teşvik stok geri beslemesini tamamen eziyordu: deposu
         * dolu bir tesis tam kapasiteyle üretmeye devam ediyordu. Oysa
         * deposu dolu üreticinin sorunu üretim değil DAĞITIMdır; tam gaz
         * devam etmek yalnız işçilik yakar (R21). Teşvik tesisin daha çok
         * stok TOLERE etmesini sağlar, dolu depoya üretmesini değil.
         */
        const bias = lever(directives, facility.output_product_id, 'PRODUCTION_BIAS');
        const nextUtilization = outputThrottle({
          coverageTicks: coverage,
          targetTicks: throttleCfg.targetTicks * bias,
          previous: facility.utilization,
          maxStep: throttleCfg.maxStepPerTick,
          floor: throttleCfg.floor,
        });
        // CAPACITY_CAP bir ÇARPAN değil, doğrudan TAVANdır (docs/07 §3: 0..1).
        const cap = rawLever(directives, facility.output_product_id, 'CAPACITY_CAP') ?? 1;
        const capped = Math.min(nextUtilization, cap);
        if (Math.abs(capped - facility.utilization) > 1e-9) {
          await sql`UPDATE facilities SET utilization = ${capped}
                     WHERE id = ${facility.facility_id}::uuid`;
          out.throttled++;
        }
        /*
         * Çıkış saati: stok KAPATMA EŞİĞİNİN üstünde kaldığı sürece işler,
         * altına inince sıfırlanır.
         *
         * ★ Önce KISMA SEVİYESİ damgalıyordu (capped <= idleBelow). Kısma
         * zaten fazla arza verilen cevaptır; onu kapatma gerekçesi saymak aynı
         * hata sinyaline ikinci denetleyici asmaktı (R60). Burada kısmanın
         * BAŞARAMADIĞI şey ölçülür: üretim geri çekildiği hâlde stok hâlâ
         * erimiyorsa malın alıcısı yoktur.
         *
         * ★★ Eşik olarak KISMANIN HEDEFİ (8 tur) kullanılmıştı ve bu çok
         * düşüktü: kısma en ufak iş yaptığında saat başlıyordu, yani hemen
         * her tesis aday oluyordu. Kaldırdığım kısma kapısı çifte sayımdı —
         * o kısım doğruydu — ama aynı zamanda bir ŞİDDET FİLTRESİydi ve
         * yerine bir şey koymamıştım. Ölçüldü (R61): tohum dünyasının kurucu
         * tesisleri kapandı (tohum 2'de çelik fabrikası 2+6'dan 1+1'e indi),
         * NPC üretim payının yayılması daraldığı yerde genişledi.
         *
         * Şimdi tek eşik iki işi de görüyor: saat bu seviyenin üstünde işler,
         * kapatma kararı da aynı seviyeyi arar.
         */
        const tabanda = coverage > divestCfg.minCoverageTicks;
        await sql`
          UPDATE facilities
             SET idle_since_tick = ${tabanda ? sql`COALESCE(idle_since_tick, ${tick.seq})` : sql`NULL`}
           WHERE id = ${facility.facility_id}::uuid`;
      }

      // ---- PERAKENDECİ / TÜCCAR: nihai ürün al, rafa koy -----------------
      if (isRetail) {
        for (const product of retailDemand) {
          const held = stockOf(stock, facility.inventory_id, product.id);
          const salesPerTick = product.base_demand * 0.35; // şehir payı tahmini

          // Rafa fiyat koy
          if (held.available > 0n) {
            /*
             * ★ PERAKENDE ÇIPASI TOPTAN REFERANSI DEĞİLDİR.
             *
             * Üretici için ürünün referansı sattığı malın fiyatıdır — doğru
             * çıpa. Perakendeci için ise aynı referans bir MALİYET çıpasıdır:
             * ona göre fiyatlamak, raf fiyatını toptan seviyesine çeker ve
             * perakende marjını yapısal olarak siler.
             *
             * F8'de ölçüldü (domates): toptan 15,39 ₺ + navlun 1,28 = 16,67 ₺
             * maliyet, raf 17,08 ₺ → brüt marj %2,4. Bakım 2 ₺/tur. Sonuç:
             * NPC'ler de oyuncular da zarar ediyordu (NPC net −53.288 ₺).
             *
             * Raf çıpası artık toptan referansın `retailMarkup` katıdır. Bu
             * dükkânın kendi giderlerinin (bakım, fire, raf) karşılığıdır;
             * tüketicinin rezervasyon tavanı (referans × 3) çok üstünde
             * olduğu için talep kırılmaz.
             */
            /*
             * ★ Stok baskısı: rafta biriken mal fiyatı aşağı çeker (R51).
             * Satış hızı ölçülemeyen (henüz hiç satmamış) dükkânda indirim
             * uygulanmaz — kapsam sonsuz çıkar ve yeni açılan her dükkân
             * kendini indirime sokardı.
             */
            const perTick = salesRate.get(`${facility.facility_id}:${product.id}`) ?? 0;
            const clearance = perTick > 0
              ? clearanceFactor({
                  coverageTicks: Number(held.available) / 1000 / perTick,
                  targetTicks: clearCfg.targetTicks,
                  maxDiscount: clearCfg.maxDiscount,
                  marketRatio: marketRatio.get(product.id),
                })
              : 1;
            const retailAnchor = new Map(references);
            retailAnchor.set(product.id, asMoney(
              (references.get(product.id)! * BigInt(Math.round(
                retailCfg.retailMarkup * clearance * 1000,
              ))) / 1000n,
            ));
            const decision = priceFor(npc, held.unit_cost, product.id, retailAnchor, health, npcCfg, facility.facility_id);
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
            minTicks: RETAIL_BUFFER_TICKS,
            targetTicks: Math.min(npc.inventory_target_ticks, 10)
              * lever(directives, product.id, 'INVENTORY_TARGET'),
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
            quantity: biasedQuantity(plan.buyQuantity, directives, support, product.id),
            price: bid, budget,
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
      // Önce ÇIKIŞ, sonra giriş: kapanan tesis `maxFacilities` yuvasını
      // boşaltır ve NPC aynı turda daha iyi bir yere yatırım yapabilir.
      out.divested += await divestIdle(sql, tick, npc.company_id, divestCfg);
      if (await maybeInvest(sql, tick, npc, directives, opportunities, invCfg, committed)) out.built++;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */

function priceFor(
  npc: NpcRow, unitCost: bigint, productId: number,
  references: ReferencePrices, health: Map<number, number>,
  cfg: { priceBandPerTick: number; emergencyBandPerTick: number; emergencyHealthBelow: number },
  _facilityId?: string,
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

/* ------------------------------------------------------------------ */
/*  EKONOMİ DİREKTÖRÜ DİREKTİFLERİNİN TÜKETİMİ                          */
/* ------------------------------------------------------------------ */

type DirectiveMap = Map<number, Map<DirectiveLever, number>>;

/**
 * Geçerli direktifler — ürün başına kaldıraç → büyüklük.
 *
 * Süresi dolmuş direktif okunmaz; ED'nin müdahalesi bu yüzden kendiliğinden
 * söner (docs/07 §4). `scope = 'GLOBAL'` (product_id NULL) direktifler tüm
 * ürünlere uygulanır ve ürün bazlı olanla çakışırsa ürün bazlı kazanır.
 */
async function loadDirectives(sql: Sql, tick: EngineTick): Promise<DirectiveMap> {
  const rows = await sql<{ product_id: number | null; lever: string; magnitude: number }[]>`
    SELECT product_id, lever, magnitude FROM npc_directives
     WHERE issued_tick <= ${tick.seq} AND expires_tick > ${tick.seq}
     ORDER BY product_id NULLS FIRST`;
  const map: DirectiveMap = new Map();
  const global = new Map<DirectiveLever, number>();
  for (const row of rows) {
    if (row.product_id === null) { global.set(row.lever as DirectiveLever, row.magnitude); continue; }
    const forProduct = map.get(row.product_id) ?? new Map(global);
    forProduct.set(row.lever as DirectiveLever, row.magnitude);
    map.set(row.product_id, forProduct);
  }
  if (global.size > 0) map.set(0, global); // 0 = ürünü olmayanlar için taban
  return map;
}

/** Direktifin HAM büyüklüğü; çarpana çevrilmeyen kaldıraçlar için (CAPACITY_CAP). */
function rawLever(
  directives: DirectiveMap, productId: number, name: DirectiveLever,
): number | undefined {
  return directives.get(productId)?.get(name) ?? directives.get(0)?.get(name);
}

/** Kaldıracın çarpanı; direktif yoksa 1 (etkisiz). */
function lever(directives: DirectiveMap, productId: number, name: DirectiveLever): number {
  const magnitude = directives.get(productId)?.get(name) ?? directives.get(0)?.get(name);
  return magnitude === undefined ? 1 : leverMultiplier(name, magnitude);
}

/**
 * Alım desteği tabanı — madde 33.
 *
 * ED fiyat çöktüğünde `BUY_BIAS` verir, ama destek SINIRSIZ DEĞİLDİR: piyasa
 * fiyatı referansın %55'inin altına düştüyse ED desteği çekilir ve piyasa
 * temizlensin diye bırakılır. Oyuncu kötü yatırım yaptıysa zarar eder —
 * bu bilinçlidir.
 *
 * Sonuç: ürün başına "ED desteği geçerli mi" haritası.
 */
async function loadSupportGuard(sql: Sql, tick: EngineTick): Promise<Set<number>> {
  const rows = await sql<{ product_id: number; median: bigint; ema: bigint }[]>`
    SELECT product_id, weighted_median AS median, ema_reference AS ema
      FROM price_history
     WHERE city_id = 0
       AND tick_id = (SELECT MAX(tick_id) FROM price_history WHERE tick_id < ${tick.seq})`;
  const allowed = new Set<number>();
  for (const row of rows) {
    // İşlem olmayan turda medyan 0 gelir; destek o zaman ZATEN gerekir.
    if (row.median === 0n || row.median >= softFloor(row.ema)) allowed.add(row.product_id);
  }
  return allowed;
}

/**
 * `BUY_BIAS` uygulanmış alış miktarı — madde 33.
 *
 * ED yalnızca NPC'yi "daha çok almaya EĞİLİMLİ" yapabilir; fiyata dokunamaz
 * (docs/07 §3: fiyat belirlemek ED'nin yapamadıkları arasında). Destek tabanı
 * kırılmışsa kaldıraç hiç uygulanmaz: piyasa temizlensin diye bırakılır.
 */
function biasedQuantity(
  quantity: bigint, directives: DirectiveMap, support: Set<number>, productId: number,
): bigint {
  if (!support.has(productId)) return quantity;
  const multiplier = lever(directives, productId, 'BUY_BIAS');
  if (multiplier === 1) return quantity;
  return (quantity * BigInt(Math.round(multiplier * 1000))) / 1000n;
}

/* ------------------------------------------------------------------ */
/*  STRATEJİK YATIRIM (madde 27) — INVESTMENT_BIAS'ın tüketicisi         */
/* ------------------------------------------------------------------ */

interface Opportunity {
  product_id: number;
  facility_type_id: number;
  facility_code: string;
  recipe_id: number;
  base_cost: bigint;
  /** Tesisin tur başına çıktısı — aynı tur içindeki taahhütleri saymak için. */
  base_capacity: number;
  build_ticks: number;
  unlock_level: number;
  /** Sağlık bileşenleri: skor ne kadar düşükse fırsat o kadar büyük. */
  demand_gap: number;
  price_trend: number;
  competition: number;
  margin: number;
  /** Tur başına açık (birim): talep − arz. Negatifse fazla arz var. */
  gap_per_tick: number;
  /** Girdilerin en kıt olanının arz sağlığı; hammaddede 1. */
  /** Girdilerin en kıt olanının arz sağlığı; hammaddede 1. */
  input_supply: number;
  /** Ürünün kendi arz sağlığı. */
  output_supply: number;
  /** Şu anda İNŞA HALİNDE olan, henüz üretmeyen kapasite (birim/tur). */
  pipeline_per_tick: number;
}

/**
 * Yatırım fırsatları — ürün başına tek satır.
 *
 * Fırsat sinyalleri ED'nin ölçtüğü `market_health` bileşenlerinden türetilir:
 * ayrı bir ölçüm yapmak, ED ile NPC'nin farklı gerçeklikler görmesi demek
 * olurdu. NPC ile ED aynı tabloya bakar; ayrıcalık yok (ADR-0004).
 */
async function loadOpportunities(sql: Sql, tick: EngineTick): Promise<Opportunity[]> {
  return sql<Opportunity[]>`
    WITH saglik AS (
      SELECT product_id, f_supply, f_sellers, f_stability,
             (demand_units - supply_units) / 1000.0 / 96.0 AS gap_per_tick,
             /*
              * ★ YÖNLÜ kıtlık. f_supply SİMETRİKtir (1 - |oran-1|/0,5):
              * oranı 2 olan FAZLA arzdaki ürünün f_supply'ı da 0 çıkar, tıpkı
              * oranı 0 olan kıt ürün gibi. Yatırım kararı bunu kullanınca
              * dolu ambara yatırım en cazip seçenek gibi görünüyordu — ölçüldü:
              * 26 buğday tarlası %45 kullanımda 31.756 kg satılmamış stokla
              * oturuyordu (R59).
              *
              * Kıtlık yalnız oran 1'in ALTINDAYKEN vardır.
              */
             GREATEST(0, LEAST(1, 1 - supply_units::float8 / NULLIF(demand_units, 0)))
               AS kitlik
        FROM market_health
       WHERE city_id = 0
         AND tick_id = (SELECT MAX(tick_id) FROM market_health WHERE tick_id <= ${tick.seq})
    ),
    -- ★ İnşa halindeki kapasite. Görülmezse tüm NPC'ler aynı açığa aynı anda
    -- cevap verir ve piyasa aşırı yatırımla dolar (ölçüldü: 120 turda 41 fırın).
    boru_hatti AS (
      SELECT r2.output_product_id AS product_id,
             SUM(ft2.base_capacity)::float AS units
        FROM facilities f2
        JOIN facility_types ft2 ON ft2.id = f2.facility_type_id
        JOIN production_recipes r2 ON r2.id = f2.active_recipe_id
       WHERE f2.closed_at IS NULL AND f2.construction_complete_at_tick > ${tick.seq}
       GROUP BY 1
    ),
    /*
     * Fiyat eğilimi: pencerenin BAŞI ile SONU arasındaki değişim.
     *
     * Önce (MAX - MIN) / MIN yazıyordu; o bir eğilim değil ARALIKtır ve
     * yön körüdür: %20 düşen fiyat da %20 çıkan fiyat kadar cazip
     * görünüyordu (R61). Ölçek priceTrendScore'da, tek kaynakta.
     */
    fiyat AS (
      SELECT product_id, (son - ilk)::float / NULLIF(ilk, 0) AS trend
        FROM (
          SELECT ph.product_id,
                 (ARRAY_AGG(ph.ema_reference ORDER BY ph.tick_id))[1] AS ilk,
                 (ARRAY_AGG(ph.ema_reference ORDER BY ph.tick_id DESC))[1] AS son
            FROM price_history ph
           WHERE ph.city_id = 0 AND ph.tick_id > ${tick.seq - 96n}
           GROUP BY 1
        ) q
    )
    SELECT r.output_product_id AS product_id, ft.id AS facility_type_id,
           ft.code AS facility_code, r.id AS recipe_id,
           ft.base_cost, ft.base_capacity, ft.construction_ticks AS build_ticks, ft.unlock_level,
           -- Arz açığı YÖNLÜdür: fazla arz fırsat değildir (R59).
           COALESCE(s.kitlik, 0)::float8 AS demand_gap,
           -- HAM değişim oranı; 0..1 puana çevirmek priceTrendScore'un işi.
           COALESCE(f.trend, 0)::float8 AS price_trend,
           COALESCE(s.f_sellers, 1) AS competition,
           COALESCE(s.gap_per_tick, 0)::float8 AS gap_per_tick,
           COALESCE(bh.units, 0)::float8 AS pipeline_per_tick,
           -- Hesap strategicNeed fonksiyonunda; SQL yalnız bileşeni taşır.
           -- Bolluk = 1 − kıtlık; girdisi bol, çıktısı kıt olan yer değer katar.
           (1 - COALESCE(sn.girdi_kitligi, 0))::float8 AS input_supply,
           (1 - COALESCE(s.kitlik, 0.5))::float8 AS output_supply,
           /*
            * Marj: referans fiyat ÷ TAM birim maliyet (girdiler dahil).
            *
            * Girdi maliyeti atlanırsa marj her üründe ~1 çıkar ve NPC
            * sağlıklı piyasada bile yatırım yapar (F7 ilk koşusu: 120 turda
            * 43 tesis).
            *
            * ★ Ölçek ekonominin TASARLANMIŞ marj bandına oturur
            * (PRICE_MARKUP_BAND, tohum testiyle ortak kaynak). Önce 2,5 katta
            * doyuyordu; tohum fiyatları tasarım gereği maliyetin 1,15–1,75
            * katı olduğu için terim her üründe 0,22–0,27'de sıkışıyor,
            * hiçbirini ayırmıyor ve skorun %35'i ölü ağırlık oluyordu (R47).
            */
           LEAST(1, GREATEST(0,
             (p.base_reference_price::float / NULLIF(
               ((r.labor_cost + r.energy_cost)::float + COALESCE(gm.girdi, 0))
               / NULLIF(r.output_quantity / 1000.0, 0), 0)
              - ${PRICE_MARKUP_BAND.min})
             / ${PRICE_MARKUP_BAND.max - PRICE_MARKUP_BAND.min})) AS margin
      FROM production_recipes r
      JOIN facility_types ft ON ft.id = r.facility_type_id
      JOIN products p ON p.id = r.output_product_id
      LEFT JOIN saglik s ON s.product_id = r.output_product_id
      LEFT JOIN fiyat f ON f.product_id = r.output_product_id
      LEFT JOIN boru_hatti bh ON bh.product_id = r.output_product_id
      LEFT JOIN LATERAL (
        SELECT SUM(ri.quantity * ip.base_reference_price / 1000.0)::float AS girdi
          FROM recipe_inputs ri JOIN products ip ON ip.id = ri.product_id
         WHERE ri.recipe_id = r.id
      ) gm ON TRUE
      /*
       * ★ Stratejik ihtiyaç: NEREDE DEĞER KATARIM?
       *
       * Girdisi kıt olan tesise yatırım para yakmaktır — kurulur, girdi
       * bulamaz, işçilik öder, durur. Ölçülen: fırın 0,37 · buğday tarlası
       * 0,36 · değirmen 0,36 — aradaki fark 0,01 ve seçim kazanan-hepsini-alır
       * olduğu için 28 yatırımın HEPSİ fırına gitti, buğdaya sıfır (R48).
       *
       * ★ Ama girdinin MUTLAK sağlığına bakmak da yanlıştı: buğday zincirin en
       * sağlıklı halkasıyken (oran 0,69, HEALTHY) f_supply'ı 0,38 olduğu için
       * değirmen 0,38 alıyor, buğday tarlası girdisi olmadığından 1,0 alıyordu.
       * Sermaye köke akmaya devam etti, buğday birikti, un halkası büyümedi:
       * iki tohumda da değirmen yalnız +4/+5 (R54).
       *
       * Doğru soru "girdim ne kadar bol" değil, NEREDE DEĞER KATARIM:
       * çıktım girdimden kıtsa oraya yatırım yapılır. 0,5 nötrdür; hammaddede
       * girdi arzı 1 sayıldığı için kendi çıktısı kıtken yüksek çıkar ve
       * çıktısı düzeldikçe kendiliğinden geri çekilir.
       */
      LEFT JOIN LATERAL (
        SELECT MAX(COALESCE(s2.kitlik, 1))::float8 AS girdi_kitligi
          FROM recipe_inputs ri2
          LEFT JOIN saglik s2 ON s2.product_id = ri2.product_id
         WHERE ri2.recipe_id = r.id
      ) sn ON TRUE
     WHERE r.is_active`;
}

/**
 * NPC yatırım kararı — madde 27.
 *
 * Yatırım ANINDA tamamlanmaz: `build_ticks` kadar inşaat sürer. Bu yüzden
 * NPC'ler arz açığına gecikmeli tepki verir — gerçekçidir ve oyuncuya önce
 * girme fırsatı bırakır.
 *
 * ED'nin `INVESTMENT_BIAS` kaldıracı EŞİĞİ düşürür, skoru değil: ED "şunu
 * inşa et" diyemez, yalnız "yatırım iştahını artır" der.
 */
async function maybeInvest(
  sql: Sql, tick: EngineTick, npc: NpcRow, directives: DirectiveMap,
  opportunities: Opportunity[], _cfg: { minTicks: number },
  /** Bu TURDA söz verilmiş kapasite (ürün → tur başına birim). */
  committed: Map<number, number>,
): Promise<boolean> {
  const invest = configValue<{ threshold: number; cashBufferRatio: number; maxFacilities: number }>(
    tick, 'npc.investment', { threshold: 0.55, cashBufferRatio: 1.5, maxFacilities: 4 },
  );

  const [owned] = await sql<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM facilities
     WHERE company_id = ${npc.company_id}::uuid AND closed_at IS NULL`;
  if (Number(owned?.count ?? 0n) >= invest.maxFacilities) return false;

  let best: { opportunity: Opportunity; score: number } | null = null;
  for (const o of opportunities) {
    /*
     * Açığı kapatacak kapasite zaten yoldaysa yatırım yapma. Bilgi mükemmel
     * ve kararlar eşzamanlı olduğu için bu kural olmadan her NPC aynı açığa
     * cevap verir ve piyasa aşırı yatırımla dolar.
     *
     * ★ "Yolda" iki şeydir: önceki turlarda başlamış inşaat (`pipeline`) VE
     *   bu turda az önce karar verilmiş yatırım (`committed`). İkincisi
     *   eksikti: fırsat listesi tur başında BİR KEZ hesaplanıp bütün NPC'lere
     *   aynı kopyası veriliyordu, dolayısıyla aynı turda karar verenler
     *   birbirini göremiyordu. Ölçülen sonucu — tur 384'te 58 NPC birlikte
     *   karar verdi ve 8 tur sonra 51 buğday tarlası birden açıldı; buğday
     *   kapasitesi ihtiyacın 8,7 katına çıkarken fırın 0,35 katında kaldı.
     */
    const inFlight = o.pipeline_per_tick + (committed.get(o.product_id) ?? 0);
    if (inFlight >= Math.max(0, o.gap_per_tick)) continue;
    const score = investmentScore({
      profitMargin: o.margin,
      demandGap: o.demand_gap,
      priceTrend: priceTrendScore(o.price_trend),
      strategicNeed: strategicNeed(o.input_supply, o.output_supply),
      competition: o.competition,
      // Arketip iştahı 1 etrafında ölçekler: 0,5 iştah → ×1,0, 0,9 → ×1,4.
    }) * (0.5 + npc.investment_aggressiveness);
    if (!best || score > best.score) best = { opportunity: o, score };
  }
  if (!best) return false;

  // ED eşiği düşürür: INVESTMENT_BIAS 1,5 ise eşik 0,55 → 0,367.
  const threshold = invest.threshold / lever(directives, best.opportunity.product_id, 'INVESTMENT_BIAS');
  if (best.score < threshold) return false;

  const [city] = await sql<{ id: number; land_cost_index: number }[]>`
    SELECT id, land_cost_index FROM cities WHERE id = ${npc.home_city_id}`;
  if (!city) return false;
  const cost = (best.opportunity.base_cost
    * BigInt(Math.round(city.land_cost_index * 1000))) / 1000n;

  // Nakit tamponu: yatırım şirketi işletme sermayesiz bırakmamalı.
  const required = (cost * BigInt(Math.round(invest.cashBufferRatio * 100))) / 100n;
  if (npc.cash < required) return false;

  const [sink] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;
  if (!sink) return false;

  const [type] = await sql<{ storage_capacity: bigint }[]>`
    SELECT storage_capacity FROM facility_types WHERE id = ${best.opportunity.facility_type_id}`;

  const [facility] = await sql<{ id: string }[]>`
    INSERT INTO facilities (company_id, facility_type_id, city_id, name, storage_capacity,
                            construction_complete_at_tick, active_recipe_id)
    VALUES (${npc.company_id}::uuid, ${best.opportunity.facility_type_id}, ${city.id},
            ${`${npc.name} — ${best.opportunity.facility_code}`}, ${type!.storage_capacity},
            ${tick.seq + BigInt(best.opportunity.build_ticks)}, ${best.opportunity.recipe_id})
    RETURNING id`;

  committed.set(best.opportunity.product_id,
    (committed.get(best.opportunity.product_id) ?? 0) + best.opportunity.base_capacity);

  await sql.begin((tx) => transfer(tx as unknown as Sql, {
    tickId: tick.seq,
    fromCompanyId: npc.company_id, toCompanyId: sink!.id,
    amount: asMoney(cost), account: 'CAPEX', reason: 'NPC yatırım kararı',
    refType: 'facility', refId: facility!.id,
  }));

  await logDecision(sql, tick, npc.company_id, best.opportunity.product_id, 'INVEST',
    cost, asMoney(cost), `skor ${best.score.toFixed(2)} ≥ eşik ${threshold.toFixed(2)}`);
  return true;
}


/**
 * Üretim kısma OYUNCU tesislerine de uygulanır (R55).
 *
 * Kısma NPC döngüsünün içindeydi; oyuncu tesisleri her zaman %100 kullanımda
 * kalıyordu (ölçüldü: oyuncu 1,000 · NPC 0,694). Sonucu domates fazlasıydı:
 * sebze bahçesi Lv1'de kurulabilen tek üretim tesisi olduğu için bütün
 * oyuncular onu kuruyor, deposu dolsa da tam gaz üretmeye devam ediyordu.
 * Arz/talep oranı 1,57-1,62'de takıldı — indirim (R51) fiyatı düşürüyor ama
 * ÜRETİMİ durdurmuyor.
 *
 * R21 ("kapasiteye üretim para sızdırıyor") ile R41 ("çevrimdışı oyuncu
 * geriliyor") kesişimidir: dolu depoya üretmek yalnız işçilik yakar ve
 * çevrimdışı oyuncu bunu göremez. Kısma geri döndürülebilir.
 *
 * ★ NPC varlığından BAĞIMSIZ çalışır: erken çıkışın gerisinde kalsaydı
 * NPC'siz bir dünyada hiç uygulanmazdı.
 *
 * Oyuncunun kendi tercihi korunur: production_enabled kapalıysa motor karışmaz.
 */
async function throttlePlayerFacilities(
  sql: Sql, directives: DirectiveMap,
  cfg: { targetTicks: number; maxStepPerTick: number; floor: number },
): Promise<number> {
  let throttled = 0;
  const oyuncuTesisleri = await sql<{
    id: string; utilization: number; base_capacity: number; level_multiplier: number;
    output_product_id: number; output_quantity: bigint; cycle_ticks: number;
    stock: bigint;
  }[]>`
    SELECT f.id, f.utilization, ft.base_capacity,
           COALESCE(lc.capacity_multiplier, 1) AS level_multiplier,
           r.output_product_id, r.output_quantity, COALESCE(r.cycle_ticks, 1) AS cycle_ticks,
           COALESCE((SELECT SUM(b.quantity) FROM inventory_batches b
                      JOIN inventories i ON i.id = b.inventory_id
                     WHERE i.facility_id = f.id AND b.product_id = r.output_product_id), 0) AS stock
      FROM facilities f
      JOIN companies c ON c.id = f.company_id
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN production_recipes r ON r.id = f.active_recipe_id
      LEFT JOIN facility_level_curve lc ON lc.level = f.level
     WHERE c.kind = 'PLAYER' AND f.closed_at IS NULL AND f.production_enabled
       AND ft.base_capacity > 0`;

  for (const t of oyuncuTesisleri) {
    const perTick = t.base_capacity * t.level_multiplier
      * Number(t.output_quantity) / 1000 / Math.max(1, t.cycle_ticks);
    if (!(perTick > 0)) continue;
    const coverage = Number(t.stock) / 1000 / perTick;
    const bias = lever(directives, t.output_product_id, 'PRODUCTION_BIAS');
    const next = outputThrottle({
      coverageTicks: coverage,
      targetTicks: cfg.targetTicks * bias,
      previous: t.utilization,
      maxStep: cfg.maxStepPerTick,
      floor: cfg.floor,
    });
    if (Math.abs(next - t.utilization) > 1e-9) {
      await sql`UPDATE facilities SET utilization = ${next} WHERE id = ${t.id}::uuid`;
      throttled++;
    }
  }
  return throttled;
}

/**
 * Yatırım fırsatlarının HAM girdilerini teşhis tablosuna yazar.
 *
 * ★ Sermayenin neden bir ürüne akıp ötekine akmadığını üç kez dolaylı
 * sinyallerden okumaya çalıştım ve üçünde de yanlış okudum (R54, R59, R60).
 * Burası tahmini bitirir.
 *
 * Model burada YENİDEN HESAPLANMAZ: skor gerçek `investmentScore` çağrısıdır,
 * bileşenler `loadOpportunities` satırlarının kendisidir. Teşhisin kendi
 * kopyasını hesaplaması, testin kendi modelini doğrulamasıyla aynı hata
 * olurdu (R46).
 *
 * NPC iştahı (`investment_aggressiveness`) uygulanmaz — o NPC başına değişir,
 * bu tablo ürün başına tek satırdır. Kaydedilen, herkesin gördüğü TEMEL skor.
 */
async function logOpportunities(
  sql: Sql, tick: EngineTick, opportunities: Opportunity[], directives: DirectiveMap,
): Promise<void> {
  if (opportunities.length === 0) return;
  const invest = configValue<{ threshold: number }>(
    tick, 'npc.investment', { threshold: 0.38 },
  );
  const rows = opportunities.map((o) => {
    const need = strategicNeed(o.input_supply, o.output_supply);
    // Kararın KULLANDIĞI değerler yazılır, ham girdiler değil: teşhis
    // skorun bileşenlerini gösterir, onları yeniden hesaplamaz (R46).
    const trend = priceTrendScore(o.price_trend);
    return {
      tick_id: tick.seq,
      product_id: o.product_id,
      margin: o.margin,
      demand_gap: o.demand_gap,
      price_trend: trend,
      strategic_need: need,
      competition: o.competition,
      score: investmentScore({
        profitMargin: o.margin, demandGap: o.demand_gap, priceTrend: trend,
        strategicNeed: need, competition: o.competition,
      }),
      threshold: invest.threshold / lever(directives, o.product_id, 'INVESTMENT_BIAS'),
      gap_per_tick: o.gap_per_tick,
      pipeline_per_tick: o.pipeline_per_tick,
    };
  });
  await sql`
    INSERT INTO investment_opportunities ${sql(rows)}
    ON CONFLICT (tick_id, product_id) DO NOTHING`;
}

/**
 * Zarar eden hattı kapatır — sermaye tahsisi tek yönlü olmasın (R58).
 *
 * Kural KATIDIR: yalnız uzun süre kısma tabanında çalışmış VE çıktı stoğu
 * birikmiş tesis kapanır. İkinci şart, girdi bulamadığı için duran tesisi
 * korur — onun çıktı stoğu yoktur ve kapatmak kıtlığı derinleştirirdi.
 *
 * Sermaye geri gelmez: batmış maliyet batmıştır. Kazanç, bakım ve işçiliğin
 * durması ve `maxFacilities` yuvasının boşalmasıdır.
 */
async function divestIdle(
  sql: Sql, tick: EngineTick, companyId: string,
  cfg: { minIdleTicks: number; minCoverageTicks: number },
): Promise<number> {
  const adaylar = await sql<{
    id: string; idle_since_tick: bigint;
    base_capacity: number; stock: bigint;
  }[]>`
    SELECT f.id, f.idle_since_tick, ft.base_capacity,
           COALESCE((SELECT SUM(b.quantity) FROM inventory_batches b
                      JOIN inventories i ON i.id = b.inventory_id
                     WHERE i.facility_id = f.id AND b.product_id = r.output_product_id), 0) AS stock
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN production_recipes r ON r.id = f.active_recipe_id
     WHERE f.company_id = ${companyId}::uuid AND f.closed_at IS NULL
       AND f.idle_since_tick IS NOT NULL
     ORDER BY f.id`;

  let kapanan = 0;
  for (const a of adaylar) {
    const perTick = a.base_capacity;
    if (!(perTick > 0)) continue;
    if (!shouldDivest({
      coverageTicks: Number(a.stock) / 1000 / perTick,
      idleTicks: Number(tick.seq - a.idle_since_tick),
      minIdleTicks: cfg.minIdleTicks,
      minCoverageTicks: cfg.minCoverageTicks,
    })) continue;

    await sql`
      UPDATE facilities SET closed_at = NOW(), production_enabled = FALSE
       WHERE id = ${a.id}::uuid`;
    kapanan++;
  }
  return kapanan;
}
