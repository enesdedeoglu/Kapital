import {
  boolean, doublePrecision, integer, jsonb, numeric, pgTable, primaryKey,
  serial, smallint, text, timestamp, uuid, bigint,
} from 'drizzle-orm/pg-core';
import { moneyCol, qtyCol } from './_types.js';
import { facilityCat } from './enums.js';
import { users } from './identity.js';

export const cities = pgTable('cities', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  populationIndex: doublePrecision('population_index').notNull(),
  incomeIndex: doublePrecision('income_index').notNull(),
  landCostIndex: doublePrecision('land_cost_index').notNull(),
  industrialBonus: doublePrecision('industrial_bonus').notNull().default(1),
  agricultureBonus: doublePrecision('agriculture_bonus').notNull().default(1),
  consumerDemandIndex: doublePrecision('consumer_demand_index').notNull(),
  logisticsModifier: doublePrecision('logistics_modifier').notNull().default(1),
  hasPort: boolean('has_port').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
});

export const cityDistances = pgTable(
  'city_distances',
  {
    originCityId: smallint('origin_city_id').notNull().references(() => cities.id),
    destinationCityId: smallint('destination_city_id').notNull().references(() => cities.id),
    distanceIndex: doublePrecision('distance_index').notNull(),
    transitTicks: smallint('transit_ticks').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.originCityId, t.destinationCityId] })],
);

export const productCategories = pgTable('product_categories', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  priceWeight: doublePrecision('price_weight').notNull(),
  qualityWeight: doublePrecision('quality_weight').notNull(),
  brandWeight: doublePrecision('brand_weight').notNull(),
});

export const products = pgTable('products', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  categoryId: smallint('category_id').notNull().references(() => productCategories.id),
  unit: text('unit').notNull(),
  baseReferencePrice: moneyCol('base_reference_price').notNull(),
  baseDemand: doublePrecision('base_demand').notNull().default(0),
  priceSensitivity: doublePrecision('price_sensitivity').notNull().default(1),
  qualitySensitivity: doublePrecision('quality_sensitivity').notNull().default(1),
  brandSensitivity: doublePrecision('brand_sensitivity').notNull().default(1),
  reservationPriceMult: doublePrecision('reservation_price_mult').notNull().default(3),
  shelfLifeTicks: integer('shelf_life_ticks'),
  qualityDecayRate: doublePrecision('quality_decay_rate').notNull().default(0),
  weightPerUnit: doublePrecision('weight_per_unit').notNull().default(1),
  unlockLevel: smallint('unlock_level').notNull().default(1),
  isRawMaterial: boolean('is_raw_material').notNull().default(false),
  isIntermediate: boolean('is_intermediate').notNull().default(false),
  isRetailProduct: boolean('is_retail_product').notNull().default(false),
  npcMinLiquidity: doublePrecision('npc_min_liquidity').notNull().default(0),
  npcTargetMarketShare: doublePrecision('npc_target_market_share').notNull().default(0.5),
  isActive: boolean('is_active').notNull().default(true),
});

export const worldMarket = pgTable('world_market', {
  productId: smallint('product_id').primaryKey().references(() => products.id),
  importable: boolean('importable').notNull().default(false),
  exportable: boolean('exportable').notNull().default(false),
  basePriceUsd: moneyCol('base_price_usd').notNull(),
  worldPriceIndex: doublePrecision('world_price_index').notNull().default(1),
  exportMultiplier: doublePrecision('export_multiplier').notNull().default(0.75),
  importMultiplier: doublePrecision('import_multiplier').notNull().default(1.35),
  exportDepthPct: doublePrecision('export_depth_pct').notNull().default(0.15),
  importDepthPct: doublePrecision('import_depth_pct').notNull().default(0.15),
  worldQuality: numeric('world_quality', { precision: 6, scale: 3 }).notNull().default('70'),
});

export const facilityTypes = pgTable('facility_types', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  category: facilityCat('category').notNull(),
  baseCost: moneyCol('base_cost').notNull(),
  baseCapacity: doublePrecision('base_capacity').notNull().default(0),
  maintenanceCost: moneyCol('maintenance_cost').notNull().default(0n),
  employeeSlots: smallint('employee_slots').notNull().default(0),
  storageCapacity: qtyCol('storage_capacity').notNull().default(0n),
  constructionTicks: smallint('construction_ticks').notNull().default(1),
  upgradeMultiplier: doublePrecision('upgrade_multiplier').notNull().default(0.75),
  unlockLevel: smallint('unlock_level').notNull().default(1),
  requiresPort: boolean('requires_port').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
});

export const facilityLevelCurve = pgTable('facility_level_curve', {
  level: smallint('level').primaryKey(),
  capacityMultiplier: doublePrecision('capacity_multiplier').notNull(),
  costExponent: doublePrecision('cost_exponent').notNull().default(1.55),
});

export const productionRecipes = pgTable('production_recipes', {
  id: serial('id').primaryKey(),
  facilityTypeId: smallint('facility_type_id').notNull().references(() => facilityTypes.id),
  outputProductId: smallint('output_product_id').notNull().references(() => products.id),
  outputQuantity: qtyCol('output_quantity').notNull(),
  cycleTicks: smallint('cycle_ticks').notNull().default(1),
  laborCost: moneyCol('labor_cost').notNull().default(0n),
  energyCost: moneyCol('energy_cost').notNull().default(0n),
  unlockLevel: smallint('unlock_level').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
});

export const recipeInputs = pgTable(
  'recipe_inputs',
  {
    recipeId: integer('recipe_id').notNull().references(() => productionRecipes.id, { onDelete: 'cascade' }),
    productId: smallint('product_id').notNull().references(() => products.id),
    quantity: qtyCol('quantity').notNull(),
    minQuality: numeric('min_quality', { precision: 6, scale: 3 }).notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.productId] })],
);

export const loanTerms = pgTable('loan_terms', {
  levelMin: smallint('level_min').primaryKey(),
  leverageRatio: doublePrecision('leverage_ratio').notNull(),
  interestRate: doublePrecision('interest_rate').notNull(),
  maxTermTicks: integer('max_term_ticks').notNull(),
  defaultAfterMissed: smallint('default_after_missed').notNull().default(3),
});

export const gameConfigs = pgTable(
  'game_configs',
  {
    key: text('key').notNull(),
    version: integer('version').notNull(),
    value: jsonb('value').notNull(),
    effectiveFromTick: bigint('effective_from_tick', { mode: 'bigint' }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.version] })],
);

export const adminAuditLog = pgTable('admin_audit_log', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedByDefaultAsIdentity(),
  adminId: uuid('admin_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  target: text('target').notNull(),
  beforeVal: jsonb('before_val'),
  afterVal: jsonb('after_val'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
