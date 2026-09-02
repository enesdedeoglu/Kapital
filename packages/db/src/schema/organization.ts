import {
  bigint, doublePrecision, index, numeric, pgTable, smallint, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companyKind, companyStatus } from './enums.js';
import { moneyCol, qtyCol } from './_types.js';
import { users } from './identity.js';
import { cities } from './world.js';

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
