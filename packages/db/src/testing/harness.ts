import { randomUUID } from 'node:crypto';
import { createSql, type Sql } from '../client.js';
import { loadRootEnv } from '../env.js';
import { runMigrations } from '../cli/migrate.js';
import { seed } from '../seed/index.js';
import { asMoney, type Money } from '@kapital/shared';

loadRootEnv();

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL tanımlı değil — testler üretim DB\'sine bağlanmaz');
  return url;
}

/** Test veritabanını hazırlar: migration + seed. Tekrar çalıştırılabilir. */
export async function prepareTestDb(): Promise<Sql> {
  const url = testDatabaseUrl();
  await runMigrations(url, { quiet: true });
  const sql = createSql({ url, max: 20, statementTimeoutMs: 30_000 });
  await seed(sql, { quiet: true });
  return sql;
}

/** Testler arası oyuncu/NPC verisini temizler; dünya config'i kalır. */
export async function truncateGameState(sql: Sql): Promise<void> {
  await sql.unsafe(`
    TRUNCATE ledger_entries, outbox, tick_phase_runs, company_stats RESTART IDENTITY CASCADE;
    DELETE FROM companies WHERE kind <> 'SYSTEM';
    UPDATE companies SET cash = 0, usd_balance = 0 WHERE kind = 'SYSTEM';
  `);
}

export interface TestCompany { id: string; name: string }

/** Oyuncu şirketi oluşturur ve başlangıç nakdini SYS_BANK'tan defter üzerinden verir. */
export async function makePlayer(sql: Sql, cash: Money, name = 'Test A.Ş.'): Promise<TestCompany> {
  const email = `t-${randomUUID()}@kapital.test`;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${email}, 'x', ${name}) RETURNING id`;
  const [company] = await sql<{ id: string }[]>`
    INSERT INTO companies (user_id, kind, name, home_city_id, cash)
    VALUES (${user!.id}, 'PLAYER', ${name}, 1, 0) RETURNING id`;
  await sql`INSERT INTO company_stats (company_id) VALUES (${company!.id})`;

  if (cash > 0n) {
    const { transfer } = await import('../finance/transfer.js');
    const bank = await systemCompanyId(sql, 'SYS_BANK');
    await sql.begin((tx) =>
      transfer(tx as unknown as Sql, {
        tickId: 0n, fromCompanyId: bank, toCompanyId: company!.id,
        amount: cash, account: 'SEED', reason: 'test başlangıç sermayesi',
      }),
    );
  }
  return { id: company!.id, name };
}

export async function systemCompanyId(sql: Sql, code: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = ${code}`;
  if (!row) throw new Error(`sistem şirketi bulunamadı: ${code}`);
  return row.id;
}

export async function cashOf(sql: Sql, companyId: string): Promise<Money> {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${companyId}`;
  return asMoney(row!.cash);
}
