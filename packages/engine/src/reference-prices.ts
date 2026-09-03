import { asMoney, type Money } from '@kapital/shared';
import type { Sql } from '@kapital/db';

export type ReferencePrices = ReadonlyMap<number, Money>;

/**
 * Ürün referans fiyatları — çekicilik formülünün girdisi.
 *
 * ★ R2: BİR ÖNCEKİ turun EMA değeri okunur (`tick_id < seq`). Aynı turda
 * hesaplanan medyan kullanılsaydı döngü kapanır ve sistem osilatöre dönerdi:
 *   referans → çekicilik → satış → işlem → referans
 *
 * Hiç işlem geçmemiş ürün için `products.base_reference_price` denge çıpasıdır.
 */
export async function loadReferencePrices(sql: Sql, tickSeq: bigint): Promise<ReferencePrices> {
  const rows = await sql<{ product_id: number; price: bigint }[]>`
    SELECT p.id AS product_id,
           COALESCE(h.ema_reference, p.base_reference_price) AS price
    FROM products p
    LEFT JOIN LATERAL (
      SELECT ema_reference FROM price_history
      WHERE product_id = p.id AND city_id = 0 AND tick_id < ${tickSeq}
      ORDER BY tick_id DESC LIMIT 1
    ) h ON TRUE
    WHERE p.is_active`;
  return new Map(rows.map((r) => [r.product_id, asMoney(r.price)]));
}
