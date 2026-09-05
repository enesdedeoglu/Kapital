import {
  bigint, bigserial, boolean, doublePrecision, index, integer, numeric, pgEnum, pgTable,
  smallint, text, timestamp, unique, uuid,
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

export const productionStatus = pgEnum('production_status', ['RUNNING', 'COMPLETED', 'CANCELLED']);
export const shipmentStatus = pgEnum('shipment_status', [
  'IN_TRANSIT', 'DELIVERED', 'PARTIAL', 'CANCELLED',
]);

/**
 * Çok turlu üretim döngüleri (docs/03 §4 · docs/05 P1).
 *
 * Girdiler işin BAŞINDA tüketilir, çıktı BİTİŞİNDE eklenir. `cycle_ticks = 1`
 * olan reçeteler aynı turda başlayıp biter — tek kod yolu, özel durum yok.
 */
export const productionJobs = pgTable(
  'production_jobs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    recipeId: integer('recipe_id').notNull().references(() => productionRecipes.id),
    startedTick: bigint('started_tick', { mode: 'bigint' }).notNull(),
    completeTick: bigint('complete_tick', { mode: 'bigint' }).notNull(),
    plannedOutput: qtyCol('planned_output').notNull(),
    inputQuality: numeric('input_quality', { precision: 6, scale: 3 }).notNull(),
    outputQuality: numeric('output_quality', { precision: 6, scale: 3 }).notNull(),
    /** Girdilerin toplam maliyeti + işçilik/enerji; `unit_cost` bunun birim payıdır. */
    inputCost: moneyCol('input_cost').notNull().default(0n),
    unitCost: moneyCol('unit_cost').notNull().default(0n),
    status: productionStatus('status').notNull().default('RUNNING'),
  },
  (t) => [
    /** İdempotency anahtarı: P1 tekrar koşarsa aynı tesis aynı turda ikinci kez üretime başlayamaz (docs/05 §3). */
    unique('one_job_per_facility_per_tick').on(t.facilityId, t.startedTick),
    index('production_jobs_pending').on(t.completeTick),
    index('production_jobs_company').on(t.companyId, t.startedTick),
  ],
);

/**
 * SEVKİYAT — A3 kararının uygulama noktası (docs/03 §5).
 *
 * Mesafe yalnız maliyet değil SÜREdir: mal yola çıkınca satıcının stoğundan
 * düşer, alıcıya `arrival_tick`'te ulaşır. Arada hiçbir envanterde değildir.
 * Bu olmadan lojistik bir vergiden ibaret kalır.
 *
 * Şirket alanları YUMUŞAK referanstır — 0008'de FK'ları düşürüldü: geçmiş,
 * şirket silinse de kalmalıdır.
 */
export const shipments = pgTable(
  'shipments',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    /** Kaynak işlem — `market_trades` bileşik anahtarına yumuşak referans. */
    tradeTickId: bigint('trade_tick_id', { mode: 'bigint' }),
    tradeId: bigint('trade_id', { mode: 'bigint' }),
    fromCompanyId: uuid('from_company_id').notNull(),
    toCompanyId: uuid('to_company_id').notNull(),
    fromFacilityId: uuid('from_facility_id').references(() => facilities.id, { onDelete: 'set null' }),
    toFacilityId: uuid('to_facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    productId: smallint('product_id').notNull().references(() => products.id),
    quantity: qtyCol('quantity').notNull(),
    /** Kısmî teslimat: depo dolduğunda kalanı yolda kalır (`PARTIAL`). */
    deliveredQuantity: qtyCol('delivered_quantity').notNull().default(0n),
    quality: numeric('quality', { precision: 6, scale: 3 }).notNull(),
    unitCost: moneyCol('unit_cost').notNull(),
    shippingCost: moneyCol('shipping_cost').notNull().default(0n),
    expiresAtTick: bigint('expires_at_tick', { mode: 'bigint' }),
    dispatchedTick: bigint('dispatched_tick', { mode: 'bigint' }).notNull(),
    arrivalTick: bigint('arrival_tick', { mode: 'bigint' }).notNull(),
    status: shipmentStatus('status').notNull().default('IN_TRANSIT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Tick motorunun taradığı tek index: vadesi gelmiş sevkiyatlar (madde 54). */
    index('shipments_arriving').on(t.arrivalTick),
    index('shipments_by_buyer').on(t.toCompanyId, t.arrivalTick),
  ],
);
