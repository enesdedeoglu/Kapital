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
