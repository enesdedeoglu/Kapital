#!/usr/bin/env tsx
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql } from '../client.js';
import { loadRootEnv } from '../env.js';

loadRootEnv();

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function runMigrations(url?: string, opts: { quiet?: boolean } = {}) {
  const sql = createSql({ url, max: 1, statementTimeoutMs: 120_000 });
  const log = (msg: string) => { if (!opts.quiet) console.log(msg); };
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_ms INTEGER NOT NULL
      )`;

    const applied = new Map(
      (await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM _migrations`)
        .map((r) => [r.name, r.checksum]),
    );

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    let ran = 0;

    for (const file of files) {
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex').slice(0, 16);
      const prev = applied.get(file);

      if (prev === checksum) continue;
      if (prev && prev !== checksum) {
        throw new Error(
          `Migration "${file}" uygulandiktan sonra DEGISTIRILMIS (${prev} -> ${checksum}). ` +
          `Uygulanmis bir migration duzenlenmez; yeni bir migration dosyasi ekleyin.`,
        );
      }

      const started = Date.now();
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO _migrations (name, checksum, duration_ms)
                 VALUES (${file}, ${checksum}, ${Date.now() - started})`;
      });
      log(`  + ${file}  (${Date.now() - started} ms)`);
      ran++;
    }
    log(ran === 0 ? '  . sema guncel' : `  ${ran} migration uygulandi`);
    return ran;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Migration calistiriliyor...');
  runMigrations().then(
    () => process.exit(0),
    (e) => { console.error('HATA:', e.message); process.exit(1); },
  );
}
