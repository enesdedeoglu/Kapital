#!/usr/bin/env tsx
import { createSql } from '../client.js';
import { loadRootEnv } from '../env.js';

loadRootEnv();

/** Gelistirme veritabanini sifirlar. Uretimde ASLA calismaz. */
export async function resetDatabase(url?: string) {
  if (process.env.NODE_ENV === 'production') throw new Error('reset uretimde calistirilamaz');
  const sql = createSql({ url, max: 1, statementTimeoutMs: 60_000 });
  try {
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase().then(
    () => { console.log('Veritabani sifirlandi.'); process.exit(0); },
    (e) => { console.error('HATA:', e.message); process.exit(1); },
  );
}
