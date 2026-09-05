#!/usr/bin/env tsx
/**
 * Paralel koşan tohumların ham çıktılarını birleştirir (madde 56, R39).
 *
 * Kapının beş tohumu birbirinden tamamen bağımsızdır: her biri veritabanını
 * sıfırlar, tohumlar ve kendi dünyasını kurar. Sırayla koşarsa 3,2 saat sürer;
 * CI'da beş koşucuda paralel koşarsa duvar saati tek tohuma iner.
 *
 * Her iş `gate.ts 1 <oyuncu> <tur> <tohum> --raw ham-N.json` ile kendi ham
 * metriklerini yazar; bu araç onları birleştirip `gate.ts` ile AYNI raporu
 * basar (ortak `printGateReport`).
 *
 * Kullanım:
 *   tsx src/cli/aggregate.ts ham-*.json [--json rapor.json]
 *
 * Çıkış kodu 0 = kapı geçildi.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { aggregateGate, type SeedRun } from '../gate.js';
import { printGateReport } from '../report.js';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt === -1 ? null : args[jsonAt + 1] ?? null;
const files = (jsonAt === -1 ? args : args.slice(0, jsonAt)).filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('Kullanım: tsx src/cli/aggregate.ts ham-*.json [--json rapor.json]');
  process.exit(2);
}

const runs: SeedRun[] = [];
for (const file of files) {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error(`${file}: ham tohum dizisi bekleniyordu (gate.ts --raw çıktısı)`);
    process.exit(2);
  }
  runs.push(...(parsed as SeedRun[]));
}

// Tohum sırası koşucuların bitiş sırasına göre değişir; rapor kararlı olsun.
runs.sort((a, b) => a.seed - b.seed);

console.log(`\n★ GEÇİŞ KAPISI 2 — ${runs.length} tohum (${files.length} paralel iş)`);
for (const run of runs) {
  const passed = run.metrics.filter((m) => m.pass === true).length;
  console.log(`  tohum ${run.seed} … ${passed}/${run.metrics.length} geçti`);
}

const report = aggregateGate(runs);
// Süre paralel koşuda anlamsızdır: her iş kendi saatini tutar.
printGateReport(report, {
  seedCount: runs.length, playerCount: 0, ticks: 0, minutes: 0,
});

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    seedCount: runs.length,
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
