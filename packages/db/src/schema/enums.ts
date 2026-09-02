import { pgEnum } from 'drizzle-orm/pg-core';

export const companyKind = pgEnum('company_kind', ['PLAYER', 'NPC', 'SYSTEM']);
export const companyStatus = pgEnum('company_status', ['ACTIVE', 'BANKRUPT', 'SUSPENDED', 'DELETED']);
export const facilityCat = pgEnum('facility_cat', [
  'RETAIL', 'AGRICULTURE', 'LIVESTOCK', 'MINING', 'INDUSTRY', 'LOGISTICS',
]);
export const tickStatus = pgEnum('tick_status', ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
export const phaseStatus = pgEnum('phase_status', ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']);
export const ledgerDir = pgEnum('ledger_dir', ['DEBIT', 'CREDIT']);
export const currencyT = pgEnum('currency_t', ['TRY', 'USD']);
