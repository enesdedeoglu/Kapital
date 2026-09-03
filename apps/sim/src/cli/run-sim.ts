#!/usr/bin/env tsx
/**
 * F8 denge kapısı koşusu.
 *
 * Kullanım: tsx src/cli/run-sim.ts [oyuncu] [tur] [rapor_araligi] [tohum]
 *
 * Yol haritası hedefi 1000 şirket × 90 gün (8.640 tur). Bu ölçek tek bir
 * makinede saatler sürer; ölçek argümanla verilir ve rapor GERÇEKTEN koşulan
 * ölçeği yazar — "hedef ölçekte koştu" diye bir varsayım yoktur.
 */
import { createSql, loadRootEnv } from '@kapital/db';
import { collectMetrics, gateVerdict } from '../metrics.js';
import { runSimulation } from '../runner.js';
import { buildSimWorld } from '../world.js';

loadRootEnv();

const playerCount = Number(process.argv[2] ?? 200);
const ticks = Number(process.argv[3] ?? 960);
const reportEvery = Number(process.argv[4] ?? 96);
const seed = Number(process.argv[5] ?? 20260903);

const sql = createSql({ max: 10, statementTimeoutMs: 180_000 });
const started = Date.now();

console.log(`\n★ DENGE KAPISI KOŞUSU`);
console.log(`  ${playerCount} oyuncu · ${ticks} tur (${(ticks / 96).toFixed(1)} gün) · tohum ${seed}\n`);

console.log('Oyuncu nüfusu kuruluyor...');
const players = await buildSimWorld(sql, { players: playerCount, seed });
const byProfile = new Map<string, number>();
for (const p of players) byProfile.set(p.profile.code, (byProfile.get(p.profile.code) ?? 0) + 1);
console.log(`  ${players.length} şirket kuruldu`);
console.log(`  ${[...byProfile].map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);

const result = await runSimulation(sql, players, {
  ticks, reportEvery,
  onReport: (s) => console.log(
    `tur ${String(s.seq).padStart(5)} · ${String(s.durationMs).padStart(5)} ms` +
    ` · para arzı ${s.moneySupply.toLocaleString('tr-TR', { maximumFractionDigits: 0 }).padStart(12)} ₺` +
    ` · CPI ${s.cpi.toFixed(3)} · işlem ${String(s.trades).padStart(4)}` +
    ` · perakende ${s.retailRevenue.toFixed(0).padStart(6)} ₺` +
    ` · hareket eden ${String(s.actingPlayers).padStart(4)}`,
  ),
});

const metrics = await collectMetrics(sql, {
  firstTick: result.firstTick, lastTick: result.lastTick,
  tickDurations: result.samples.map((s) => s.durationMs),
  initialPlayers: players.length,
});

const line = '─'.repeat(78);
console.log(`\n${line}`);
console.log(`${ticks} tur · ${((Date.now() - started) / 1000).toFixed(1)} sn`);
console.log(`  oyuncu eylemleri: ${result.counters.retailPrices} fiyat · ` +
  `${result.counters.buyOrders} alış · ${result.counters.sellOrders} satış · ` +
  `${result.counters.builds} tesis (${result.counters.recipes} reçete) · ` +
  `${result.counters.loans} kredi · ${result.counters.errors} reddedildi`);
if (result.counters.errorsByCode.size > 0) {
  const reasons = [...result.counters.errorsByCode]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code} ${n}`).join(' · ');
  console.log(`  reddedilme nedenleri: ${reasons}`);
}
console.log(`\n★ EKONOMİ HEDEFLERİ (madde 56)\n`);
console.log(`  ${'Metrik'.padEnd(46)}${'Ölçüm'.padEnd(16)}${'Hedef'.padEnd(22)}`);
console.log(`  ${'─'.repeat(84)}`);
for (const m of metrics) {
  const mark = m.pass === null ? '—' : m.pass ? '✓' : '✗';
  console.log(`${mark} ${m.label.padEnd(46)}${m.formatted.padEnd(16)}${m.target.padEnd(22)}` +
    (m.note ? `  (${m.note})` : ''));
}

const verdict = gateVerdict(metrics);
console.log(`\n${line}`);
if (verdict.passed) {
  console.log('★ KAPI GEÇİLDİ — tüm eşikler tutuyor');
} else {
  console.log('✗ KAPI GEÇİLMEDİ');
  if (verdict.failedKeys.length > 0) console.log(`  tutmayan: ${verdict.failedKeys.join(', ')}`);
  if (verdict.unmeasuredKeys.length > 0) console.log(`  ölçülemeyen: ${verdict.unmeasuredKeys.join(', ')}`);
}
console.log(line);

await sql.end({ timeout: 5 });
process.exit(verdict.passed ? 0 : 1);
