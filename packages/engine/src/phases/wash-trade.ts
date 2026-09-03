import type { Sql } from '@kapital/db';
import type { EngineTick } from '../context.js';

export interface WashTradeConfig {
  /** İkilinin toplam hacim içindeki payı bu oranı aşarsa şüpheli. */
  readonly bilateralShareThreshold: number;
  /** Fiyatın medyandan sapması bu oranı aşarsa şüpheli. */
  readonly priceDeviationThreshold: number;
  /** İnceleme penceresi (tur). */
  readonly windowTicks: number;
}

export interface WashTradeResult {
  flaggedPairs: number;
  excludedTrades: number;
}

/**
 * Wash trade tespiti — madde 48, risk R8.
 *
 * İki oyuncu birbirine 1.000 ₺'den çelik satıp alırsa referans fiyat şişer,
 * stok değerlemesi (dolayısıyla şirket değeri ve sıralama) yapay olarak patlar.
 *
 * ★ İşlem İPTAL EDİLMEZ. Oyuncular ticaretini yapar; yalnız referans fiyat
 * endeksini kirletemez (madde 48: "gerçek ticareti gereksiz yere engelleme").
 *
 * Şüphe iki koşulun BİRLİKTE sağlanmasıyla oluşur:
 *   1. İkilinin karşılıklı hacmi, o üründeki toplam hacmin belirli bir payını aşıyor
 *   2. İşlem fiyatı piyasa medyanından belirgin sapıyor
 *
 * Tek başına yüksek hacim şüpheli değildir: büyük bir üretici ile büyük bir
 * perakendecinin düzenli ticareti meşrudur.
 */
export async function detectWashTrades(
  sql: Sql,
  tick: EngineTick,
  config: WashTradeConfig,
): Promise<WashTradeResult> {
  const windowStart = tick.seq - BigInt(config.windowTicks);

  const suspects = await sql<{
    company_a: string; company_b: string; product_id: number;
    bilateral: bigint; market_volume: bigint; share: number;
    median_price: bigint; pair_price: bigint; deviation: number;
  }[]>`
    WITH window_trades AS (
      SELECT product_id, buyer_company_id, seller_company_id, quantity, price_per_unit
      FROM market_trades
      WHERE tick_id > ${windowStart} AND tick_id <= ${tick.seq}
    ),
    market AS (
      SELECT product_id,
             SUM(quantity)::bigint AS volume,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_unit)::bigint AS median_price
      FROM window_trades GROUP BY product_id
    ),
    -- İkili yön bağımsız: (A,B) ve (B,A) aynı ikilidir
    pairs AS (
      SELECT product_id,
             LEAST(buyer_company_id::text, seller_company_id::text)    AS company_a,
             GREATEST(buyer_company_id::text, seller_company_id::text) AS company_b,
             SUM(quantity)::bigint AS bilateral,
             (SUM(quantity * price_per_unit) / SUM(quantity))::bigint AS pair_price
      FROM window_trades
      GROUP BY product_id, 2, 3
    )
    SELECT p.company_a, p.company_b, p.product_id, p.bilateral,
           m.volume AS market_volume,
           (p.bilateral::double precision / NULLIF(m.volume, 0)) AS share,
           m.median_price, p.pair_price,
           ABS(p.pair_price - m.median_price)::double precision / NULLIF(m.median_price, 0) AS deviation
    FROM pairs p JOIN market m ON m.product_id = p.product_id
    WHERE m.volume > 0
      AND p.bilateral::double precision / m.volume > ${config.bilateralShareThreshold}
      AND ABS(p.pair_price - m.median_price)::double precision
          / NULLIF(m.median_price, 0) > ${config.priceDeviationThreshold}`;

  let excluded = 0;
  for (const suspect of suspects) {
    const marked = await sql`
      UPDATE market_trades SET is_excluded_from_index = TRUE
       WHERE tick_id > ${windowStart} AND tick_id <= ${tick.seq}
         AND product_id = ${suspect.product_id}
         AND LEAST(buyer_company_id::text, seller_company_id::text) = ${suspect.company_a}
         AND GREATEST(buyer_company_id::text, seller_company_id::text) = ${suspect.company_b}
         AND NOT is_excluded_from_index
      RETURNING id`;
    excluded += marked.length;

    await sql`
      INSERT INTO trade_flags (tick_id, company_a, company_b, product_id, window_start_tick,
                               bilateral_volume, market_volume, bilateral_share,
                               price_deviation_pct, suspicion_score)
      VALUES (${tick.seq}, ${suspect.company_a}::uuid, ${suspect.company_b}::uuid,
              ${suspect.product_id}, ${windowStart}, ${suspect.bilateral},
              ${suspect.market_volume}, ${suspect.share}, ${suspect.deviation},
              ${Math.min(1, suspect.share * suspect.deviation)})`;
  }

  return { flaggedPairs: suspects.length, excludedTrades: excluded };
}
