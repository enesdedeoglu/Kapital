import {
  bigint, bigserial, doublePrecision, index, integer, jsonb, numeric, pgTable,
  primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
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
  /** ★ R15: kredinin para arzı içindeki payı %20'yi aşarsa alarm. */
  creditOutstanding: moneyCol('credit_outstanding').notNull().default(0n),
  creditShare: doublePrecision('credit_share').notNull().default(0),
  activeLoans: integer('active_loans').notNull().default(0),
  defaults24h: integer('defaults_24h').notNull().default(0),
  /** Servet dağılımı — 0 eşit, 1 tekelleşmiş. Para arzı ve CPI bunu göstermez. */
  gini: doublePrecision('gini'),
  p99ToMedianRatio: doublePrecision('p99_to_median_ratio'),
});

/**
 * Piyasa sağlık skoru — madde 29, Ekonomi Direktörü'nün ölçüm yüzeyi.
 *
 * `city_id = 0` ULUSAL demektir (price_history ile aynı sözleşme): NULL bir
 * birincil anahtar kolonunda kullanılamaz.
 */
export const marketHealth = pgTable(
  'market_health',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    productId: smallint('product_id').notNull().references(() => products.id),
    cityId: smallint('city_id').notNull().default(0),
    score: numeric('score', { precision: 5, scale: 2 }).notNull(),
    band: text('band').notNull(),
    supplyUnits: qtyCol('supply_units').notNull().default(0n),
    demandUnits: qtyCol('demand_units').notNull().default(0n),
    fSupply: doublePrecision('f_supply').notNull(),
    fSellers: doublePrecision('f_sellers').notNull(),
    fBuyers: doublePrecision('f_buyers').notNull(),
    fDepth: doublePrecision('f_depth').notNull(),
    fStability: doublePrecision('f_stability').notNull(),
    fPlayerShare: doublePrecision('f_player_share').notNull(),
    /** Histerezis: bant değişimi için eşiğin üst üste aşılması gerekir. */
    streakBand: text('streak_band'),
    streakCount: smallint('streak_count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.productId, t.cityId] }),
    index('market_health_product').on(t.productId, t.tickId),
  ],
);

/** Oyuncuya görünen duyuru akışı — ED müdahaleleri ve dünya olayları. */
export const worldNotices = pgTable(
  'world_notices',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    kind: text('kind').notNull(),
    productId: smallint('product_id').references(() => products.id),
    cityId: smallint('city_id').references(() => cities.id),
    severity: text('severity').notNull().default('INFO'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload').notNull().default({}),
    /** Aynı olay her turda tekrar duyurulmasın: doğal anahtar. */
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('world_notices_dedupe').on(t.dedupeKey),
    index('world_notices_recent').on(t.tickId),
  ],
);

/**
 * ED direktifleri — NPC davranışına dokunan tek kanal (docs/07 §3).
 *
 * F0'da migration'a girmiş ama Drizzle şemasına eklenmemişti; drift testi
 * yalnız Drizzle → DB yönünü koruduğu için fark edilmedi. F7'de ters yön de
 * teste eklendi.
 */
export const npcDirectives = pgTable(
  'npc_directives',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    issuedTick: bigint('issued_tick', { mode: 'bigint' }).notNull(),
    expiresTick: bigint('expires_tick', { mode: 'bigint' }).notNull(),
    scope: text('scope').notNull(),
    productId: smallint('product_id').references(() => products.id),
    cityId: smallint('city_id').references(() => cities.id),
    lever: text('lever').notNull(),
    magnitude: doublePrecision('magnitude').notNull(),
    reason: text('reason').notNull(),
    healthScoreAtIssue: numeric('health_score_at_issue', { precision: 5, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('npc_directives_active').on(t.productId, t.expiresTick)],
);

/**
 * Dünya olayları — ekonomiye ETKİ EDEN olay (docs/03, madde 30/45).
 *
 * `world_notices` duyuru akışıdır; bu tablo etkidir. Bir ED müdahalesi
 * duyurudur ama etkisi `npc_directives`tedir; bir kuraklık ise hem etkidir
 * hem duyurulur. `created_by` NULL ise olay sistem tarafından üretilmiştir.
 */
export const worldEvents = pgTable(
  'world_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    scope: text('scope').notNull(),
    productId: smallint('product_id').references(() => products.id),
    cityId: smallint('city_id').references(() => cities.id),
    category: text('category'),
    demandMultiplier: doublePrecision('demand_multiplier').notNull().default(1),
    supplyMultiplier: doublePrecision('supply_multiplier').notNull().default(1),
    costMultiplier: doublePrecision('cost_multiplier').notNull().default(1),
    startTick: bigint('start_tick', { mode: 'bigint' }).notNull(),
    endTick: bigint('end_tick', { mode: 'bigint' }).notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('world_events_window').on(t.startTick, t.endTick)],
);

/**
 * Tur başına tesis üretim özeti — raporlama ve "neden durdu" teşhisi (docs/05 P1).
 *
 * `capacity` ile `produced` ayrı tutulur: aradaki fark teşhisin kendisidir,
 * `halted_reason` de onu adlandırır.
 *
 * `tick_id`'ye göre RANGE partition; Drizzle yalnız ana tabloyu tanır.
 */
export const productionRecords = pgTable(
  'production_records',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    facilityId: uuid('facility_id').notNull(),
    companyId: uuid('company_id').notNull(),
    recipeId: integer('recipe_id').notNull(),
    productId: smallint('product_id').notNull(),
    capacity: qtyCol('capacity').notNull(),
    produced: qtyCol('produced').notNull(),
    outputQuality: numeric('output_quality', { precision: 6, scale: 3 }).notNull(),
    inputCost: moneyCol('input_cost').notNull().default(0n),
    /** İşçilik ve enerji — üretim olmasa da ödenir, bu yüzden ayrı kolondur. */
    overheadCost: moneyCol('overhead_cost').notNull().default(0n),
    haltedReason: text('halted_reason'),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.facilityId] }),
    index('production_records_company').on(t.companyId, t.tickId),
  ],
);

/**
 * Tur başına NPC karar günlüğü — "NPC neden böyle davrandı" sorusunun cevabı.
 *
 * `kind`: PRICE · BUY · SELL · INVEST. Değerler her türde para ölçeğindedir
 * (fiyat ya da maliyet); karar bir değer değiştirmiyorsa NULL kalır.
 *
 * `tick_id`'ye göre RANGE partition; Drizzle yalnız ana tabloyu tanır.
 */
export const npcDecisions = pgTable(
  'npc_decisions',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    companyId: uuid('company_id').notNull(),
    productId: smallint('product_id').notNull(),
    kind: text('kind').notNull(),
    oldValue: moneyCol('old_value'),
    newValue: moneyCol('new_value'),
    reason: text('reason').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tickId, t.companyId, t.productId, t.kind] }),
    index('npc_decisions_company').on(t.companyId, t.tickId),
  ],
);
