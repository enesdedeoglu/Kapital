import type { Sql } from '@kapital/db';
import {
  representativeDistance, shippingPerUnit, standingRestock, standingSurplus,
} from '@kapital/economy';
import { asMoney, asQty, TICKS_PER_DAY, type Money } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';
import { loadReferencePrices } from '../reference-prices.js';

export interface StandingOrderResult {
  rules: number;
  buyOrders: number;
  sellOrders: number;
  skippedNoCash: number;
  skippedLevelLocked: number;
}

interface RuleRow {
  id: bigint;
  company_id: string;
  facility_id: string;
  city_id: number;
  inventory_id: string;
  product_id: number;
  product_code: string;
  product_unlock: number;
  company_level: number;
  cash: bigint;
  kind: 'RESTOCK' | 'SELL_SURPLUS';
  target_quantity: bigint;
  max_price: bigint | null;
  min_price: bigint | null;
  on_hand: bigint;
  unit_cost: bigint;
  quality: string;
  free_capacity: bigint;
}

/**
 * KALICI EMİRLER — oyuncu yokken şirket çalışsın.
 *
 * docs/00'ın 3. ilkesi "oyuncu offline'ken ekonomi devam eder" diyor. Motor
 * devam ediyor, ama oyuncuya offline'ken KATILMA yolu verilmemişti: girmeyen
 * oyuncunun rafı boşalıyor, satışı duruyor, bakımı işlemeye devam ediyor.
 * Ekonomi devam ederken oyuncu geriliyordu.
 *
 * Ölçüldü (F8, 5 tohum): medyan şirket değeri 38.103 ₺, p75 147.661 ₺.
 * Aradaki farkı yaratan yetenek değil, GİRİŞ SIKLIĞI.
 *
 * ★ Bu bir otomasyon değil, DELEGE EDİLMİŞ KARARdır: hedefi ve fiyat sınırını
 * oyuncu koyar, motor yalnız uygular. NPC'lerin yaptığının aynısını oyuncu
 * kendi şirketine söyleyebilir — ayrıcalık yok, kısayol yok.
 *
 * Emirler P6'da verilir ve bir SONRAKİ turun P2 fazında eşleşir; elle verilen
 * emirle aynı yoldan geçer, aynı tayına (R40) tabidir.
 */
export async function runStandingOrders(
  sql: Sql, tick: EngineTick,
): Promise<StandingOrderResult> {
  const out: StandingOrderResult = {
    rules: 0, buyOrders: 0, sellOrders: 0, skippedNoCash: 0, skippedLevelLocked: 0,
  };

  const rules = await sql<RuleRow[]>`
    SELECT so.id, so.company_id, so.facility_id, f.city_id, i.id AS inventory_id,
           so.product_id, p.code AS product_code, p.unlock_level AS product_unlock,
           c.level AS company_level, c.cash,
           so.kind, so.target_quantity, so.max_price, so.min_price,
           COALESCE(st.available, 0)::bigint AS on_hand,
           COALESCE(st.unit_cost, 0)::bigint AS unit_cost,
           COALESCE(st.quality, '70') AS quality,
           (i.capacity - i.used_capacity)::bigint AS free_capacity
      FROM standing_orders so
      JOIN companies c ON c.id = so.company_id AND c.status = 'ACTIVE'
      JOIN facilities f ON f.id = so.facility_id AND f.closed_at IS NULL
                       AND f.construction_complete_at_tick <= ${tick.seq}
      JOIN inventories i ON i.facility_id = f.id
      JOIN products p ON p.id = so.product_id AND p.is_active
      LEFT JOIN LATERAL (
        SELECT SUM(b.quantity - b.reserved_quantity)::bigint AS available,
               (SUM(b.quantity * b.unit_cost) / NULLIF(SUM(b.quantity), 0))::bigint AS unit_cost,
               (SUM(b.quantity * b.quality) / NULLIF(SUM(b.quantity), 0))::text AS quality
          FROM inventory_batches b
         WHERE b.inventory_id = i.id AND b.product_id = so.product_id
      ) st ON TRUE
     WHERE so.enabled
     ORDER BY so.company_id, so.id`;
  if (rules.length === 0) return out;

  const references = await loadReferencePrices(sql, tick.seq);
  const freight = await buildFreightTable(sql, tick);
  const openOrders = await loadOpenOrders(sql, rules.map((r) => r.facility_id));

  /* Nakit bir şirket için ORTAK kaynaktır: aynı turda üç kural aynı parayı
   * ayrı ayrı harcayamaz. Bütçe şirket bazında izlenir. */
  const budgets = new Map<string, bigint>();
  const reserveRatio = configValue<{ cashReserveRatio: number }>(
    tick, 'standing.orders', { cashReserveRatio: 0.15 },
  ).cashReserveRatio;

  for (const rule of rules) {
    out.rules++;

    // ★ Seviye kilidi elle verilen emirdeki gibi uygulanır: kalıcı emir
    //   oyuncuya kapalı bir ürünü açmaz.
    if (rule.company_level < rule.product_unlock) {
      out.skippedLevelLocked++;
      continue;
    }

    const reference = references.get(rule.product_id);
    if (!reference) continue;

    const key = `${rule.facility_id}:${rule.product_id}`;
    if (rule.kind === 'RESTOCK') {
      if (openOrders.has(`${key}:BUY`)) continue; // önceki emri hâlâ açık

      if (!budgets.has(rule.company_id)) {
        budgets.set(
          rule.company_id,
          rule.cash - BigInt(Math.round(Number(rule.cash) * reserveRatio)),
        );
      }
      const budget = budgets.get(rule.company_id)!;

      const decision = standingRestock({
        onHand: asQty(rule.on_hand),
        targetQuantity: asQty(rule.target_quantity),
        freeCapacity: asQty(rule.free_capacity),
        reference,
        freightAllowance: freight(rule.city_id, rule.product_id),
        maxPrice: rule.max_price === null ? null : asMoney(rule.max_price),
        budget: asMoney(budget > 0n ? budget : 0n),
      });
      if (!decision) {
        if (budget <= 0n) out.skippedNoCash++;
        continue;
      }

      await sql`
        INSERT INTO market_orders (company_id, facility_id, product_id, city_id, side,
                                   quantity, remaining_quantity, price_per_unit, quality,
                                   expires_at_tick)
        VALUES (${rule.company_id}::uuid, ${rule.facility_id}::uuid, ${rule.product_id},
                ${rule.city_id}, 'BUY', ${decision.quantity}, ${decision.quantity},
                ${decision.bidPrice}, '0.000', ${tick.seq + BigInt(TICKS_PER_DAY)})`;
      budgets.set(
        rule.company_id,
        budget - (decision.bidPrice * decision.quantity) / 1000n,
      );
      out.buyOrders++;
    } else {
      if (openOrders.has(`${key}:SELL`)) continue;

      const decision = standingSurplus({
        onHand: asQty(rule.on_hand),
        targetQuantity: asQty(rule.target_quantity),
        unitCost: asMoney(rule.unit_cost > 0n ? rule.unit_cost : reference / 2n),
        reference,
        minPrice: rule.min_price === null ? null : asMoney(rule.min_price),
      });
      if (!decision) continue;

      await sql`
        INSERT INTO market_orders (company_id, facility_id, product_id, city_id, side,
                                   quantity, remaining_quantity, price_per_unit, quality,
                                   expires_at_tick)
        VALUES (${rule.company_id}::uuid, ${rule.facility_id}::uuid, ${rule.product_id},
                ${rule.city_id}, 'SELL', ${decision.quantity}, ${decision.quantity},
                ${decision.askPrice}, ${Number(rule.quality).toFixed(3)},
                ${tick.seq + BigInt(TICKS_PER_DAY)})`;
      out.sellOrders++;
    }

    await sql`UPDATE standing_orders SET last_run_tick = ${tick.seq} WHERE id = ${rule.id}`;
  }

  return out;
}

/* ------------------------------------------------------------------ */

async function loadOpenOrders(sql: Sql, facilityIds: string[]): Promise<Set<string>> {
  if (facilityIds.length === 0) return new Set();
  const rows = await sql<{ facility_id: string; product_id: number; side: string }[]>`
    SELECT facility_id, product_id, side::text FROM market_orders
     WHERE facility_id = ANY(${facilityIds}::uuid[])
       AND status IN ('OPEN', 'PARTIAL') AND remaining_quantity > 0`;
  return new Set(rows.map((r) => `${r.facility_id}:${r.product_id}:${r.side}`));
}

/** Şehir × ürün navlun payı — NPC ve oyuncu tarafındakiyle aynı kural (R20). */
async function buildFreightTable(sql: Sql, tick: EngineTick) {
  const baseRate = asMoney(BigInt(configValue<{ baseRatePerKgDistance: string }>(
    tick, 'economy.shipping', { baseRatePerKgDistance: '3500' },
  ).baseRatePerKgDistance));

  const distances = await sql<{ origin_city_id: number; distance_index: number }[]>`
    SELECT origin_city_id, distance_index FROM city_distances`;
  const perCity = new Map<number, number[]>();
  for (const row of distances) {
    (perCity.get(row.origin_city_id) ?? perCity.set(row.origin_city_id, []).get(row.origin_city_id)!)
      .push(Number(row.distance_index));
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
