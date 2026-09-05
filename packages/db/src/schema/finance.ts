import {
  bigint, bigserial, doublePrecision, index, numeric, pgEnum, pgTable, primaryKey,
  smallint, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { currencyT, ledgerDir } from './enums.js';
import { moneyCol, qtyCol } from './_types.js';
import { companies } from './organization.js';
import { products } from './world.js';

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

// ---------------------------------------------------------------------------
// DÖVİZ VE DIŞ TİCARET — docs/12.
//
// Yurt içi ekonominin tamamı ₺'dir. USD yalnız üç yerde görünür: cüzdan
// (`companies.usd_balance`), kur işlemi (`fx_trades`) ve dış ticaret.
// ---------------------------------------------------------------------------

export const tradeDirection = pgEnum('trade_direction', ['IMPORT', 'EXPORT']);

/** Tur başına kur — modelden türer, oyuncu belirlemez (docs/12 §4). */
export const fxRates = pgTable('fx_rates', {
  tickId: bigint('tick_id', { mode: 'bigint' }).primaryKey(),
  /** 1 USD kaç ₺ — para ölçeğinde (1 ₺ = 10.000, ADR-0001). */
  rateTryPerUsd: moneyCol('rate_try_per_usd').notNull(),
  source: text('source').notNull().default('MODEL'),
  /** İhracat − ithalat, ₺ karşılığı. Kurun yön bileşeni. */
  tradeBalance: moneyCol('trade_balance').notNull().default(0n),
  /** Sistem dışı şirketlerin USD bakiyeleri toplamı. */
  usdInCirculation: moneyCol('usd_in_circulation').notNull().default(0n),
  gameCpi: doublePrecision('game_cpi').notNull().default(1),
});

export const fxTrades = pgTable(
  'fx_trades',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    /** 'BUY_USD' | 'SELL_USD' — DDL'de CHECK kısıtı, PostgreSQL enum'ı değil (docs/12 §5). */
    side: text('side').notNull(),
    usdAmount: moneyCol('usd_amount').notNull(),
    tryAmount: moneyCol('try_amount').notNull(),
    rate: moneyCol('rate').notNull(),
    /** Alış–satış makası — bir sink'tir, para ekonomiden çıkar. */
    spreadPaid: moneyCol('spread_paid').notNull().default(0n),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('fx_trades_company').on(t.companyId, t.tickId)],
);

/**
 * DIŞ TİCARET — docs/12 §3.
 *
 * Fiyatı OYUNCU BELİRLEMEZ: dünya fiyatı USD'de çıpalıdır ve tur başına
 * derinlik tavanlıdır (`foreign_trade_capacity`). Bu iki şart olmadan ihracat,
 * R10'un döviz kılığında geri dönmesidir (R17).
 *
 * `tick_id`'ye göre RANGE partition; Drizzle yalnız ana tabloyu tanır.
 */
export const foreignTrades = pgTable(
  'foreign_trades',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    companyId: uuid('company_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    productId: smallint('product_id').notNull(),
    direction: tradeDirection('direction').notNull(),
    quantity: qtyCol('quantity').notNull(),
    unitPriceUsd: moneyCol('unit_price_usd').notNull(),
    usdAmount: moneyCol('usd_amount').notNull(),
    /** İşlem anındaki kurla ₺ karşılığı — dış ticaret dengesi bundan hesaplanır. */
    tryEquivalent: moneyCol('try_equivalent').notNull(),
    quality: numeric('quality', { precision: 6, scale: 3 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.companyId, t.facilityId, t.productId, t.direction] }),
    index('foreign_trades_product').on(t.productId, t.tickId),
  ],
);

/**
 * Tur başına ürün dış ticaret derinliği — pro-rata paylaşımın kaynağı.
 *
 * `tick_id`'ye göre RANGE partition; Drizzle yalnız ana tabloyu tanır.
 */
export const foreignTradeCapacity = pgTable(
  'foreign_trade_capacity',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    productId: smallint('product_id').notNull().references(() => products.id),
    importCapacity: qtyCol('import_capacity').notNull(),
    importUsed: qtyCol('import_used').notNull().default(0n),
    exportCapacity: qtyCol('export_capacity').notNull(),
    exportUsed: qtyCol('export_used').notNull().default(0n),
    worldPriceUsd: moneyCol('world_price_usd').notNull(),
    /** ED'nin `IMPORT_QUOTA` direktifi: derinlik 0,5×–4× ölçeklenir (docs/12 §6). */
    importQuotaMult: doublePrecision('import_quota_mult').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.tickId, t.productId] })],
);
