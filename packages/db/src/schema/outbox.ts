import { bigint, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Transactional outbox — tick transaction'ı içinde push gönderme yasağı (docs/06 §7). */
export const outbox = pgTable(
  'outbox',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedByDefaultAsIdentity(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').notNull(),
    tickId: bigint('tick_id', { mode: 'bigint' }),
    dedupeKey: text('dedupe_key').unique(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outbox_pending').on(t.id)],
);
