import { afterAll, beforeAll, expect, it } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { Sql } from './client.js';
import { prepareTestDb } from './testing/harness.js';
import * as schema from './schema/index.js';

/**
 * Migration'lar elle SQL yazıldığı için Drizzle şeması ile veritabanı ayrışabilir.
 * Bu test o riski kapatır: Drizzle'da tanımlı her tablo ve kolon DB'de olmalı.
 */
let sql: Sql;
beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });

it('Drizzle şeması ile veritabanı ayrışmamış', async () => {
  const dbColumns = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'`;

  const actual = new Map<string, Set<string>>();
  for (const row of dbColumns) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name)!.add(row.column_name);
  }

  const missing: string[] = [];
  let tableCount = 0;

  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    tableCount++;
    const table = getTableName(value);
    const cols = actual.get(table);
    if (!cols) { missing.push(`tablo eksik: ${table}`); continue; }
    for (const column of Object.values(getTableColumns(value))) {
      if (!cols.has(column.name)) missing.push(`kolon eksik: ${table}.${column.name}`);
    }
  }

  expect(tableCount).toBeGreaterThan(15);
  expect(missing).toEqual([]);
});

/**
 * ★ TERS YÖN. Yukarıdaki test yalnız Drizzle → DB yönünü korur: Drizzle'da
 * tanımlı olup DB'de olmayanı yakalar. DB'de olup Drizzle'da OLMAYAN tablo ise
 * sessizce yaşar.
 *
 * `npc_directives` F0'dan beri tam olarak böyleydi — migration'a girmiş, şemaya
 * girmemişti; F7'de Ekonomi Direktörü onu kullanmaya başlayınca fark edildi.
 *
 * Partition'lar ve migration defteri hariç tutulur: onlar Drizzle'da temsil
 * edilmez, ana tablo zaten tanımlıdır.
 */
it('veritabanında Drizzle şemasında olmayan tablo yok', async () => {
  const dbTables = await sql<{ table_name: string }[]>`
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND i.inhrelid IS NULL`;

  /*
   * Bilinen borç KALMADI: F0–F5'ten kalma tabloların hepsi Drizzle'a yazıldı.
   * Liste bilerek boş bırakıldı, silinmedi.
   *
   * Buraya bir isim eklemek geçici bir borç kaydıdır, muafiyet değil: yeni bir
   * tablo migration'a girip şemaya girmezse bu test düşer ve düşmelidir.
   */
  const bilinenBorc = new Set<string>([]);

  const known = new Set<string>(['_migrations', ...bilinenBorc]);
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) known.add(getTableName(value));
  }

  const orphans = dbTables
    .map((r) => r.table_name)
    .filter((name) => !known.has(name));

  expect(orphans).toEqual([]);
});
