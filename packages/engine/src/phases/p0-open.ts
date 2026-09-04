import type { Sql } from '@kapital/db';
import { mulMoney, qtyFromNumber } from '@kapital/shared';
import { runWorldEvents } from './world-events.js';
import { configValue, type EngineTick } from '../context.js';
import { loadReferencePrices } from '../reference-prices.js';
import { computeForeignCapacity } from './foreign-capacity.js';

export interface OpenPhaseResult {
  expiredOrders: number;
  worldEvents: { active: number; started: number; ended: number };
  completedConstructions: number;
  npcOffersRefreshed: number;
  foreignProducts: number;
}

interface SimpleSeller {
  name: string; cityCode: string; productCode: string;
  priceMult: number; supplyPerTick: number; quality: number;
}

/**
 * P0 — AÇILIŞ. Turun sabitleri burada dondurulur (config anlık görüntüsü,
 * rng tohumu, mevsim) ve süresi dolmuş kayıtlar temizlenir.
 */
export async function runOpenPhase(sql: Sql, tick: EngineTick): Promise<OpenPhaseResult> {
  /*
   * ★ Dünya olayları EN BAŞTA koşar (docs/05 §P0.2): "Aktif world_events
   * çarpanlarını hesapla ve tick context'ine yaz". Olay bu turun üretimini ve
   * talebini etkiler, dolayısıyla P1'den önce yerini almalıdır.
   */
  const worldEvents = await runWorldEvents(sql, tick);

  const expired = await sql`
    UPDATE market_orders SET status = 'EXPIRED'
    WHERE status IN ('OPEN','PARTIAL') AND expires_at_tick <= ${tick.seq}
    RETURNING id`;

  // İnşaatı biten tesisler: zaman karşılaştırmasıyla kendiliğinden kullanılır
  // hale gelir; burada yalnız bildirim için sayılır.
  const completed = await sql`
    SELECT id FROM facilities
    WHERE closed_at IS NULL AND construction_complete_at_tick = ${tick.seq}`;

  const npcOffersRefreshed = await refreshNpcSupply(sql, tick);

  // Dış ticaret derinliği turun başında sabitlenir: oyuncular tur boyunca
  // aynı tavanı pro-rata paylaşır, tur zamanlaması yarışı oluşmaz (R17).
  const foreign = await computeForeignCapacity(sql, tick);

  return {
    expiredOrders: expired.length,
    worldEvents,
    completedConstructions: completed.length,
    npcOffersRefreshed,
    foreignProducts: foreign.products,
  };
}

/**
 * MVP-0 NPC arzı: sabit fiyatlı, her tur tazelenen SELL emirleri.
 *
 * Bu tam bir NPC ajanı DEĞİLDİR — kâr güdüsü, stok yönetimi ve ±%3 fiyat
 * bandı F6'da gelir. Buradaki tek amaç, oyuncunun alabileceği bir arzın
 * var olması (docs/08 MVP-0).
 */
async function refreshNpcSupply(sql: Sql, tick: EngineTick): Promise<number> {
  // Gerçek NPC ajanları varsa (F6) basit satıcılara gerek yok: arzı onlar
  // sağlar. Basit satıcılar yalnız MVP-0 dünyası için bir iskeledir.
  const [real] = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM npc_profiles`;
  if ((real?.count ?? 0n) > 0n) return 0;

  const sellers = configValue<SimpleSeller[]>(tick, 'npc.simpleSellers', []);
  if (sellers.length === 0) return 0;

  const references = await loadReferencePrices(sql, tick.seq);
  let refreshed = 0;

  for (const seller of sellers) {
    const [row] = await sql<{ company_id: string; city_id: number; product_id: number }[]>`
      SELECT c.id AS company_id, ct.id AS city_id, p.id AS product_id
      FROM companies c, cities ct, products p
      WHERE c.name = ${seller.name} AND c.kind = 'NPC'
        AND ct.code = ${seller.cityCode} AND p.code = ${seller.productCode}`;
    if (!row) continue;

    const reference = references.get(row.product_id);
    if (!reference) continue;
    const price = mulMoney(reference, seller.priceMult).value;
    const supply = qtyFromNumber(seller.supplyPerTick);

    // Var olan emri tazele; yoksa aç. Emir başına tek satır tutulur.
    const updated = await sql`
      UPDATE market_orders
         SET remaining_quantity = ${supply}, quantity = ${supply},
             price_per_unit = ${price}, status = 'OPEN',
             expires_at_tick = ${tick.seq + 96n}
       WHERE company_id = ${row.company_id}::uuid AND product_id = ${row.product_id}
         AND city_id = ${row.city_id} AND side = 'SELL'
      RETURNING id`;

    if (updated.length === 0) {
      await sql`
        INSERT INTO market_orders (company_id, product_id, city_id, side, quantity,
                                   remaining_quantity, price_per_unit, quality, expires_at_tick)
        VALUES (${row.company_id}::uuid, ${row.product_id}, ${row.city_id}, 'SELL',
                ${supply}, ${supply}, ${price}, ${String(seller.quality)}, ${tick.seq + 96n})`;
    }
    refreshed++;
  }
  return refreshed;
}
