#!/usr/bin/env tsx
/**
 * ARZ ŞOKU SENARYOSU — F7 çıkış kriteri.
 *
 * "Bir ürünün üretimi kasıtlı durdurulduğunda ekonomi kendini toparlıyor —
 *  önce ithalat kapısı açılarak, ancak o yetmezse rezervle."
 *
 * Akış: ısınma → şok (ürünün tüm üretimi durdurulur) → gözlem → onarım
 * (üretim geri açılır) → toparlanma. Her aşamada ED'nin ne yaptığı basılır.
 *
 * Kullanım:  tsx src/cli/scenario-shock.ts [ÜRÜN_KODU] [ısınma] [şok] [onarım] [stok]
 *
 * Son argüman "koru" ise mevcut stok bırakılır. Varsayılan İMHA'dır: depoları
 * dolu bırakan bir "şok" aslında şok değil duraklamadır — ölçüldü, mobilya
 * üretimi 80 tur durdurulduğu halde raflar dolu kaldığı için skor yükseldi.
 */
import { createSql, loadRootEnv } from '@kapital/db';
import { runTick } from '../orchestrator.js';

loadRootEnv();

const productCode = (process.argv[2] ?? 'BREAD').toUpperCase();
const warmup = Number(process.argv[3] ?? 40);
const shock = Number(process.argv[4] ?? 40);
const repair = Number(process.argv[5] ?? 60);
const wipeStock = (process.argv[6] ?? 'imha') !== 'koru';

const sql = createSql({ max: 10, statementTimeoutMs: 120_000 });

const [product] = await sql<{ id: number; name: string }[]>`
  SELECT id, name FROM products WHERE code = ${productCode}`;
if (!product) { console.error(`ürün bulunamadı: ${productCode}`); process.exit(1); }

const snapshot = async () => {
  const [health] = await sql<{
    score: string; band: string; supply_units: bigint; demand_units: bigint;
  }[]>`
    SELECT score::text, band, supply_units, demand_units FROM market_health
     WHERE product_id = ${product.id} AND city_id = 0 ORDER BY tick_id DESC LIMIT 1`;
  const directives = await sql<{ lever: string; magnitude: number }[]>`
    SELECT lever, magnitude FROM npc_directives
     WHERE product_id = ${product.id} AND expires_tick > (SELECT COALESCE(MAX(seq),0) FROM economic_ticks)
     ORDER BY lever`;
  const [imports] = await sql<{ capacity: bigint; quota: number }[]>`
    SELECT import_capacity AS capacity, import_quota_mult AS quota
      FROM foreign_trade_capacity WHERE product_id = ${product.id}
     ORDER BY tick_id DESC LIMIT 1`;
  const [reserve] = await sql<{ remaining: bigint }[]>`
    SELECT o.remaining_quantity AS remaining FROM market_orders o
      JOIN companies c ON c.id = o.company_id
     WHERE c.system_code = 'SYS_RESERVE' AND o.product_id = ${product.id}
       AND o.status IN ('OPEN','PARTIAL')`;
  const [sales] = await sql<{ units: bigint }[]>`
    SELECT COALESCE(SUM(quantity),0)::bigint AS units FROM retail_sales
     WHERE product_id = ${product.id}
       AND tick_id > (SELECT COALESCE(MAX(seq),0) - 24 FROM economic_ticks)`;
  return { health, directives, imports, reserve, sales };
};

const line = (label: string) => {
  const pad = '─'.repeat(Math.max(0, 66 - label.length));
  console.log(`\n── ${label} ${pad}`);
};

const report = async (label: string) => {
  const s = await snapshot();
  const h = s.health;
  const ratio = h && Number(h.demand_units) > 0
    ? (Number(h.supply_units) / Number(h.demand_units)).toFixed(2) : '—';
  console.log(
    `  ${label.padEnd(14)} skor ${(h?.score ?? '—').padStart(6)} · ${(h?.band ?? '—').padEnd(9)}` +
    ` · arz/talep ${ratio.padStart(5)}` +
    ` · ithalat ${String(Number(s.imports?.capacity ?? 0n) / 1000).padStart(6)}` +
    ` (kota ${(s.imports?.quota ?? 1).toFixed(1)}×)` +
    ` · rezerv ${s.reserve ? Number(s.reserve.remaining) / 1000 : 0}` +
    ` · 24t satış ${Number(s.sales?.units ?? 0n) / 1000}`,
  );
  if (s.directives.length > 0) {
    console.log(`                 direktif: ${s.directives
      .map((d) => `${d.lever} ${d.magnitude > 0 ? '+' : ''}${d.magnitude.toFixed(2)}`).join(' · ')}`);
  }
};

const run = async (n: number, label: string) => {
  for (let i = 0; i < n; i++) {
    const r = await runTick(sql);
    if (r.skipped) { console.error('tur atlandı — kilit tutulu'); process.exit(1); }
    if ((i + 1) % 20 === 0) await report(`${label} +${i + 1}`);
  }
};

console.log(`\n★ ARZ ŞOKU: ${product.name} (${productCode})`);
console.log(`  ısınma ${warmup} tur · şok ${shock} tur · onarım ${repair} tur\n`);

line('1. ISINMA — ekonomi normal işliyor');
await run(warmup, 'ısınma');
await report('ısınma sonu');

line(`2. ŞOK — ${product.name} üretimi tamamen durduruldu`);
const halted = await sql`
  UPDATE facilities SET production_enabled = FALSE
   WHERE active_recipe_id IN (SELECT id FROM production_recipes WHERE output_product_id = ${product.id})
     AND closed_at IS NULL
  RETURNING id`;
console.log(`  ${halted.length} tesis durduruldu`);

if (wipeStock) {
  // Zincirdeki tüm stok imha edilir: kıtlık ancak tampon bitince ısırır.
  const wiped = await sql`
    DELETE FROM inventory_batches WHERE product_id = ${product.id} RETURNING quantity`;
  const units = wiped.reduce((sum, r) => sum + Number((r as { quantity: bigint }).quantity), 0);
  await sql`
    UPDATE market_orders SET status = 'CANCELLED', remaining_quantity = 0
     WHERE product_id = ${product.id} AND side = 'SELL' AND status IN ('OPEN','PARTIAL')`;
  console.log(`  ${(units / 1000).toFixed(0)} birim stok imha edildi, satış emirleri iptal`);
}
await run(shock, 'şok');
await report('şok sonu');

line('3. ONARIM — üretim yeniden açıldı');
await sql`
  UPDATE facilities SET production_enabled = TRUE, halted_reason = NULL
   WHERE active_recipe_id IN (SELECT id FROM production_recipes WHERE output_product_id = ${product.id})`;
await run(repair, 'onarım');
await report('onarım sonu');

line('OLAY AKIŞI');
const events = await sql<{ tick_id: bigint; kind: string; severity: string; title: string }[]>`
  SELECT tick_id, kind, severity, title FROM world_events
   WHERE product_id = ${product.id} ORDER BY tick_id`;
for (const e of events) {
  console.log(`  tur ${String(e.tick_id).padStart(4)} · ${e.severity.padEnd(8)} · ${e.title}`);
}
if (events.length === 0) console.log('  (müdahale gerekmedi)');

await sql.end({ timeout: 5 });
