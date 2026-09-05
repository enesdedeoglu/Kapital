import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, doublePrecision, index, numeric, pgTable, primaryKey,
  smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { moneyCol, qtyCol } from './_types.js';
import { companyKind, companyStatus } from './enums.js';
import { users } from './identity.js';
import { cities, products } from './world.js';

export const companyLevels = pgTable('company_levels', {
  level: smallint('level').primaryKey(),
  requiredXp: bigint('required_xp', { mode: 'bigint' }).notNull().default(0n),
  requiredCompanyValue: moneyCol('required_company_value').notNull().default(0n),
  requiredTradeVolume: moneyCol('required_trade_volume').notNull().default(0n),
  requiredUnitsProduced: qtyCol('required_units_produced').notNull().default(0n),
  requiredDistinctProducts: smallint('required_distinct_products').notNull().default(0),
  title: text('title').notNull(),
});

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').unique().references(() => users.id, { onDelete: 'set null' }),
    kind: companyKind('kind').notNull(),
    systemCode: text('system_code').unique(),
    name: text('name').notNull(),
    cash: moneyCol('cash').notNull().default(0n),
    usdBalance: moneyCol('usd_balance').notNull().default(0n),
    level: smallint('level').notNull().default(1),
    experience: bigint('experience', { mode: 'bigint' }).notNull().default(0n),
    reputation: numeric('reputation', { precision: 5, scale: 2 }).notNull().default('50'),
    homeCityId: smallint('home_city_id').notNull().references(() => cities.id),
    logisticsModifier: doublePrecision('logistics_modifier').notNull().default(1),
    companyValue: moneyCol('company_value').notNull().default(0n),
    status: companyStatus('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  },
  (t) => [
    index('companies_kind_status').on(t.kind, t.status),
    index('companies_leaderboard').on(t.companyValue),
    index('companies_home_city').on(t.homeCityId),
  ],
);

export const companyStats = pgTable('company_stats', {
  companyId: uuid('company_id').primaryKey().references(() => companies.id, { onDelete: 'cascade' }),
  totalUnitsProduced: qtyCol('total_units_produced').notNull().default(0n),
  totalTradeVolume: moneyCol('total_trade_volume').notNull().default(0n),
  totalRetailRevenue: moneyCol('total_retail_revenue').notNull().default(0n),
  distinctProductsProduced: smallint('distinct_products_produced').notNull().default(0),
  distinctCities: smallint('distinct_cities').notNull().default(1),
  facilitiesBuilt: bigint('facilities_built', { mode: 'number' }).notNull().default(0),
  peakCompanyValue: moneyCol('peak_company_value').notNull().default(0n),
});

/**
 * Şirketin ürettiği farklı ürünler — seviye şartı (madde 11) ve üretim geçmişi.
 *
 * `company_stats.distinct_products_produced` bir seviye şartıydı ama F8'e
 * kadar hiç güncellenmiyordu. Tüm zamanların ayrık ürün sayısını her turda
 * `production_records` üzerinden saymak pahalıdır; bu tablo sayımı O(1) yapar.
 */
export const companyProducts = pgTable(
  'company_products',
  {
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    productId: smallint('product_id').notNull().references(() => products.id),
    firstTick: bigint('first_tick', { mode: 'bigint' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.productId] })],
);

/**
 * Kalıcı emirler — oyuncunun önceden tanımladığı kural, motor her tur uygular.
 *
 * docs/00'ın 3. ilkesi "oyuncu offline'ken ekonomi devam eder" der; bu tablo
 * oyuncunun o ekonomiye offline'ken KATILMASINI sağlar. Otomasyon değil,
 * delege edilmiş karardır: hedefi ve fiyat sınırını oyuncu koyar.
 */
export const standingOrders = pgTable(
  'standing_orders',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').notNull(),
    productId: smallint('product_id').notNull().references(() => products.id),
    kind: text('kind').notNull(),
    targetQuantity: qtyCol('target_quantity').notNull(),
    maxPrice: moneyCol('max_price'),
    minPrice: moneyCol('min_price'),
    enabled: boolean('enabled').notNull().default(true),
    lastRunTick: bigint('last_run_tick', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('standing_orders_unique').on(t.facilityId, t.productId, t.kind)],
);

/**
 * NPC karakteri — hepsi aynı davranmaz: 8 arketip, parametreler ±%15 dağıtılır
 * (madde 24, docs/07 §9).
 *
 * Şirketin 1:1 uzantısıdır. NPC gerçek bir şirkettir: aynı tablolar, aynı
 * kurallar, aynı defter. Ayrıcalığı yoktur — yalnız kararlarını insan yerine
 * kod verir. Bu tablo o kararın parametreleridir.
 */
export const npcProfiles = pgTable(
  'npc_profiles',
  {
    companyId: uuid('company_id').primaryKey().references(() => companies.id, { onDelete: 'cascade' }),
    archetype: text('archetype').notNull(),
    riskTolerance: doublePrecision('risk_tolerance').notNull(),
    targetMargin: doublePrecision('target_margin').notNull(),
    qualityTarget: doublePrecision('quality_target').notNull(),
    /** Kaç turluk stok hedefleniyor (madde 26). */
    inventoryTargetTicks: smallint('inventory_target_ticks').notNull(),
    /** 0 = maliyet+marj fiyatlar · 1 = tamamen piyasayı takip eder. */
    priceAggressiveness: doublePrecision('price_aggressiveness').notNull(),
    investmentAggressiveness: doublePrecision('investment_aggressiveness').notNull(),
    preferredSectors: smallint('preferred_sectors').array().notNull().default([]),
    maxDebtRatio: doublePrecision('max_debt_ratio').notNull().default(0.5),
    cashReserveRatio: doublePrecision('cash_reserve_ratio').notNull().default(0.15),
    /** Stratejik kararlar her turda değil, bu aralıkla verilir (maliyet). */
    strategyIntervalTicks: smallint('strategy_interval_ticks').notNull().default(96),
    lastStrategyTick: bigint('last_strategy_tick', { mode: 'bigint' }).notNull().default(0n),
  },
  (t) => [index('npc_profiles_strategy').on(t.lastStrategyTick)],
);
