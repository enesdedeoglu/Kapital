#!/usr/bin/env tsx
/**
 * Parametre taraması — denge ayarı.
 *
 * Bir config anahtarının farklı değerleriyle aynı koşuyu tekrarlar ve
 * metrikleri yan yana koyar. Amaç "en iyi" değeri otomatik bulmak DEĞİL;
 * bir parametrenin hangi metriği ne yönde hareket ettirdiğini görünür kılmak.
 *
 * Kullanım:
 *   tsx src/cli/sweep.ts <config.anahtari> <json1> <json2> [...] -- [oyuncu] [tur]
 *
 * Örnek:
 *   tsx src/cli/sweep.ts economy.upkeep '{"rate":0.00025}' '{"rate":0.0001}' -- 40 300
 *
 * ★ Her koşu TEMİZ bir dünyada başlar: veritabanı sıfırlanır, tohumlanır,
 *   NPC dünyası kurulur. Aksi halde ikinci koşu birincinin mirasını devralır
 *   ve karşılaştırma anlamsızlaşır.
 */
import { execFileSync } from 'node:child_process';
import { createSql, loadRootEnv } from '@kapital/db';
import { collectMetrics, type MetricResult } from '../metrics.js';
import { runSimulation } from '../runner.js';
import { buildSimWorld } from '../world.js';

loadRootEnv();

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const head = separator === -1 ? argv : argv.slice(0, separator);
const tail = separator === -1 ? [] : argv.slice(separator + 1);

const key = head[0];
const values = head.slice(1);
if (!key || values.length < 2) {
  console.error('kullanım: sweep.ts <config.anahtari> <json1> <json2> [...] -- [oyuncu] [tur]');
  process.exit(1);
}
const playerCount = Number(tail[0] ?? 40);
const ticks = Number(tail[1] ?? 300);

const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd: process.cwd(), stdio: 'pipe' });

const results: { value: string; metrics: MetricResult[] }[] = [];

for (const value of values) {
  console.log(`\n── ${key} = ${value} ${'─'.repeat(Math.max(0, 50 - value.length))}`);

  // Temiz dünya
  run('pnpm', ['--filter', '@kapital/db', 'reset']);
  run('pnpm', ['--filter', '@kapital/db', 'migrate']);
  run('pnpm', ['--filter', '@kapital/db', 'seed']);
  run('pnpm', ['--filter', '@kapital/db', 'seed:npc']);

  const sql = createSql({ max: 10, statementTimeoutMs: 180_000 });
  // Config VERSİYONLUdur (madde 58.7): yeni değer yeni sürüm olarak yazılır,
  // eskisi tarihte kalır. Tohumdaki yazma deseniyle aynı.
  await sql`
    INSERT INTO game_configs (key, version, value)
    SELECT ${key}, COALESCE(MAX(version), 0) + 1, ${value}::text::jsonb
      FROM game_configs WHERE key = ${key}`;

  const players = await buildSimWorld(sql, { players: playerCount, seed: 20260903 });
  const result = await runSimulation(sql, players, { ticks, reportEvery: ticks });
  const metrics = await collectMetrics(sql, {
    firstTick: result.firstTick, lastTick: result.lastTick,
    tickDurations: result.samples.map((s) => s.durationMs),
    initialPlayers: players.length,
  });
  results.push({ value, metrics });
  await sql.end({ timeout: 5 });
}

console.log(`\n${'═'.repeat(90)}`);
console.log(`PARAMETRE TARAMASI — ${key}\n`);
const labels = results[0]!.metrics.map((m) => m.label);
const width = Math.max(...labels.map((l) => l.length)) + 2;
console.log(`  ${'Metrik'.padEnd(width)}${results.map((r) => r.value.padEnd(20)).join('')}`);
console.log(`  ${'─'.repeat(width + results.length * 20)}`);
for (let i = 0; i < labels.length; i++) {
  const cells = results.map((r) => {
    const m = r.metrics[i]!;
    return `${m.pass === null ? '—' : m.pass ? '✓' : '✗'} ${m.formatted}`.padEnd(20);
  });
  console.log(`  ${labels[i]!.padEnd(width)}${cells.join('')}`);
}
console.log(`${'═'.repeat(90)}`);
