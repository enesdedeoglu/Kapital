import {
  bigint, boolean, doublePrecision, index, integer, numeric, pgTable, smallint, text,
  timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { moneyCol, qtyCol } from './_types.js';
import { companies } from './organization.js';
import { cities, facilityTypes, productionRecipes, products } from './world.js';

export const facilities = pgTable(
  'facilities',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    facilityTypeId: smallint('facility_type_id').notNull().references(() => facilityTypes.id),
    cityId: smallint('city_id').notNull().references(() => cities.id),
    name: text('name'),
    level: smallint('level').notNull().default(1),
    condition: numeric('condition', { precision: 5, scale: 2 }).notNull().default('100'),
    technologyBonus: doublePrecision('technology_bonus').notNull().default(0),
    utilization: doublePrecision('utilization').notNull().default(1),
    /** MVP'de sabit 0,5; F11'de çalışanlardan türer (docs/11 B2). */
    staffScore: doublePrecision('staff_score').notNull().default(0.5),
    productionEnabled: boolean('production_enabled').notNull().default(true),
    activeRecipeId: integer('active_recipe_id').references(() => productionRecipes.id),
    storageCapacity: qtyCol('storage_capacity').notNull(),
    constructionCompleteAtTick: bigint('construction_complete_at_tick', { mode: 'bigint' }).notNull(),
    haltedReason: text('halted_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('facilities_by_company').on(t.companyId),
    index('facilities_construction').on(t.constructionCompleteAtTick),
  ],
);

export const inventories = pgTable(
  'inventories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').notNull().unique().references(() => facilities.id, { onDelete: 'cascade' }),
    capacity: qtyCol('capacity').notNull(),
    /** Trigger ile senkron tutulur; `CHECK (used_capacity <= capacity)` I4'ü garanti eder. */
    usedCapacity: qtyCol('used_capacity').notNull().default(0n),
  },
  (t) => [index('inventories_by_company').on(t.companyId)],
);

/**
 * Stok ASLA tek sayı değildir (madde 10). Aynı ürünün farklı kalite/maliyetteki
 * partileri ayrı satırlardır; UI'daki toplamlar türetilir, saklanmaz.
 */
export const inventoryBatches = pgTable(
  'inventory_batches',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedByDefaultAsIdentity(),
    inventoryId: uuid('inventory_id').notNull().references(() => inventories.id, { onDelete: 'cascade' }),
    productId: smallint('product_id').notNull().references(() => products.id),
    quantity: qtyCol('quantity').notNull(),
    /** Kargoya verilmiş ama teslim edilmemiş miktar — çift satışı engeller. */
    reservedQuantity: qtyCol('reserved_quantity').notNull().default(0n),
    quality: numeric('quality', { precision: 6, scale: 3 }).notNull(),
    unitCost: moneyCol('unit_cost').notNull(),
    producedInTick: bigint('produced_in_tick', { mode: 'bigint' }),
    expiresAtTick: bigint('expires_at_tick', { mode: 'bigint' }),
    sourceCompanyId: uuid('source_company_id').references(() => companies.id),
    sourceFacilityId: uuid('source_facility_id').references(() => facilities.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('batches_expiring').on(t.expiresAtTick)],
);
