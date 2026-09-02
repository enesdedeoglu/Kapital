import { bigint, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { currencyT, ledgerDir } from './enums.js';
import { moneyCol } from './_types.js';

/**
 * Çift taraflı kayıt defteri — para arzının TEK doğruluk kaynağı (docs/02 §5, I1).
 * `companies.cash` bir önbellektir; gerçek değer bu tablonun toplamıdır.
 *
 * PK (tick_id, tx_id, company_id, direction) idempotency'nin 2. katmanıdır:
 * aynı tx aynı turda iki kez yazılamaz (docs/05 §3).
 *
 * tick_id'ye göre RANGE partition — 1 bölüm = 1 gün (96 tur).
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    txId: uuid('tx_id').notNull(),
    companyId: uuid('company_id').notNull(),
    counterpartyId: uuid('counterparty_id'),
    direction: ledgerDir('direction').notNull(),
    currency: currencyT('currency').notNull().default('TRY'),
    amount: moneyCol('amount').notNull(),
    account: text('account').notNull(),
    reason: text('reason').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    /** Atılan kesir, nano-birim cinsinden ve işaretli — yuvarlama sapmasını izler (R5). */
    roundingResidue: bigint('rounding_residue', { mode: 'bigint' }).notNull().default(0n),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.txId, t.companyId, t.direction] }),
    index('ledger_company_tick').on(t.companyId, t.tickId),
    index('ledger_account_tick').on(t.account, t.currency, t.tickId),
  ],
);
