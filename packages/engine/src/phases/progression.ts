import type { Sql } from '@kapital/db';
import {
  experienceGain, nextLevel, DEFAULT_EXPERIENCE_RATES,
  type ExperienceRates, type LevelRequirement,
} from '@kapital/economy';
import { asMoney, asQty } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';

export interface ProgressionResult {
  companies: number;
  experienceAwarded: number;
  levelUps: number;
}

/**
 * SEVİYE İLERLEYİŞİ — madde 11.
 *
 * ★ F8'e kadar hiç uygulanmamıştı: `company_levels` tohumlanıyor ve şirket
 * ekranında gösteriliyordu ama `companies.level` yalnız testlerde elle
 * değişiyordu. Oyuncular kalıcı olarak seviye 1'de kalıyor, ürünlerin ve
 * tesislerin çoğu hiç açılmıyordu. Denge kapısı bunu ortaya çıkardı.
 *
 * P7'de (CLOSE) koşar: şirket değeri P5'te hesaplanıp `company_financials`e
 * yazılmış olur, seviye şartı ona bakar.
 *
 * NPC'ler dışarıda tutulur: onların seviyesi tohumda sabittir ve ilerleme
 * mekaniği oyuncu deneyimi içindir.
 */
export async function runProgression(sql: Sql, tick: EngineTick): Promise<ProgressionResult> {
  const rates = configValue<ExperienceRates>(
    tick, 'progression.experience', DEFAULT_EXPERIENCE_RATES,
  );

  const requirements = await sql<LevelRequirement[]>`
    SELECT level, required_xp AS "requiredXp",
           required_company_value AS "requiredCompanyValue",
           required_trade_volume AS "requiredTradeVolume",
           required_units_produced AS "requiredUnitsProduced",
           required_distinct_products AS "requiredDistinctProducts"
      FROM company_levels ORDER BY level`;
  if (requirements.length === 0) return { companies: 0, experienceAwarded: 0, levelUps: 0 };

  // Bu turun faaliyeti: perakende cirosu, toptan hacim, üretim, yeni tesis.
  const rows = await sql<{
    company_id: string; level: number; experience: bigint;
    retail: bigint; trade: bigint; produced: bigint; built: number;
    company_value: bigint; total_trade: bigint; total_produced: bigint; distinct_products: number;
  }[]>`
    SELECT c.id AS company_id, c.level, s.experience,
           COALESCE(r.revenue, 0)::bigint AS retail,
           COALESCE(t.volume, 0)::bigint AS trade,
           COALESCE(p.produced, 0)::bigint AS produced,
           COALESCE(b.built, 0)::int AS built,
           COALESCE(cf.company_value, c.company_value)::bigint AS company_value,
           s.total_trade_volume AS total_trade,
           s.total_units_produced AS total_produced,
           COALESCE(cp.count, 0)::int AS distinct_products
      FROM companies c
      JOIN company_stats s ON s.company_id = c.id
      LEFT JOIN (SELECT company_id, SUM(revenue) AS revenue FROM retail_sales
                  WHERE tick_id = ${tick.seq} GROUP BY 1) r ON r.company_id = c.id
      LEFT JOIN (SELECT company_id, SUM(volume) AS volume FROM (
                   SELECT buyer_company_id AS company_id, quantity * price_per_unit / 1000 AS volume
                     FROM market_trades WHERE tick_id = ${tick.seq}
                   UNION ALL
                   SELECT seller_company_id, quantity * price_per_unit / 1000
                     FROM market_trades WHERE tick_id = ${tick.seq}
                 ) x GROUP BY 1) t ON t.company_id = c.id
      LEFT JOIN (SELECT company_id, SUM(produced) AS produced FROM production_records
                  WHERE tick_id = ${tick.seq} GROUP BY 1) p ON p.company_id = c.id
      LEFT JOIN (SELECT company_id, COUNT(*) AS built FROM facilities
                  WHERE created_at > now() - interval '1 hour'
                    AND construction_complete_at_tick = ${tick.seq} GROUP BY 1) b ON b.company_id = c.id
      LEFT JOIN company_financials cf ON cf.company_id = c.id AND cf.tick_id = ${tick.seq}
      LEFT JOIN (SELECT company_id, COUNT(*) AS count FROM company_products
                  GROUP BY 1) cp ON cp.company_id = c.id
     WHERE c.kind = 'PLAYER' AND c.status = 'ACTIVE'`;

  const out: ProgressionResult = { companies: rows.length, experienceAwarded: 0, levelUps: 0 };

  for (const row of rows) {
    const gain = experienceGain({
      retailRevenue: asMoney(row.retail),
      tradeVolume: asMoney(row.trade),
      unitsProduced: asQty(row.produced),
      facilitiesBuilt: row.built,
    }, rates);

    const experience = row.experience + BigInt(gain);
    const level = nextLevel({
      level: row.level,
      experience,
      companyValue: row.company_value,
      tradeVolume: row.total_trade,
      unitsProduced: row.total_produced,
      distinctProducts: row.distinct_products,
    }, requirements);

    if (gain === 0 && level === row.level) continue;
    out.experienceAwarded += gain;

    if (gain > 0) {
      // ★ `distinct_products_produced`, `total_retail_revenue` ve
      //   `peak_company_value` F8'e kadar hiç güncellenmiyordu; ilki bir
      //   seviye şartı, diğerleri şirket ekranının kaynağı.
      await sql`
        UPDATE company_stats
           SET experience = ${experience},
               distinct_products_produced = ${row.distinct_products},
               total_retail_revenue = total_retail_revenue + ${row.retail},
               peak_company_value = GREATEST(peak_company_value, ${row.company_value}),
               distinct_cities = (SELECT COUNT(DISTINCT city_id) FROM facilities
                                   WHERE company_id = ${row.company_id}::uuid
                                     AND closed_at IS NULL)
         WHERE company_id = ${row.company_id}::uuid`;
    }
    if (level > row.level) {
      await sql`UPDATE companies SET level = ${level} WHERE id = ${row.company_id}::uuid`;
      await sql`UPDATE company_stats SET last_level_up_tick = ${tick.seq}
                 WHERE company_id = ${row.company_id}::uuid`;
      await sql`
        INSERT INTO outbox (topic, payload, tick_id, dedupe_key)
        VALUES ('company.level_up',
                ${JSON.stringify({ companyId: row.company_id, level })}::text::jsonb,
                ${tick.seq}, ${`levelup:${row.company_id}:${level}`})
        ON CONFLICT (dedupe_key) DO NOTHING`;
      out.levelUps++;
    }
  }

  return out;
}
