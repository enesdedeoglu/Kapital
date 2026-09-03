import { checkInvariants, type Sql } from '@kapital/db';
import { asMoney, formatMoney, toJson } from '@kapital/shared';
import type { EngineTick } from '../context.js';

export interface ClosePhaseResult {
  moneySupply: string;
  notifications: number;
  invariantsOk: boolean;
  violations: unknown[];
}

/**
 * P7 — KAPANIŞ. Ekonomi fotoğrafı, bildirimler, değişmez denetimi.
 *
 * Bildirimler `outbox`'a yazılır, doğrudan gönderilmez: tur transaction'ı
 * içinde push göndermek yasaktır (docs/06 §7).
 */
export async function runClosePhase(sql: Sql, tick: EngineTick): Promise<ClosePhaseResult> {
  const [supply] = await sql<{
    total: string; player: string; npc: string; faucet: string; sink: string; active: number;
  }[]>`
    SELECT
      COALESCE(SUM(cash) FILTER (WHERE kind <> 'SYSTEM'), 0)::text AS total,
      COALESCE(SUM(cash) FILTER (WHERE kind = 'PLAYER'), 0)::text  AS player,
      COALESCE(SUM(cash) FILTER (WHERE kind = 'NPC'), 0)::text     AS npc,
      COALESCE(-SUM(cash) FILTER (WHERE system_code = 'SYS_CONSUMER'), 0)::text AS faucet,
      COALESCE(SUM(cash) FILTER (WHERE system_code = 'SYS_SINK'), 0)::text      AS sink,
      COUNT(*) FILTER (WHERE kind <> 'SYSTEM' AND status = 'ACTIVE')::int       AS active
    FROM companies`;

  const [median] = await sql<{ value: bigint }[]>`
    SELECT COALESCE(
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY company_value), 0)::bigint AS value
    FROM companies WHERE kind = 'PLAYER' AND status = 'ACTIVE'`;

  await sql`
    INSERT INTO economy_snapshots (tick_id, total_money_supply, player_money, npc_money,
                                   faucet_in, sink_out, median_company_value, active_companies)
    VALUES (${tick.seq}, ${supply!.total}, ${supply!.player}, ${supply!.npc},
            ${supply!.faucet}, ${supply!.sink}, ${median!.value}, ${supply!.active})
    ON CONFLICT (tick_id) DO NOTHING`;

  // Satış yapan her şirkete tur özeti. dedupe_key idempotency sağlar.
  const sales = await sql<{ company_id: string; revenue: bigint; units: bigint; products: number }[]>`
    SELECT company_id, SUM(revenue)::bigint AS revenue, SUM(quantity)::bigint AS units,
           COUNT(DISTINCT product_id)::int AS products
    FROM retail_sales WHERE tick_id = ${tick.seq}
    GROUP BY company_id`;

  for (const row of sales) {
    await sql`
      INSERT INTO outbox (topic, payload, tick_id, dedupe_key)
      VALUES ('tick.sales', ${toJson({
        companyId: row.company_id,
        tickSeq: tick.seq.toString(),
        revenue: row.revenue.toString(),
        revenueFormatted: formatMoney(asMoney(row.revenue)),
        units: row.units.toString(),
        products: row.products,
      })}::text::jsonb, ${tick.seq}, ${`tick.sales:${tick.seq}:${row.company_id}`})
      ON CONFLICT (dedupe_key) DO NOTHING`;
  }

  // Stoğu tükenen açık raflar — "mağazan boş" uyarısı (madde 44)
  const depleted = await sql<{ company_id: string; facility_id: string; product_id: number }[]>`
    SELECT f.company_id, ro.facility_id, ro.product_id
    FROM retail_offers ro
    JOIN facilities f ON f.id = ro.facility_id AND f.closed_at IS NULL
    WHERE ro.enabled AND NOT EXISTS (
      SELECT 1 FROM inventories i
      JOIN inventory_batches b ON b.inventory_id = i.id AND b.product_id = ro.product_id
      WHERE i.facility_id = ro.facility_id AND b.quantity > b.reserved_quantity
    )`;
  for (const row of depleted) {
    await sql`
      INSERT INTO outbox (topic, payload, tick_id, dedupe_key)
      VALUES ('stock.depleted', ${toJson({
        companyId: row.company_id, facilityId: row.facility_id, productId: row.product_id,
        tickSeq: tick.seq.toString(),
      })}::text::jsonb, ${tick.seq}, ${`stock.depleted:${tick.seq}:${row.facility_id}:${row.product_id}`})
      ON CONFLICT (dedupe_key) DO NOTHING`;
  }

  const report = await checkInvariants(sql);

  return {
    moneySupply: supply!.total,
    notifications: sales.length + depleted.length,
    invariantsOk: report.ok,
    violations: report.violations,
  };
}
