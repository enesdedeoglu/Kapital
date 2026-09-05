#!/usr/bin/env tsx
/**
 * ★ GEÇİŞ KAPISI 2 — çok tohumlu ekonomi doğrulaması (madde 56, R39).
 *
 * Dünya olayları eklendikten sonra her koşu farklı bir dünya üretiyor. Tek
 * koşuya bakan bir kapı gürültüyü sinyal sanar: aynı yapılandırmanın iki
 * koşusunda NPC payı %52,7 ve %68,1 çıktı. Bu araç N tohumu koşar ve kararı
 * birleşik sonuç üzerinden verir.
 *
 * Kullanım:
 *   tsx src/cli/gate.ts [tohum_sayısı] [oyuncu] [tur] [ilk_tohum] [--json dosya]
 *
 * Her tohum TEMİZ bir dünyada başlar: veritabanı sıfırlanır, tohumlanır, NPC
 * dünyası kurulur. Aksi halde ikinci koşu birincinin mirasını devralır.
 *
 * Çıkış kodu 0 = kapı geçildi. CI bunu doğrudan kullanabilir.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createSql, loadRootEnv } from '@kapital/db';
import { aggregateGate, type SeedRun } from '../gate.js';
import { collectMetrics } from '../metrics.js';
import { printGateReport } from '../report.js';
import { runSimulation } from '../runner.js';
import { buildSimWorld } from '../world.js';

loadRootEnv();

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt === -1 ? null : args[jsonAt + 1] ?? null;
/*
 * --raw: tohumların HAM metriklerini yazar (birleştirilmiş rapor değil).
 * CI'da beş tohum beş ayrı koşucuda paralel koşar; her iş kendi ham
 * dosyasını üretir, `aggregate.ts` onları birleştirip aynı raporu basar.
 * Duvar saati 3,2 saatten tek tohuma iner.
 */
const rawAt = args.indexOf('--raw');
const rawPath = rawAt === -1 ? null : args[rawAt + 1] ?? null;
const firstFlag = Math.min(...[jsonAt, rawAt].filter((i) => i !== -1), args.length);
const positional = args.slice(0, firstFlag);

const seedCount = Number(positional[0] ?? 5);
const playerCount = Number(positional[1] ?? 60);
const ticks = Number(positional[2] ?? 700);
const firstSeed = Number(positional[3] ?? 20260904);


const shell = (cmd: string, cmdArgs: string[]) =>
  execFileSync(cmd, cmdArgs, { cwd: process.cwd(), stdio: 'pipe' });

console.log(`\n★ GEÇİŞ KAPISI 2 — EKONOMİ HEDEFLERİ (madde 56)`);
console.log(`  ${seedCount} tohum × ${playerCount} oyuncu × ${ticks} tur ` +
  `(${(ticks / 96).toFixed(1)} gün)\n`);

const started = Date.now();
const runs: SeedRun[] = [];

for (let i = 0; i < seedCount; i++) {
  const seed = firstSeed + i * 1013;
  process.stdout.write(`  tohum ${seed} … `);

  shell('pnpm', ['--filter', '@kapital/db', 'reset']);
  shell('pnpm', ['--filter', '@kapital/db', 'migrate']);
  shell('pnpm', ['--filter', '@kapital/db', 'seed']);
  shell('pnpm', ['--filter', '@kapital/db', 'seed:npc']);

  const sql = createSql({ max: 10, statementTimeoutMs: 180_000 });
  const players = await buildSimWorld(sql, { players: playerCount, seed });
  const result = await runSimulation(sql, players, { ticks, reportEvery: ticks + 1 });
  const metrics = await collectMetrics(sql, {
    firstTick: result.firstTick, lastTick: result.lastTick,
    tickDurations: result.samples.map((s) => s.durationMs),
    initialPlayers: players.length,
  });

  const [events] = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM world_events`;
  await sql.end({ timeout: 5 });

  const passed = metrics.filter((m) => m.pass === true).length;
  const measured = metrics.filter((m) => m.pass !== null).length;
  console.log(`${passed}/${metrics.length} geçti · ${events?.count ?? 0n} dünya olayı` +
    (measured < metrics.length ? ` · ${metrics.length - measured} ölçülemedi` : ''));

  runs.push({ seed, metrics });
}

const report = aggregateGate(runs);

printGateReport(report, {
  seedCount: runs.length, playerCount, ticks,
  minutes: (Date.now() - started) / 60_000,
});

if (rawPath) {
  writeFileSync(rawPath, JSON.stringify(runs, null, 2));
  console.log(`\nHam metrikler: ${rawPath}`);
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    seedCount, playerCount, ticks,
    passed: report.passed,
    metrics: report.metrics,
    perSeed: runs.map((r) => ({
      seed: r.seed,
      metrics: r.metrics.map((m) => ({ key: m.key, value: m.value, pass: m.pass })),
    })),
  }, null, 2));
  console.log(`\nJSON rapor: ${jsonPath}`);
}

process.exit(report.passed ? 0 : 1);
