import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * int8 → JS bigint. Varsayılan string'tir; para bigint olmak ZORUNDA (ADR-0001).
 * Bu tip parametresi olmadan `Money`/`Qty` sorgu parametresi olarak geçemez.
 */
// `interface` OLAMAZ: interface'ler örtük indeks imzası almaz, bu yüzden
// postgres.js'in `Record<string, PostgresType<any>>` kısıtını karşılamaz
// (TS2344). `consistent-type-definitions` otomatik düzeltmesi derlemeyi kırar.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type PgTypeMap = { bigint: postgres.PostgresType<bigint> };
export type Db = PostgresJsDatabase<typeof schema>;
export type Sql = postgres.Sql<{ bigint: bigint }>;

export interface DbOptions {
  url?: string;
  max?: number;
  /** Kaçak transaction veritabanını kilitleyemesin — docs/06 §7 */
  statementTimeoutMs?: number;
}

export function createSql(opts: DbOptions = {}): Sql {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tanımlı değil');
  return postgres<PgTypeMap>(url, {
    max: opts.max ?? 10,
    types: { bigint: postgres.BigInt },
    connection: {
      statement_timeout: opts.statementTimeoutMs ?? 10_000,
      idle_in_transaction_session_timeout: 30_000,
    },
    // postgres NOTICE mesajları (ör. "relation already exists") log'u
    // boğar; bilinçli olarak yutuluyor.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onnotice: () => {},
  });
}

export function createDb(sql: Sql): Db {
  return drizzle(sql, { schema });
}

export { schema };
