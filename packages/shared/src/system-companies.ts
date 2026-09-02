/**
 * Sistem şirketleri — docs/02 §3.1, docs/12 §2.
 * Her ₺'nin bir kaynağı ve bir hedefi olmalı; bunlar olmadan para arzı ölçülemez.
 * Sistem şirketleri tanımı gereği negatif bakiye taşır (musluk karşılıksız öder).
 */
export const SYSTEM_COMPANIES = {
  SYS_CONSUMER: 'NPC tüketiciler — perakendeden paranın oyuna girişi',
  SYS_SINK: 'Maaş, bakım, kira, faiz, vergi, spread — paranın çıkışı',
  SYS_RESERVE: 'Economic Director acil rezervi (son çare)',
  SYS_BANK: 'Kredi anaparası — kredi para yaratır, geri ödeme yok eder',
  SYS_FX: '₺ ↔ $ dönüşümünün karşı tarafı',
  SYS_WORLD: 'Dünya piyasası — dış ticarette malı alan/satan taraf',
  SYS_TREASURY: 'Oyuncu başlangıç sermayesi — kredi ile karışmaması için ayrı',
} as const;

export type SystemCompanyCode = keyof typeof SYSTEM_COMPANIES;
export const SYSTEM_COMPANY_CODES = Object.keys(SYSTEM_COMPANIES) as SystemCompanyCode[];

/** Defter hesapları — `ledger_entries.account`. */
export const LEDGER_ACCOUNTS = [
  'SALES', 'COGS', 'TRADE', 'SHIPPING', 'SALARY', 'MAINTENANCE', 'RENT',
  'INTEREST', 'TAX', 'CAPEX', 'LOAN_PRINCIPAL', 'LOAN_REPAYMENT',
  'FX_CONVERSION', 'FX_SPREAD', 'FOREIGN_TRADE', 'ROUNDING', 'SEED',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];
