#!/usr/bin/env tsx
/**
 * Tek bir ekonomik turu elle koşar — geliştirme aracı.
 * Üretimde turlar `apps/worker` zamanlayıcısı tarafından 15 dakikada bir koşar.
 */
import { createSql, loadRootEnv } from '@kapital/db';
import { runTick } from '@kapital/engine';
loadRootEnv();
const sql = createSql();
const r = await runTick(sql);
const retail = r.phases.RETAIL?.result as { soldUnits?: bigint; revenue?: bigint } | undefined;
const upkeep = r.phases.UPKEEP?.result as { maintenanceCharged?: bigint } | undefined;
console.log(
  `   [tur ${r.seq}] ${String(r.durationMs).padStart(3)} ms` +
  ` · satış ${(Number(retail?.soldUnits ?? 0n) / 1000).toFixed(1).padStart(6)} kg` +
  ` · ciro ${(Number(retail?.revenue ?? 0n) / 10000).toFixed(2).padStart(8)} ₺` +
  ` · bakım ${(Number(upkeep?.maintenanceCharged ?? 0n) / 10000).toFixed(2)} ₺`,
);
await sql.end();
