import {
  bigint, doublePrecision, index, integer, numeric, pgTable, primaryKey, smallint, uuid,
} from 'drizzle-orm/pg-core';
import { moneyCol, qtyCol } from './_types.js';
import { cities, products } from './world.js';

export const cityDemand = pgTable(
  'city_demand',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    cityId: smallint('city_id').notNull().references(() => cities.id),
    productId: smallint('product_id').notNull().references(() => products.id),
    demandUnits: qtyCol('demand_units').notNull(),
    /** ★ R10: şehrin harcama tavanı. Bu olmadan perakende sınırsız para basar. */
    demandBudget: moneyCol('demand_budget').notNull(),
    fulfilledUnits: qtyCol('fulfilled_units').notNull().default(0n),
    budgetLimitedUnits: qtyCol('budget_limited_units').notNull().default(0n),
    avgPrice: moneyCol('avg_price'),
  },
  (t) => [primaryKey({ columns: [t.tickId, t.cityId, t.productId] })],
);

/** Tur×tesis×ürün başına TEK satır — tek tek işlem saklanmaz (R7). */
export const retailSales = pgTable(
  'retail_sales',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    facilityId: uuid('facility_id').notNull(),
    productId: smallint('product_id').notNull(),
    companyId: uuid('company_id').notNull(),
    cityId: smallint('city_id').notNull(),
    quantity: qtyCol('quantity').notNull(),
    unitPrice: moneyCol('unit_price').notNull(),
    revenue: moneyCol('revenue').notNull(),
    cogs: moneyCol('cogs').notNull(),
    avgQuality: numeric('avg_quality', { precision: 6, scale: 3 }).notNull(),
    marketShare: doublePrecision('market_share').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.facilityId, t.productId] }),
    index('retail_sales_company').on(t.companyId, t.tickId),
  ],
);

export const priceHistory = pgTable(
  'price_history',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    productId: smallint('product_id').notNull().references(() => products.id),
    /** 0 = ulusal referans; >0 = şehir bazlı. PK'nın parçası olduğu için NULL olamaz. */
    cityId: smallint('city_id').notNull().default(0),
    weightedMedian: moneyCol('weighted_median').notNull(),
    emaReference: moneyCol('ema_reference').notNull(),
    openPrice: moneyCol('open_price'),
    highPrice: moneyCol('high_price'),
    lowPrice: moneyCol('low_price'),
    closePrice: moneyCol('close_price'),
    volume: qtyCol('volume').notNull().default(0n),
    tradeCount: integer('trade_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tickId, t.productId, t.cityId] })],
);

export const companyFinancials = pgTable(
  'company_financials',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    companyId: uuid('company_id').notNull(),
    revenue: moneyCol('revenue').notNull().default(0n),
    cogs: moneyCol('cogs').notNull().default(0n),
    salaryCost: moneyCol('salary_cost').notNull().default(0n),
    maintenance: moneyCol('maintenance').notNull().default(0n),
    shippingCost: moneyCol('shipping_cost').notNull().default(0n),
    interestCost: moneyCol('interest_cost').notNull().default(0n),
    tax: moneyCol('tax').notNull().default(0n),
    capex: moneyCol('capex').notNull().default(0n),
    netProfit: moneyCol('net_profit').notNull().default(0n),
    cashClose: moneyCol('cash_close').notNull(),
    inventoryValue: moneyCol('inventory_value').notNull().default(0n),
    facilityValue: moneyCol('facility_value').notNull().default(0n),
    debt: moneyCol('debt').notNull().default(0n),
    companyValue: moneyCol('company_value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tickId, t.companyId] })],
);

export const facilityFinancials = pgTable(
  'facility_financials',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    facilityId: uuid('facility_id').notNull(),
    companyId: uuid('company_id').notNull(),
    revenue: moneyCol('revenue').notNull().default(0n),
    cogs: moneyCol('cogs').notNull().default(0n),
    salary: moneyCol('salary').notNull().default(0n),
    rent: moneyCol('rent').notNull().default(0n),
    shipping: moneyCol('shipping').notNull().default(0n),
    maintenance: moneyCol('maintenance').notNull().default(0n),
    netProfit: moneyCol('net_profit').notNull().default(0n),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.facilityId] }),
    index('facility_financials_company').on(t.companyId, t.tickId),
  ],
);

export const economySnapshots = pgTable('economy_snapshots', {
  tickId: bigint('tick_id', { mode: 'bigint' }).primaryKey(),
  totalMoneySupply: numeric('total_money_supply', { precision: 38, scale: 4 }).notNull(),
  playerMoney: numeric('player_money', { precision: 38, scale: 4 }).notNull(),
  npcMoney: numeric('npc_money', { precision: 38, scale: 4 }).notNull(),
  faucetIn: numeric('faucet_in', { precision: 38, scale: 4 }).notNull(),
  sinkOut: numeric('sink_out', { precision: 38, scale: 4 }).notNull(),
  gameCpi: doublePrecision('game_cpi').notNull().default(1),
  medianCompanyValue: moneyCol('median_company_value').notNull().default(0n),
  activeCompanies: integer('active_companies').notNull().default(0),
  bankruptcies24h: integer('bankruptcies_24h').notNull().default(0),
});
