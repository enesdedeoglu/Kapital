#!/usr/bin/env tsx
/**
 * Oyuncusuz ekonomi koşusu — F6 çıkış kriteri.
 *
 * `packages/sim` (F8) bunun üzerine oyuncu davranış profillerini ekleyecek.
 * Buradaki amaç daha dar: NPC ekonomisi kendi başına ayakta kalıyor mu?
 */
import { createSql, loadRootEnv } from '@kapital/db';
import { formatMoney, asMoney } from '@kapital/shared';
import { runTick } from '../orchestrator.js';

loadRootEnv();

const ticks = Number(process.argv[2] ?? 100);
const report = Number(process.argv[3] ?? 50);
const sql = createSql({ max: 10, statementTimeoutMs: 120_000 });

interface Row { tick: bigint; supply: number; cpi: number; ms: number; trades: number; sales: number }
const history: Row[] = [];
const started = Date.now();

for (let i = 0; i < ticks; i++) {
  const result = await runTick(sql);
  if (result.skipped) { console.error('tur atlandı — kilit tutulu'); break; }

  const retail = result.phases.RETAIL?.result as { revenue?: bigint } | undefined;
  const exchange = result.phases.EXCHANGE?.result as { matches?: number } | undefined;
  const settle = result.phases.SETTLE?.result as { gameCpi?: number } | undefined;

  const [snap] = await sql<{ supply: string }[]>`
    SELECT total_money_supply::text AS supply FROM economy_snapshots WHERE tick_id = ${result.seq}`;

  history.push({
    tick: result.seq,
    supply: Number(snap?.supply ?? 0) / 10_000,
    cpi: settle?.gameCpi ?? 1,
    ms: result.durationMs,
    trades: exchange?.matches ?? 0,
    sales: Number(retail?.revenue ?? 0n) / 10_000,
  });

  if ((i + 1) % report === 0 || i === 0) {
    const r = history[history.length - 1]!;
    console.log(
      `tur ${String(r.tick).padStart(4)} · ${String(r.ms).padStart(4)} ms` +
      ` · para arzı ${r.supply.toLocaleString('tr-TR', { maximumFractionDigits: 0 }).padStart(12)} ₺` +
      ` · CPI ${r.cpi.toFixed(3)} · işlem ${String(r.trades).padStart(3)}` +
      ` · perakende ${r.sales.toFixed(0).padStart(6)} ₺`,
    );
  }
}

const first = history[0]!;
const last = history[history.length - 1]!;
const supplyChange = (last.supply / first.supply - 1) * 100;
const avgMs = history.reduce((s, r) => s + r.ms, 0) / history.length;
const p95Ms = [...history].sort((a, b) => a.ms - b.ms)[Math.floor(history.length * 0.95)]!.ms;

const [companies] = await sql<{ active: number; bankrupt: number; median: bigint }[]>`
  SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
         COUNT(*) FILTER (WHERE status = 'BANKRUPT')::int AS bankrupt,
         COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY company_value), 0)::bigint AS median
  FROM companies WHERE kind = 'NPC'`;
const [products] = await sql<{ traded: number; priced: number }[]>`
  SELECT COUNT(DISTINCT product_id)::int AS traded,
         (SELECT COUNT(DISTINCT product_id)::int FROM price_history WHERE volume > 0) AS priced
  FROM market_trades`;

console.log('\n' + '─'.repeat(72));
console.log(`${history.length} tur · ${((Date.now() - started) / 1000).toFixed(1)} sn`);
console.log(`  tur süresi        ort ${avgMs.toFixed(0)} ms · p95 ${p95Ms} ms   (bütçe 37.000 ms)`);
console.log(`  para arzı         ${first.supply.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} → ` +
            `${last.supply.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺  (${supplyChange >= 0 ? '+' : ''}${supplyChange.toFixed(1)}%)`);
console.log(`  Game CPI          ${first.cpi.toFixed(3)} → ${last.cpi.toFixed(3)}`);
console.log(`  aktif NPC         ${companies!.active} · iflas ${companies!.bankrupt}`);
console.log(`  medyan NPC değeri ${formatMoney(asMoney(companies!.median))}`);
console.log(`  işlem gören ürün  ${products!.traded} / 10`);
console.log('─'.repeat(72));

await sql.end({ timeout: 5 });
