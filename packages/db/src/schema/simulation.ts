import {
  bigint, boolean, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp,
} from 'drizzle-orm/pg-core';
import { phaseStatus, tickStatus } from './enums.js';

export const economicTicks = pgTable(
  'economic_ticks',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedByDefaultAsIdentity(),
    seq: bigint('seq', { mode: 'bigint' }).notNull().unique(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: tickStatus('status').notNull().default('PENDING'),
    isCatchUp: boolean('is_catch_up').notNull().default(false),
    configVersion: jsonb('config_version').notNull().default({}),
    rngSeed: bigint('rng_seed', { mode: 'bigint' }).notNull(),
    season: smallint('season').notNull().default(0),
    durationMs: integer('duration_ms'),
    metrics: jsonb('metrics'),
  },
  (t) => [index('economic_ticks_status').on(t.status)],
);

export const tickPhaseRuns = pgTable(
  'tick_phase_runs',
  {
    tickId: bigint('tick_id', { mode: 'bigint' }).notNull().references(() => economicTicks.id, { onDelete: 'cascade' }),
    phase: smallint('phase').notNull(),
    phaseCode: text('phase_code').notNull(),
    shardTotal: smallint('shard_total').notNull().default(1),
    shardDone: smallint('shard_done').notNull().default(0),
    status: phaseStatus('status').notNull().default('PENDING'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [primaryKey({ columns: [t.tickId, t.phase] })],
);
