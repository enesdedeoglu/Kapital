import type { Sql } from '@kapital/db';
import { smoothReference, weightedMedian, type PriceSample } from '@kapital/economy';
import { asMoney, asQty, TICKS_PER_DAY } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';

export interface SettlePhaseResult {
  pricedProducts: number;
  settledCompanies: number;
  shockedProducts: number;
}

/**
 * P5 — MUTABAKAT. Referans fiyatlar, şirket ve tesis finansalları, şirket değeri.
 *
 * P3'ten SONRA koşar: bu turun satışları fiyat oluşumuna girer ama çekicilik
 * formülünü etkilemez — döngü bir sonraki turda kapanır (R2).
 */
export async function runSettlePhase(sql: Sql, tick: EngineTick): Promise<SettlePhaseResult> {
  const pricing = configValue<{ emaAlpha: number; trimLowPct: number; trimHighPct: number; shockClampPct: number; referenceWindowTicks: number }>(
    tick, 'economy.pricing',
    { emaAlpha: 0.25, trimLowPct: 0.1, trimHighPct: 0.9, shockClampPct: 0.15, referenceWindowTicks: TICKS_PER_DAY },
  );
  const windowStart = tick.seq - BigInt(pricing.referenceWindowTicks);

  const products = await sql<{ id: number; base: bigint }[]>`
    SELECT id, base_reference_price AS base FROM products WHERE is_active`;

  let shocked = 0;
  for (const product of products) {
    const trades = await sql<{ price_per_unit: bigint; quantity: bigint }[]>`
      SELECT price_per_unit, quantity FROM market_trades
      WHERE product_id = ${product.id} AND tick_id > ${windowStart} AND tick_id <= ${tick.seq}
        AND NOT is_excluded_from_index`;

    const [prev] = await sql<{ ema: bigint }[]>`
      SELECT ema_reference AS ema FROM price_history
      WHERE product_id = ${product.id} AND city_id = 0 AND tick_id < ${tick.seq}
      ORDER BY tick_id DESC LIMIT 1`;
    const previousEma = asMoney(prev?.ema ?? product.base);

    const samples: PriceSample[] = trades.map((t) => ({
      price: asMoney(t.price_per_unit), quantity: asQty(t.quantity),
    }));
    const median = weightedMedian(samples, pricing.trimLowPct, pricing.trimHighPct) ?? previousEma;
    const smoothed = smoothReference(median, previousEma, pricing.emaAlpha, pricing.shockClampPct);
    if (smoothed.clamped) shocked++;

    const volume = samples.reduce((sum, s) => sum + (s.quantity as bigint), 0n);
    await sql`
      INSERT INTO price_history (tick_id, product_id, city_id, weighted_median, ema_reference,
                                 close_price, volume, trade_count)
      VALUES (${tick.seq}, ${product.id}, 0, ${median}, ${smoothed.value},
              ${median}, ${volume}, ${samples.length})
      ON CONFLICT (tick_id, product_id, city_id) DO NOTHING`;
  }

  // Tesis bazlı kâr/zarar — madde 46: oyuncu hangi tesisin kazandırdığını görmeli
  await sql`
    INSERT INTO facility_financials (tick_id, facility_id, company_id, revenue, cogs, maintenance, net_profit)
    SELECT ${tick.seq}, f.id, f.company_id,
           COALESCE(rs.revenue, 0), COALESCE(rs.cogs, 0), COALESCE(ft.maintenance_cost, 0),
           COALESCE(rs.revenue, 0) - COALESCE(rs.cogs, 0) - COALESCE(ft.maintenance_cost, 0)
    FROM facilities f
    JOIN facility_types ft ON ft.id = f.facility_type_id
    LEFT JOIN LATERAL (
      SELECT SUM(revenue)::bigint AS revenue, SUM(cogs)::bigint AS cogs
      FROM retail_sales WHERE tick_id = ${tick.seq} AND facility_id = f.id
    ) rs ON TRUE
    WHERE f.closed_at IS NULL
    ON CONFLICT (tick_id, facility_id) DO NOTHING`;

  // Şirket finansalları defterden türetilir — tek doğruluk kaynağı orası.
  const settled = await sql`
    INSERT INTO company_financials (tick_id, company_id, revenue, cogs, maintenance, capex, tax,
                                    net_profit, cash_close, inventory_value, facility_value,
                                    debt, company_value)
    SELECT ${tick.seq}, c.id,
           COALESCE(l.sales, 0), COALESCE(rs.cogs, 0), COALESCE(l.maintenance, 0),
           COALESCE(l.capex, 0), COALESCE(l.tax, 0),
           COALESCE(l.sales, 0) - COALESCE(rs.cogs, 0) - COALESCE(l.maintenance, 0) - COALESCE(l.tax, 0),
           c.cash, COALESCE(inv.value, 0), COALESCE(fac.value, 0), 0,
           c.cash + COALESCE(inv.value, 0) + COALESCE(fac.value, 0)
    FROM companies c
    LEFT JOIN LATERAL (
      SELECT SUM(amount) FILTER (WHERE account = 'SALES'       AND direction = 'CREDIT')::bigint AS sales,
             SUM(amount) FILTER (WHERE account = 'MAINTENANCE' AND direction = 'DEBIT')::bigint  AS maintenance,
             SUM(amount) FILTER (WHERE account = 'CAPEX'       AND direction = 'DEBIT')::bigint  AS capex,
             SUM(amount) FILTER (WHERE account = 'TAX'         AND direction = 'DEBIT')::bigint  AS tax
      FROM ledger_entries WHERE tick_id = ${tick.seq} AND company_id = c.id
    ) l ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(cogs)::bigint AS cogs FROM retail_sales
      WHERE tick_id = ${tick.seq} AND company_id = c.id
    ) rs ON TRUE
    -- ★ Stok, oyuncunun KENDİ satış fiyatıyla değil, piyasa referansıyla
    --   değerlenir (madde 41): aksi halde herkes fiyatı yükseltip şirket
    --   değerini yapay olarak şişirirdi.
    LEFT JOIN LATERAL (
      SELECT SUM(b.quantity * COALESCE(ph.ema_reference, p.base_reference_price) / 1000)::bigint AS value
      FROM inventories i
      JOIN inventory_batches b ON b.inventory_id = i.id
      JOIN products p ON p.id = b.product_id
      LEFT JOIN price_history ph
             ON ph.product_id = b.product_id AND ph.city_id = 0 AND ph.tick_id = ${tick.seq}
      WHERE i.company_id = c.id
    ) inv ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(ft.base_cost)::bigint AS value
      FROM facilities f JOIN facility_types ft ON ft.id = f.facility_type_id
      WHERE f.company_id = c.id AND f.closed_at IS NULL
    ) fac ON TRUE
    WHERE c.kind <> 'SYSTEM' AND c.status = 'ACTIVE'
    ON CONFLICT (tick_id, company_id) DO NOTHING
    RETURNING company_id`;

  await sql`
    UPDATE companies c SET company_value = cf.company_value
    FROM company_financials cf
    WHERE cf.tick_id = ${tick.seq} AND cf.company_id = c.id`;

  return { pricedProducts: products.length, settledCompanies: settled.length, shockedProducts: shocked };
}
