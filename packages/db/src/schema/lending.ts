import {
  bigint, doublePrecision, index, pgEnum, pgTable, primaryKey, smallint,
  text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { moneyCol } from './_types.js';
import { companies } from './organization.js';

export const loanStatus = pgEnum('loan_status', ['ACTIVE', 'PAID', 'DEFAULTED', 'LIQUIDATED']);

/**
 * Kredi verme PARA YARATIR (R15): anapara `SYS_BANK`'tan çıkar, geri ödeme
 * oraya döner ve parayı yok eder. Faiz `SYS_SINK`'e gider.
 */
export const loans = pgTable(
  'loans',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedByDefaultAsIdentity(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    principal: moneyCol('principal').notNull(),
    /** Tur başına faiz. Enflasyona bağlanır (R15 azaltımı). */
    interestRate: doublePrecision('interest_rate').notNull(),
    remainingBalance: moneyCol('remaining_balance').notNull(),
    paymentPerTick: moneyCol('payment_per_tick').notNull(),
    totalPaid: moneyCol('total_paid').notNull().default(0n),
    interestPaid: moneyCol('interest_paid').notNull().default(0n),
    missedPayments: smallint('missed_payments').notNull().default(0),
    /** Limit denetimi: kredi hangi teminatla verildi (denetlenebilirlik). */
    companyValueAtOpen: moneyCol('company_value_at_open').notNull(),
    leverageAtOpen: doublePrecision('leverage_at_open').notNull(),
    openedTick: bigint('opened_tick', { mode: 'bigint' }).notNull(),
    dueTick: bigint('due_tick', { mode: 'bigint' }).notNull(),
    defaultedAtTick: bigint('defaulted_at_tick', { mode: 'bigint' }),
    status: loanStatus('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('loans_active').on(t.companyId)],
);

export const loanPayments = pgTable(
  'loan_payments',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    loanId: bigint('loan_id', { mode: 'bigint' }).notNull(),
    companyId: uuid('company_id').notNull(),
    amount: moneyCol('amount').notNull(),
    principalPart: moneyCol('principal_part').notNull(),
    interestPart: moneyCol('interest_part').notNull(),
    balanceAfter: moneyCol('balance_after').notNull(),
    outcome: text('outcome').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.loanId] }),
    index('loan_payments_company').on(t.companyId, t.tickId),
  ],
);
