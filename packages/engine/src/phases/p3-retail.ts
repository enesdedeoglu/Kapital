import { consumeFefo, transfer, type Sql } from '@kapital/db';
import {
  allocateRetail, cityDemand, demandNoise, economicCycle, scoreOffer, seasonMultiplier,
  type CategoryWeights, type CityDemandParams, type ProductDemandParams, type RetailOffer,
  worldDemandScale, DEFAULT_DEMAND_SCALE, type DemandScaleConfig,
  eventMultipliersFor,
} from '@kapital/economy';
import { asMoney, asQty, deterministicUuid, priceTimesQty, type Money } from '@kapital/shared';
import { configValue, rngFor, type EngineTick } from '../context.js';
import { PHASE } from '../phases.js';
import { loadReferencePrices } from '../reference-prices.js';
import { loadActiveEvents } from './world-events.js';

interface OfferRow {
  facility_id: string; company_id: string; city_id: number; product_id: number;
  facility_level: number; selling_price: bigint; reputation: string;
  available: bigint; avg_quality: string;
}

interface ProductRow {
  id: number; code: string; base_demand: number; price_sensitivity: number;
  reservation_price_mult: number;
  price_weight: number; quality_weight: number; brand_weight: number;
}

export interface RetailPhaseResult {
  markets: number;
  soldUnits: bigint;
  revenue: bigint;
  unmetUnits: bigint;
  budgetLimitedUnits: bigint;
}

/**
 * P3 — PERAKENDE. Mağazalar NPC tüketicilere satar; paranın oyuna TEK giriş
 * noktası burasıdır (madde 34).
 *
 * Shard anahtarı `city_id`: pazar payı şehir×ürün içinde hesaplanır, dolayısıyla
 * şehirler birbirinden bağımsızdır (ADR-0005).
 */
export async function runRetailPhase(sql: Sql, tick: EngineTick): Promise<RetailPhaseResult> {
  const references = await loadReferencePrices(sql, tick.seq);

  const retailCfg = configValue<{ redistributionRounds: number; noiseMin: number; noiseMax: number; cycleAmplitude: number }>(
    tick, 'economy.retail', { redistributionRounds: 3, noiseMin: 0.97, noiseMax: 1.03, cycleAmplitude: 0.12 },
  );
  const budgetSlack = configValue<{ budgetSlack?: number }>(tick, 'economy.retail', {}).budgetSlack ?? 1.15;
  const seasonTable = configValue<Record<string, number[]> | undefined>(tick, 'economy.season', undefined);

  // Yalnız iş gerektiren kayıtlar taranır (madde 54): açık rafı ve stoğu olan,
  // inşaatı bitmiş tesisler.
  const offers = await sql<OfferRow[]>`
    SELECT ro.facility_id, f.company_id, f.city_id, ro.product_id, f.level AS facility_level,
           ro.selling_price, c.reputation::text AS reputation,
           SUM(b.quantity - b.reserved_quantity)::bigint AS available,
           (SUM(b.quantity * b.quality) / SUM(b.quantity))::text AS avg_quality
    FROM retail_offers ro
    JOIN facilities f  ON f.id = ro.facility_id
                      AND f.closed_at IS NULL
                      AND f.construction_complete_at_tick <= ${tick.seq}
    JOIN companies c   ON c.id = f.company_id AND c.status = 'ACTIVE'
    JOIN inventories i ON i.facility_id = f.id
    JOIN inventory_batches b ON b.inventory_id = i.id AND b.product_id = ro.product_id
    WHERE ro.enabled
    GROUP BY ro.facility_id, f.company_id, f.city_id, ro.product_id, f.level,
             ro.selling_price, c.reputation
    HAVING SUM(b.quantity - b.reserved_quantity) > 0`;

  const cities = await sql<{ id: number; population_index: number; income_index: number; consumer_demand_index: number }[]>`
    SELECT id, population_index, income_index, consumer_demand_index FROM cities WHERE is_active`;
  const products = await sql<ProductRow[]>`
    SELECT p.id, p.code, p.base_demand, p.price_sensitivity, p.reservation_price_mult,
           pc.price_weight, pc.quality_weight, pc.brand_weight
    FROM products p JOIN product_categories pc ON pc.id = p.category_id
    WHERE p.is_active AND p.is_retail_product AND p.base_demand > 0`;

  const cycle = economicCycle(tick.seq, retailCfg.cycleAmplitude);

  /*
   * ★ Dünya talebi ŞİRKET SAYISIYLA ölçeklenir.
   *
   * Spec'te talep şehrin sabit özelliklerinden gelir ve oyuncu sayısından
   * bağımsızdır; bu, oyuncu tabanı büyüdükçe sabit bir pastanın daha çok
   * satış noktası arasında bölünmesi demektir. F8 simülasyonunda ölçüldü:
   * 130 nokta, nokta başına 43 ₺/tur, bakım 2 ₺/tur → her dükkân zararda.
   */
  const scaleCfg = configValue<DemandScaleConfig>(
    tick, 'economy.demandScale', DEFAULT_DEMAND_SCALE,
  );
  const [activeCount] = await sql<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM companies
     WHERE kind <> 'SYSTEM' AND status = 'ACTIVE'`;
  const demandScale = worldDemandScale(Number(activeCount?.count ?? 0n), scaleCfg);

  // Dünya olayları talebi çarpar (madde 45). Dünya ölçeğiyle ÇARPILIR, üstüne
  // yazılmaz: ikisi farklı şeylerdir — biri oyuncu tabanının büyüklüğü, diğeri
  // o anki hava.
  const events = await loadActiveEvents(sql, tick);
  const [consumer] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_CONSUMER'`;

  const byMarket = new Map<string, OfferRow[]>();
  for (const row of offers) {
    const key = `${row.city_id}:${row.product_id}`;
    (byMarket.get(key) ?? byMarket.set(key, []).get(key)!).push(row);
  }

  const result: RetailPhaseResult = {
    markets: 0, soldUnits: 0n, revenue: 0n, unmetUnits: 0n, budgetLimitedUnits: 0n,
  };
  const mutable = result as { -readonly [K in keyof RetailPhaseResult]: RetailPhaseResult[K] };

  for (const city of cities) {
    for (const product of products) {
      const reference = references.get(product.id);
      if (!reference) continue;

      const productParams: ProductDemandParams = {
        productId: product.id,
        baseDemand: product.base_demand,
        referencePrice: reference,
        reservationPriceMult: product.reservation_price_mult,
        priceSensitivity: product.price_sensitivity,
      };
      const cityParams: CityDemandParams = {
        cityId: city.id,
        populationIndex: city.population_index,
        incomeIndex: city.income_index,
        consumerDemandIndex: city.consumer_demand_index,
      };
      const rng = rngFor(tick, PHASE.RETAIL, city.id, `${city.id}:${product.id}`);
      const demand = cityDemand(productParams, cityParams, {
        economicCycle: cycle,
        seasonMultiplier: seasonMultiplier(tick.season, seasonTable, product.code),
        eventMultiplier: demandScale * eventMultipliersFor(events, {
          productId: product.id, cityId: city.id,
        }).demand,
        noise: demandNoise(rng, retailCfg.noiseMin, retailCfg.noiseMax),
        budgetSlack,
      });
      if (demand.units <= 0n) continue;

      const weights: CategoryWeights = {
        priceWeight: product.price_weight,
        qualityWeight: product.quality_weight,
        brandWeight: product.brand_weight,
      };
      const marketOffers = byMarket.get(`${city.id}:${product.id}`) ?? [];
      const scored = marketOffers.map((row) => {
        const offer: RetailOffer = {
          facilityId: row.facility_id,
          companyId: row.company_id,
          sellingPrice: asMoney(row.selling_price),
          availableStock: asQty(row.available),
          avgQuality: Number(row.avg_quality),
          reputation: Number(row.reputation),
          facilityLevel: row.facility_level,
        };
        return scoreOffer(offer, productParams, weights);
      });

      const outcome = allocateRetail({
        demand, offers: scored, maxRounds: retailCfg.redistributionRounds,
      });

      mutable.markets++;
      mutable.unmetUnits += outcome.unmetUnits;
      mutable.budgetLimitedUnits += outcome.budgetLimitedUnits;

      let fulfilled = 0n;
      let revenueSum = 0n;

      for (const allocation of outcome.allocations) {
        if (allocation.units <= 0n) continue;
        const applied = await applyAllocation(sql, tick, {
          ...allocation, cityId: city.id, productId: product.id, consumerId: consumer!.id,
        });
        fulfilled += applied.units;
        revenueSum += applied.revenue;
      }

      mutable.soldUnits += fulfilled;
      mutable.revenue += revenueSum;

      const avgPrice = fulfilled > 0n ? (revenueSum * 1000n) / fulfilled : null;
      await sql`
        INSERT INTO city_demand (tick_id, city_id, product_id, demand_units, demand_budget,
                                 fulfilled_units, budget_limited_units, avg_price)
        VALUES (${tick.seq}, ${city.id}, ${product.id}, ${demand.units}, ${demand.budget},
                ${fulfilled}, ${outcome.budgetLimitedUnits}, ${avgPrice})
        ON CONFLICT (tick_id, city_id, product_id) DO NOTHING`;
    }
  }

  return result;
}

/**
 * Tek mağazanın satışını uygular: stok FEFO ile düşer, para SYS_CONSUMER'dan gelir.
 * Her şey TEK transaction içinde; tx_id turdan deterministik türetilir, böylece
 * faz tekrar koşarsa satış iki kez oluşmaz.
 */
async function applyAllocation(
  sql: Sql,
  tick: EngineTick,
  a: {
    facilityId: string; companyId: string; units: bigint; unitPrice: Money;
    marketShare: number; cityId: number; productId: number; consumerId: string;
  },
): Promise<{ units: bigint; revenue: bigint }> {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;

    const [inv] = await t<{ id: string }[]>`
      SELECT id FROM inventories WHERE facility_id = ${a.facilityId}::uuid`;
    if (!inv) return { units: 0n, revenue: 0n };

    // Satılan mal gerçekten stoktan çıkar; ayrılan miktar eşzamanlı işlemler
    // nedeniyle planlanandan az olabilir — gerçekleşen miktar esas alınır.
    const consumed = await consumeFefo(t, {
      inventoryId: inv.id, productId: a.productId, quantity: asQty(a.units),
    });
    if (consumed.allocated <= 0n) return { units: 0n, revenue: 0n };

    const revenue = priceTimesQty(a.unitPrice, consumed.allocated).value;
    const cogs = priceTimesQty(consumed.weightedUnitCost, consumed.allocated).value;

    await transfer(t, {
      tickId: tick.seq,
      txId: deterministicUuid('retail', tick.seq, a.facilityId, a.productId),
      fromCompanyId: a.consumerId,
      toCompanyId: a.companyId,
      amount: revenue,
      account: 'SALES',
      reason: 'perakende satışı',
      refType: 'facility',
      refId: a.facilityId,
    });

    await t`
      INSERT INTO retail_sales (tick_id, facility_id, product_id, company_id, city_id,
                                quantity, unit_price, revenue, cogs, avg_quality, market_share)
      VALUES (${tick.seq}, ${a.facilityId}::uuid, ${a.productId}, ${a.companyId}::uuid,
              ${a.cityId}, ${consumed.allocated}, ${a.unitPrice}, ${revenue}, ${cogs},
              ${consumed.weightedQuality.toFixed(3)}, ${a.marketShare})
      ON CONFLICT (tick_id, facility_id, product_id) DO NOTHING`;

    return { units: consumed.allocated as bigint, revenue: revenue as bigint };
  }) as Promise<{ units: bigint; revenue: bigint }>;
}
