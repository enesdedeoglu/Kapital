/**
 * Denge kapısı metrikleri — madde 56, docs/08 sonu.
 *
 * Bu eşikler tutmadan kapalı beta açılmaz. Her metrik ölçülür, eşikle
 * karşılaştırılır ve GEÇTİ/KALDI olarak raporlanır — "yaklaşık tuttu" diye
 * bir sonuç yoktur.
 */
import type { Sql } from '@kapital/db';

export interface MetricResult {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly formatted: string;
  readonly target: string;
  readonly pass: boolean | null;
  /** Ölçülemedi ise nedeni — eşik "kaldı" sayılmaz, "ölçülemedi" olur. */
  readonly note?: string;
}

export interface MetricInput {
  readonly firstTick: bigint;
  readonly lastTick: bigint;
  /** Tur süreleri (ms) — p95 için. */
  readonly tickDurations: readonly number[];
  /** Oyuncu şirketlerinin kuruluş anındaki toplam sayısı. */
  readonly initialPlayers: number;
}

const pct = (v: number) => `%${(v * 100).toFixed(1)}`;
const tl = (v: number) => `${v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺`;

export async function collectMetrics(sql: Sql, input: MetricInput): Promise<MetricResult[]> {
  const out: MetricResult[] = [];
  const { firstTick, lastTick } = input;
  const day = 96n;

  /* --- 1. Arz / talep oranı --------------------------------------------- */
  const sd = await sql<{ code: string; ratio: number }[]>`
    SELECT p.code,
           (h.supply_units::float8 / NULLIF(h.demand_units, 0)) AS ratio
      FROM market_health h JOIN products p ON p.id = h.product_id
     WHERE h.city_id = 0 AND h.tick_id = ${lastTick} AND h.demand_units > 0`;
  const inBand = sd.filter((r) => r.ratio >= 0.85 && r.ratio <= 1.15).length;
  const sdShare = sd.length > 0 ? inBand / sd.length : null;
  out.push({
    key: 'supply_demand', label: 'Arz/talep bandında olan ürün payı',
    value: sdShare,
    formatted: sdShare === null ? '—' : `${inBand}/${sd.length} (${pct(sdShare)})`,
    target: 'çoğu ürün 0,85–1,15', pass: sdShare === null ? null : sdShare >= 0.5,
    note: sd.length === 0 ? 'talebi olan ürün yok' : undefined,
  });

  /* --- 2. Fiyat volatilitesi (24 saat) ---------------------------------- */
  const [vol] = await sql<{ median: number | null }[]>`
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v) AS median FROM (
      SELECT CASE WHEN AVG(weighted_median) > 0
                  THEN COALESCE(STDDEV_POP(weighted_median), 0) / AVG(weighted_median)
                  ELSE NULL END AS v
        FROM price_history
       WHERE city_id = 0 AND tick_id > ${lastTick - day} AND weighted_median > 0
       GROUP BY product_id
    ) t`;
  const volatility = vol?.median ?? null;
  out.push({
    key: 'volatility', label: 'Fiyat volatilitesi (24s, medyan ürün)',
    value: volatility, formatted: volatility === null ? '—' : pct(volatility),
    target: '%5 – %15',
    pass: volatility === null ? null : volatility >= 0.05 && volatility <= 0.15,
  });

  /* --- 3. NPC payı ------------------------------------------------------- */
  const [share] = await sql<{ npc: number | null }[]>`
    SELECT SUM(pr.produced) FILTER (WHERE c.kind = 'NPC')::float8
           / NULLIF(SUM(pr.produced), 0) AS npc
      FROM production_records pr JOIN companies c ON c.id = pr.company_id
     WHERE pr.tick_id > ${lastTick - day}`;
  const npcShare = share?.npc ?? null;
  out.push({
    key: 'npc_share', label: 'NPC üretim payı',
    value: npcShare, formatted: npcShare === null ? '—' : pct(npcShare),
    target: '%60 – %80',
    pass: npcShare === null ? null : npcShare >= 0.60 && npcShare <= 0.80,
  });

  /* --- 4. İlk gün AKTİF oyuncu şirket büyümesi --------------------------
   *
   * ★ Eşik madde 56'da "ilk gün AKTİF oyuncu şirket büyümesi" olarak yazılı.
   * Pasif oyuncu nüfusun kalıcı bir parçasıdır (simülasyonda %28) ve günde bir
   * kez karar verir; onu ölçüme katmak eşiği tanımı gereği tutturulamaz yapar.
   * Aktif = ölçüm penceresinde en az bir perakende satışı veya işlemi olan.
   */
  const [firstDay] = await sql<{ value: bigint }[]>`
    SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS value
      FROM company_financials cf JOIN companies c ON c.id = cf.company_id
     WHERE c.kind = 'PLAYER' AND cf.tick_id = ${firstTick + day}
       AND EXISTS (SELECT 1 FROM retail_sales rs
                    WHERE rs.company_id = c.id AND rs.tick_id <= ${firstTick + day})`;
  const [startValue] = await sql<{ value: bigint }[]>`
    SELECT (value->>'cash')::bigint AS value FROM game_configs WHERE key = 'start'`;
  const start = Number(startValue?.value ?? 300_000_000n);
  const growth = firstDay && Number(firstDay.value) > 0
    ? Number(firstDay.value) / start - 1 : null;
  out.push({
    key: 'day1_growth', label: 'İlk gün AKTİF oyuncu büyümesi (medyan)',
    value: growth, formatted: growth === null ? '—' : pct(growth),
    target: '%10 – %30',
    pass: growth === null ? null : growth >= 0.10 && growth <= 0.30,
    note: growth === null ? 'ilk gün verisi yok' : undefined,
  });

  /* --- 5. 1. hafta sonu şirket değeri ------------------------------------
   *
   * Medyanın yanında p75 ve p90 da raporlanır. Tek bir medyan, İKİ KUTUPLU bir
   * sonucu gizler: ölçümde birkaç oyuncu hedef bandı aşarken çoğunluk
   * başlangıç değerinde kalabiliyor. Dağılımı görmeden "kapı tutmadı" demek,
   * neden tutmadığını da gizler.
   */
  const weekTick = firstTick + day * 7n;
  const [week] = await sql<{ p50: bigint; p75: bigint; p90: bigint }[]>`
    SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS p50,
           COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS p75,
           COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS p90
      FROM company_financials cf JOIN companies c ON c.id = cf.company_id
     WHERE c.kind = 'PLAYER' AND cf.tick_id = ${weekTick}`;
  const weekValue = week && week.p50 > 0n ? Number(week.p50) / 10_000 : null;
  const spread = week && week.p50 > 0n
    ? ` (p75 ${tl(Number(week.p75) / 10_000)} · p90 ${tl(Number(week.p90) / 10_000)})`
    : '';
  out.push({
    key: 'week1_value', label: '1. hafta sonu şirket değeri (medyan)',
    value: weekValue, formatted: weekValue === null ? '—' : tl(weekValue) + spread,
    target: '100.000 – 250.000 ₺',
    pass: weekValue === null ? null : weekValue >= 100_000 && weekValue <= 250_000,
    note: lastTick < weekTick ? 'koşu 7 güne ulaşmadı' : undefined,
  });

  /* --- 6. Para arzı değişimi -------------------------------------------- */
  const [supply] = await sql<{ first: string; last: string }[]>`
    SELECT (SELECT total_money_supply::text FROM economy_snapshots
             WHERE tick_id >= ${firstTick} ORDER BY tick_id LIMIT 1) AS first,
           (SELECT total_money_supply::text FROM economy_snapshots
             ORDER BY tick_id DESC LIMIT 1) AS last`;
  const moneyChange = supply?.first && Number(supply.first) > 0
    ? Number(supply.last) / Number(supply.first) - 1 : null;
  out.push({
    key: 'money_supply', label: 'Para arzı değişimi',
    value: moneyChange, formatted: moneyChange === null ? '—' : pct(moneyChange),
    target: '±%40 içinde',
    pass: moneyChange === null ? null : Math.abs(moneyChange) <= 0.40,
  });

  /* --- 7. İflas oranı ---------------------------------------------------- */
  const [bankrupt] = await sql<{ total: bigint; failed: bigint }[]>`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'BANKRUPT') AS failed
      FROM companies WHERE kind = 'PLAYER'`;
  const failRate = bankrupt && bankrupt.total > 0n
    ? Number(bankrupt.failed) / Number(bankrupt.total) : null;
  out.push({
    key: 'bankruptcy', label: 'Oyuncu iflas oranı',
    value: failRate, formatted: failRate === null ? '—' : pct(failRate),
    target: '< %15', pass: failRate === null ? null : failRate < 0.15,
  });

  /* --- 8. Kredi kaynaklı para arzı payı (R15) ---------------------------- */
  const [credit] = await sql<{ credit_share: number | null }[]>`
    SELECT credit_share FROM economy_snapshots ORDER BY tick_id DESC LIMIT 1`;
  const creditShare = credit?.credit_share ?? null;
  out.push({
    key: 'credit_share', label: 'Kredinin para arzı içindeki payı',
    value: creditShare, formatted: creditShare === null ? '—' : pct(creditShare),
    target: '< %20', pass: creditShare === null ? null : creditShare < 0.20,
  });

  /* --- 9. Kur değişimi --------------------------------------------------- */
  const [fx] = await sql<{ first: bigint; last: bigint }[]>`
    SELECT (SELECT rate_try_per_usd FROM fx_rates ORDER BY tick_id LIMIT 1) AS first,
           (SELECT rate_try_per_usd FROM fx_rates ORDER BY tick_id DESC LIMIT 1) AS last`;
  const fxChange = fx?.first && fx.first > 0n ? Number(fx.last) / Number(fx.first) - 1 : null;
  out.push({
    key: 'fx_change', label: 'Kur değişimi',
    value: fxChange, formatted: fxChange === null ? '—' : pct(fxChange),
    target: '±%25 içinde', pass: fxChange === null ? null : Math.abs(fxChange) <= 0.25,
  });

  /* --- 10. Dış ticaret kaynaklı para girişi / toplam musluk -------------- */
  const [faucet] = await sql<{ retail: string; foreign: string }[]>`
    SELECT COALESCE(SUM(amount) FILTER (WHERE account = 'SALES'), 0)::text AS retail,
           COALESCE(SUM(amount) FILTER (WHERE account = 'EXPORT'), 0)::text AS foreign
      FROM ledger_entries WHERE direction = 'CREDIT' AND tick_id > ${firstTick}`;
  const total = Number(faucet?.retail ?? 0) + Number(faucet?.foreign ?? 0);
  const foreignShare = total > 0 ? Number(faucet!.foreign) / total : null;
  out.push({
    key: 'foreign_faucet', label: 'Dış ticaretin musluk içindeki payı',
    value: foreignShare, formatted: foreignShare === null ? '—' : pct(foreignShare),
    target: '< %30', pass: foreignShare === null ? null : foreignShare < 0.30,
  });

  /* --- 11. Fiyatın dış ticaret bandına yapışması (R18) ------------------- */
  const [stuck] = await sql<{ share: number | null }[]>`
    SELECT AVG(CASE WHEN ABS(ph.ema_reference::float8
                             / NULLIF(f.world_price_try, 0) - 1) < 0.02
                    THEN 1 ELSE 0 END)::float8 AS share
      FROM price_history ph
      JOIN LATERAL (
        SELECT (ftc.world_price_usd * fx.rate_try_per_usd / 10000)::float8 AS world_price_try
          FROM foreign_trade_capacity ftc
          JOIN fx_rates fx ON fx.tick_id = ftc.tick_id
         WHERE ftc.product_id = ph.product_id AND ftc.tick_id = ph.tick_id
      ) f ON TRUE
     WHERE ph.city_id = 0 AND ph.tick_id > ${lastTick - day}`;
  const stuckShare = stuck?.share ?? null;
  out.push({
    key: 'foreign_band', label: 'Fiyatın dış ticaret bandına yapışma oranı',
    value: stuckShare, formatted: stuckShare === null ? '—' : pct(stuckShare),
    target: '< %20', pass: stuckShare === null ? null : stuckShare < 0.20,
  });

  /* --- 12. Tur süresi p95 ------------------------------------------------ */
  const sorted = [...input.tickDurations].sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)]! : null;
  out.push({
    key: 'tick_p95', label: 'Tur süresi p95',
    value: p95, formatted: p95 === null ? '—' : `${(p95 / 1000).toFixed(2)} sn`,
    target: '< 60 sn', pass: p95 === null ? null : p95 < 60_000,
  });

  return out;
}

/** Kapı sonucu — ölçülemeyen metrik GEÇTİ sayılmaz. */
export function gateVerdict(metrics: readonly MetricResult[]) {
  const measured = metrics.filter((m) => m.pass !== null);
  const failed = measured.filter((m) => !m.pass);
  const unmeasured = metrics.filter((m) => m.pass === null);
  return {
    passed: failed.length === 0 && unmeasured.length === 0,
    failedKeys: failed.map((m) => m.key),
    unmeasuredKeys: unmeasured.map((m) => m.key),
  };
}
