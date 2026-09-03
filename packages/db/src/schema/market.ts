import {
  bigint, boolean, doublePrecision, index, numeric, pgEnum, pgTable, primaryKey,
  smallint, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { moneyCol, qtyCol } from './_types.js';
import { facilities } from './operations.js';
import { companies } from './organization.js';
import { cities, products } from './world.js';

export const orderSide = pgEnum('order_side', ['BUY', 'SELL']);
export const orderStatus = pgEnum('order_status', ['OPEN', 'PARTIAL', 'FILLED', 'CANCELLED', 'EXPIRED']);

export const marketOrders = pgTable(
  'market_orders',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedByDefaultAsIdentity(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'cascade' }),
    productId: smallint('product_id').notNull().references(() => products.id),
    cityId: smallint('city_id').notNull().references(() => cities.id),
    side: orderSide('side').notNull(),
    quantity: qtyCol('quantity').notNull(),
    remainingQuantity: qtyCol('remaining_quantity').notNull(),
    pricePerUnit: moneyCol('price_per_unit').notNull(),
    quality: numeric('quality', { precision: 6, scale: 3 }).notNull().default('70'),
    minQuality: numeric('min_quality', { precision: 6, scale: 3 }).notNull().default('0'),
    maxDeliveryDistance: doublePrecision('max_delivery_distance'),
    escrowAmount: moneyCol('escrow_amount').notNull().default(0n),
    status: orderStatus('status').notNull().default('OPEN'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAtTick: bigint('expires_at_tick', { mode: 'bigint' }).notNull(),
  },
  (t) => [index('orders_by_company').on(t.companyId, t.status)],
);

export const marketTrades = pgTable(
  'market_trades',
  {
    id: bigint('id', { mode: 'bigint' }).notNull(),
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull(),
    buyOrderId: bigint('buy_order_id', { mode: 'bigint' }),
    sellOrderId: bigint('sell_order_id', { mode: 'bigint' }),
    buyerCompanyId: uuid('buyer_company_id').notNull(),
    sellerCompanyId: uuid('seller_company_id').notNull(),
    productId: smallint('product_id').notNull(),
    fromCityId: smallint('from_city_id').notNull(),
    toCityId: smallint('to_city_id').notNull(),
    quantity: qtyCol('quantity').notNull(),
    pricePerUnit: moneyCol('price_per_unit').notNull(),
    quality: numeric('quality', { precision: 6, scale: 3 }).notNull(),
    shippingCost: moneyCol('shipping_cost').notNull().default(0n),
    isExcludedFromIndex: boolean('is_excluded_from_index').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tickId, t.id] })],
);

export const retailOffers = pgTable(
  'retail_offers',
  {
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    productId: smallint('product_id').notNull().references(() => products.id),
    sellingPrice: moneyCol('selling_price').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.productId] })],
);
