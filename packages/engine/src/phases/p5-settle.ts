import type { Sql } from '@kapital/db';
import { nextFxRate, smoothReference, weightedMedian, type PriceSample } from '@kapital/economy';
import { asMoney, asQty, TICKS_PER_DAY } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';
import { detectWashTrades } from './wash-trade.js';

export interface SettlePhaseResult {
  pricedProducts: number;
  settledCompanies: number;
  shockedProducts: number;
  flaggedPairs: number;
  excludedTrades: number;
  gameCpi: number;
  fxRate: bigint;
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

  // ★ Wash trade tespiti MEDYANDAN ÖNCE koşar: işaretlenen işlemler endekse
  //   girmez. Sıra tersine dönerse manipüle edilmiş fiyat referansa sızar (R8).
  const washCfg = configValue<{ bilateralShareThreshold: number; priceDeviationThreshold: number }>(
    tick, 'market.washTrade', { bilateralShareThreshold: 0.30, priceDeviationThreshold: 0.20 },
  );
  const wash = await detectWashTrades(sql, tick, {
    bilateralShareThreshold: washCfg.bilateralShareThreshold,
    priceDeviationThreshold: washCfg.priceDeviationThreshold,
    windowTicks: pricing.referenceWindowTicks,
  });

  const liquidity = configValue<{ liquidityDiscountThreshold: number; liquidityDiscountPct: number }>(
    tick, 'economy.inventory', { liquidityDiscountThreshold: 0.2, liquidityDiscountPct: 0.5 },
  );
  const liq = { threshold: liquidity.liquidityDiscountThreshold, discount: liquidity.liquidityDiscountPct };

  const products = await sql<{ id: number; base: bigint }[]>`
    SELECT id, base_reference_price AS base FROM products WHERE is_active
     ORDER BY id`;

  let shocked = 0;
  for (const product of products) {
    const trades = await sql<{ price_per_unit: bigint; quantity: bigint }[]>`
      SELECT price_per_unit, quantity FROM market_trades
      WHERE product_id = ${product.id} AND tick_id > ${windowStart} AND tick_id <= ${tick.seq}
        AND NOT is_excluded_from_index
      -- ★ Sira GARANTILI olmali (R79): weightedMedian kirpma ve medyan
      -- taramasini bu sirayla yapar, esit fiyatta girdi sirasi sonucu belirler.
      ORDER BY price_per_unit, quantity`;

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

  // Game CPI — perakende ürünlerinin talep ağırlıklı fiyat endeksi (madde 35).
  // Kur modelinin PPP çıpası buna dayanır (docs/12 §4).
  const [cpiRow] = await sql<{ cpi: number }[]>`
    SELECT COALESCE(
      SUM(COALESCE(ph.ema_reference, p.base_reference_price) * p.base_demand)::double precision
      / NULLIF(SUM(p.base_reference_price * p.base_demand), 0), 1) AS cpi
    FROM products p
    LEFT JOIN price_history ph
           ON ph.product_id = p.id AND ph.city_id = 0 AND ph.tick_id = ${tick.seq}
    WHERE p.is_active AND p.is_retail_product AND p.base_demand > 0`;
  const gameCpi = cpiRow?.cpi ?? 1;

  const fxRate = await updateFxRate(sql, tick, gameCpi, windowStart);

  /*
   * Tesis bazlı kâr/zarar — madde 46: oyuncu hangi tesisin kazandırdığını
   * görmeli.
   *
   * ★ TOPTAN SATIŞ da tesise yazılır. Önceden yalnız `retail_sales` sayılıyordu;
   * sonuç olarak ÜRETEN her tesis "ciro 0, zarar = bakım" görünüyordu. F8
   * ölçümünde on üretim tipinin onu da eksi çıktı ve tesis ROI tablosu
   * anlamsızlaştı — oysa o tesisler mallarını toptan piyasada satıyordu.
   *
   * `market_trades`in satıcı TESİSİ yok, yalnız satıcı şirketi var; satış
   * emri üzerinden bağlanır (`market_orders.facility_id`).
   *
   * Üreticinin maliyeti üretim kaydından gelir: girdi bedeli `cogs`e,
   * işçilik+enerji `salary`e yazılır. Bu bir tahakkuk yaklaşımıdır (bu turda
   * ÜRETİLENİN maliyeti, bu turda SATILANIN değil) — şirket düzeyindeki
   * hesapla aynı basitleştirme.
   */
  await sql`
    INSERT INTO facility_financials (tick_id, facility_id, company_id, revenue, cogs,
                                     salary, shipping, maintenance, net_profit)
    SELECT ${tick.seq}, f.id, f.company_id,
           COALESCE(rs.revenue, 0) + COALESCE(ws.revenue, 0),
           COALESCE(rs.cogs, 0) + COALESCE(pr.input_cost, 0),
           COALESCE(pr.overhead, 0),
           COALESCE(wb.shipping, 0),
           COALESCE(ft.maintenance_cost, 0),
           COALESCE(rs.revenue, 0) + COALESCE(ws.revenue, 0)
             - COALESCE(rs.cogs, 0) - COALESCE(pr.input_cost, 0)
             - COALESCE(pr.overhead, 0) - COALESCE(wb.shipping, 0)
             - COALESCE(ft.maintenance_cost, 0)
    FROM facilities f
    JOIN facility_types ft ON ft.id = f.facility_type_id
    LEFT JOIN LATERAL (
      SELECT SUM(revenue)::bigint AS revenue, SUM(cogs)::bigint AS cogs
      FROM retail_sales WHERE tick_id = ${tick.seq} AND facility_id = f.id
    ) rs ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(t.quantity * t.price_per_unit / 1000)::bigint AS revenue
      FROM market_trades t JOIN market_orders o ON o.id = t.sell_order_id
      WHERE t.tick_id = ${tick.seq} AND o.facility_id = f.id
    ) ws ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(t.shipping_cost)::bigint AS shipping
      FROM market_trades t JOIN market_orders o ON o.id = t.buy_order_id
      WHERE t.tick_id = ${tick.seq} AND o.facility_id = f.id
    ) wb ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(input_cost)::bigint AS input_cost, SUM(overhead_cost)::bigint AS overhead
      FROM production_records WHERE tick_id = ${tick.seq} AND facility_id = f.id
    ) pr ON TRUE
    WHERE f.closed_at IS NULL
    ON CONFLICT (tick_id, facility_id) DO NOTHING`;

  // Şirket finansalları defterden türetilir — tek doğruluk kaynağı orası.
  const settled = await sql`
    INSERT INTO company_financials (tick_id, company_id, revenue, cogs, maintenance, capex, tax,
                                    interest_cost, net_profit, cash_close, inventory_value,
                                    facility_value, debt, company_value)
    SELECT ${tick.seq}, c.id,
           COALESCE(l.sales, 0), COALESCE(rs.cogs, 0), COALESCE(l.maintenance, 0),
           COALESCE(l.capex, 0), COALESCE(l.tax, 0), COALESCE(l.interest, 0),
           COALESCE(l.sales, 0) - COALESCE(rs.cogs, 0) - COALESCE(l.maintenance, 0)
             - COALESCE(l.tax, 0) - COALESCE(l.interest, 0) - COALESCE(l.shipping, 0),
           c.cash, COALESCE(inv.value, 0), COALESCE(fac.value, 0), COALESCE(debt.total, 0),
           -- ★ Şirket değeri BORCU DÜŞER (madde 41): kredi çeken oyuncunun
           --   değeri artmaz, yalnız nakdi artar ve borcu birebir düşülür.
           c.cash + COALESCE(inv.value, 0) + COALESCE(fac.value, 0) - COALESCE(debt.total, 0)
    FROM companies c
    LEFT JOIN LATERAL (
      SELECT SUM(amount) FILTER (WHERE account = 'SALES'       AND direction = 'CREDIT')::bigint AS sales,
             SUM(amount) FILTER (WHERE account = 'MAINTENANCE' AND direction = 'DEBIT')::bigint  AS maintenance,
             SUM(amount) FILTER (WHERE account = 'CAPEX'       AND direction = 'DEBIT')::bigint  AS capex,
             SUM(amount) FILTER (WHERE account = 'TAX'         AND direction = 'DEBIT')::bigint  AS tax,
             SUM(amount) FILTER (WHERE account = 'INTEREST'    AND direction = 'DEBIT')::bigint  AS interest,
             SUM(amount) FILTER (WHERE account = 'SHIPPING'    AND direction = 'DEBIT')::bigint  AS shipping
      FROM ledger_entries WHERE tick_id = ${tick.seq} AND company_id = c.id AND currency = 'TRY'
    ) l ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(remaining_balance)::bigint AS total FROM loans
      WHERE company_id = c.id AND status = 'ACTIVE'
    ) debt ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(cogs)::bigint AS cogs FROM retail_sales
      WHERE tick_id = ${tick.seq} AND company_id = c.id
    ) rs ON TRUE
    -- ★ Stok, oyuncunun KENDİ satış fiyatıyla değil, piyasa referansıyla
    --   değerlenir (madde 41): aksi halde herkes fiyatı yükseltip şirket
    --   değerini yapay olarak şişirirdi.
    -- ★ LİKİDİTE İSKONTOSU (docs/11 C3): 24 saatlik hacmin belirli bir oranını
    --   aşan stok, aşan kısımda iskontolu değerlenir. Aksi halde tüm piyasayı
    --   stoklayan oyuncu, satamayacağı malla sıralamayı ele geçirirdi.
    LEFT JOIN LATERAL (
      SELECT SUM(
        CASE
          WHEN v.volume > 0 AND pq.qty > v.volume * ${liq.threshold}
            THEN (v.volume * ${liq.threshold} * pq.price / 1000)
               + ((pq.qty - v.volume * ${liq.threshold}) * pq.price
                  * ${1 - liq.discount} / 1000)
          ELSE pq.qty * pq.price / 1000
        END
      )::bigint AS value
      FROM (
        SELECT b.product_id, SUM(b.quantity) AS qty,
               MAX(COALESCE(ph.ema_reference, p.base_reference_price)) AS price
        FROM inventories i
        JOIN inventory_batches b ON b.inventory_id = i.id
        JOIN products p ON p.id = b.product_id
        LEFT JOIN price_history ph
               ON ph.product_id = b.product_id AND ph.city_id = 0 AND ph.tick_id = ${tick.seq}
        WHERE i.company_id = c.id
        GROUP BY b.product_id
      ) pq
      LEFT JOIN (
        SELECT product_id, SUM(quantity) AS volume FROM market_trades
        WHERE tick_id > ${windowStart} AND tick_id <= ${tick.seq}
        GROUP BY product_id
      ) v ON v.product_id = pq.product_id
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

  return {
    pricedProducts: products.length,
    settledCompanies: settled.length,
    shockedProducts: shocked,
    flaggedPairs: wash.flaggedPairs,
    excludedTrades: wash.excludedTrades,
    gameCpi,
    fxRate,
  };
}

/**
 * Kur modeli — docs/12 §4 (S2). Kur hiçbir oyuncu tarafından belirlenmez;
 * satın alma gücü paritesi çıpası ve ticaret dengesinden türer.
 */
async function updateFxRate(
  sql: Sql, tick: EngineTick, gameCpi: number, windowStart: bigint,
): Promise<bigint> {
  const fx = configValue<{
    rate0: number; alpha: number; tradeBalanceK: number; clampPerTick: number;
  }>(tick, 'economy.fx', { rate0: 35, alpha: 0.05, tradeBalanceK: 0.02, clampPerTick: 0.005 });

  const baseRate = asMoney(BigInt(Math.round(fx.rate0 * 10_000)));
  const [previous] = await sql<{ rate: bigint }[]>`
    SELECT rate_try_per_usd AS rate FROM fx_rates
    WHERE tick_id < ${tick.seq} ORDER BY tick_id DESC LIMIT 1`;

  const [balance] = await sql<{ exports: string; imports: string }[]>`
    SELECT COALESCE(SUM(try_equivalent) FILTER (WHERE direction = 'EXPORT'), 0)::text AS exports,
           COALESCE(SUM(try_equivalent) FILTER (WHERE direction = 'IMPORT'), 0)::text AS imports
    FROM foreign_trades WHERE tick_id > ${windowStart} AND tick_id <= ${tick.seq}`;
  const ex = Number(balance?.exports ?? '0');
  const im = Number(balance?.imports ?? '0');
  const tradeBalance = ex + im > 0 ? (ex - im) / (ex + im) : 0;

  const { rate } = nextFxRate({
    previousRate: asMoney(previous?.rate ?? baseRate),
    baseRate,
    gameCpi,
    tradeBalance,
    alpha: fx.alpha,
    tradeBalanceK: fx.tradeBalanceK,
    clampPerTick: fx.clampPerTick,
  });

  const [circulation] = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(usd_balance), 0)::text AS total FROM companies WHERE kind <> 'SYSTEM'`;

  await sql`
    INSERT INTO fx_rates (tick_id, rate_try_per_usd, source, trade_balance,
                          usd_in_circulation, game_cpi)
    VALUES (${tick.seq}, ${rate}, 'MODEL', ${Math.round((ex - im))},
            ${circulation!.total}, ${gameCpi})
    ON CONFLICT (tick_id) DO NOTHING`;

  return rate as bigint;
}
