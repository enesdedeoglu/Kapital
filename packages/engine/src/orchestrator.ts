import type { Sql } from '@kapital/db';
import { InvariantViolation, seasonOf, TICK_MINUTES, toJson } from '@kapital/shared';
import { buildTickContext, type EngineTick } from './context.js';
import { runOpenPhase } from './phases/p0-open.js';
import { runProducePhase } from './phases/p1-produce.js';
import { runExchangePhase } from './phases/p2-exchange.js';
import { runRetailPhase } from './phases/p3-retail.js';
import { runUpkeepPhase } from './phases/p4-upkeep.js';
import { runSettlePhase } from './phases/p5-settle.js';
import { runGovernPhase } from './phases/p6-govern.js';
import { runClosePhase } from './phases/p7-close.js';
import { ACTIVE_PHASES, type PhaseDefinition } from './phases.js';

/**
 * Aynı anda tek orchestrator koşsun — Redis yerine PostgreSQL danışma kilidi (ADR-0008).
 *
 * Oturum bazlı danışma kilidi ALINDIĞI BAĞLANTIDA bırakılmalıdır. Havuzdan
 * rastgele bağlantılarla çalışılırsa `pg_advisory_unlock` başka bir oturumda
 * koşar, sessizce başarısız olur ve kilit sonsuza kadar tutulu kalır —
 * sonraki tüm turlar sessizce atlanır. Bu yüzden bağlantı rezerve edilir.
 */
const LEADER_LOCK_KEY = 4_242_001n;

export interface TickResult {
  tickId: bigint;
  seq: bigint;
  durationMs: number;
  phases: Record<string, { durationMs: number; overBudget: boolean; result: unknown }>;
  skipped: boolean;
}

const RUNNERS: Record<number, (sql: Sql, tick: EngineTick) => Promise<unknown>> = {
  0: runOpenPhase,
  1: runProducePhase,
  2: runExchangePhase,
  3: runRetailPhase,
  4: runUpkeepPhase,
  5: runSettlePhase,
  6: runGovernPhase,
  7: runClosePhase,
};

/**
 * Bir ekonomik turu baştan sona koşar.
 *
 * Idempotency üç katmanlıdır (docs/05 §3):
 *   1. `tick_phase_runs` — tamamlanmış faz tekrar koşmaz
 *   2. Doğal anahtar — tüm etki tabloları `tick_id` içerir, INSERT'ler
 *      `ON CONFLICT DO NOTHING`
 *   3. Nakit defterden türer — defter yazılmadıysa bakiye de değişmez
 */
export async function runTick(sql: Sql, opts: { isCatchUp?: boolean } = {}): Promise<TickResult> {
  const leader = await sql.reserve();
  const [lock] = await leader<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${LEADER_LOCK_KEY}) AS ok`;
  if (!lock?.ok) {
    leader.release();
    return { tickId: 0n, seq: 0n, durationMs: 0, phases: {}, skipped: true };
  }

  const started = Date.now();
  try {
    const tick = await openTick(sql, opts.isCatchUp ?? false);
    const phases: TickResult['phases'] = {};

    for (const definition of ACTIVE_PHASES) {
      const outcome = await runPhase(sql, tick, definition);
      phases[definition.code] = outcome;
    }

    const durationMs = Date.now() - started;
    await sql`
      UPDATE economic_ticks
         SET status = 'COMPLETED', completed_at = NOW(), duration_ms = ${durationMs},
             metrics = ${toJson(phases)}::text::jsonb
       WHERE id = ${tick.id}`;

    return { tickId: tick.id, seq: tick.seq, durationMs, phases, skipped: false };
  } finally {
    // Kilit ALINDIĞI bağlantıda bırakılır; havuzdaki başka bağlantı işe yaramaz.
    await leader`SELECT pg_advisory_unlock(${LEADER_LOCK_KEY})`;
    leader.release();
  }
}

/** Sıradaki turu oluşturur (veya yarım kalmışı devralır) ve fazlarını hazırlar. */
async function openTick(sql: Sql, isCatchUp: boolean): Promise<EngineTick> {
  const [existing] = await sql<Record<string, never>[]>`
    SELECT id, seq, rng_seed, season, is_catch_up, config_version
    FROM economic_ticks WHERE status IN ('PENDING','RUNNING') ORDER BY seq LIMIT 1`;

  /*
   * ★ TURUN TOHUMU DUVAR SAATİNDEN TÜREMEZ (R57).
   *
   * Önce `EXTRACT(EPOCH FROM NOW())` idi. ADR-0003 "zaman tick.seq'tir,
   * rastgelelik enjekte edilir" der ve `rngFor` dokümanı "aynı tohum aynı
   * dünyayı üretir" diye söz verir — ama turun KENDİ tohumu her koşuda
   * farklıydı, yani söz hiç tutulmuyordu.
   *
   * Ölçüldü: aynı tohum ve aynı kodla iki koşu 11/13 ve 12/13 verdi; biri
   * 2, diğeri 4 dünya olayı üretti. Kapının "tohum" parametresi yalnız
   * OYUNCU dünyasının kurulumunu tohumluyordu; ekonomik olaylar her koşuda
   * yeniden zar atıyordu.
   *
   * Artık dünya tohumu + sıra sayısından türer: aynı dünya, aynı tur, aynı
   * zar. Üretimde de değerlidir — bir turu yeniden oynatıp hata ayıklamak
   * ancak böyle mümkün.
   */
  const [seedRow] = await sql<{ seed: string }[]>`
    SELECT (value->>'seed') AS seed FROM game_configs
     WHERE key = 'world.rng' ORDER BY version DESC LIMIT 1`;
  const worldSeed = BigInt(seedRow?.seed ?? '20260101');
  const row = existing ?? (await sql<Record<string, never>[]>`
    INSERT INTO economic_ticks (seq, scheduled_at, started_at, status, rng_seed, season, is_catch_up)
    SELECT COALESCE(MAX(seq), 0) + 1,
           NOW() + ${TICK_MINUTES + ' minutes'}::interval, NOW(), 'RUNNING',
           ((${worldSeed}::bigint * 2654435761
             + (COALESCE(MAX(seq), 0) + 1) * 40503) % 9223372036854775807),
           0, ${isCatchUp}
    FROM economic_ticks
    RETURNING id, seq, rng_seed, season, is_catch_up, config_version`)[0]!;

  const seq = row.seq as unknown as bigint;
  await sql`
    UPDATE economic_ticks SET status = 'RUNNING', started_at = COALESCE(started_at, NOW()),
                              season = ${seasonOf(Number(seq))}
     WHERE id = ${row.id as unknown as bigint}`;

  for (const definition of ACTIVE_PHASES) {
    await sql`
      INSERT INTO tick_phase_runs (tick_id, phase, phase_code, shard_total)
      VALUES (${row.id as unknown as bigint}, ${definition.phase}, ${definition.code}, 1)
      ON CONFLICT (tick_id, phase) DO NOTHING`;
  }

  return buildTickContext(sql, row as never);
}

async function runPhase(sql: Sql, tick: EngineTick, definition: PhaseDefinition) {
  const [state] = await sql<{ status: string }[]>`
    SELECT status FROM tick_phase_runs WHERE tick_id = ${tick.id} AND phase = ${definition.phase}`;
  if (state?.status === 'COMPLETED') {
    return { durationMs: 0, overBudget: false, result: 'zaten tamamlandı' };
  }

  await sql`
    UPDATE tick_phase_runs SET status = 'RUNNING', started_at = NOW(), error = NULL
     WHERE tick_id = ${tick.id} AND phase = ${definition.phase}`;

  const started = Date.now();
  try {
    const result = await RUNNERS[definition.phase]!(sql, tick);
    const durationMs = Date.now() - started;

    await sql`
      UPDATE tick_phase_runs SET status = 'COMPLETED', completed_at = NOW(), shard_done = 1
       WHERE tick_id = ${tick.id} AND phase = ${definition.phase}`;

    if (definition.phase === 7) {
      const close = result as { invariantsOk: boolean; violations: unknown[] };
      if (!close.invariantsOk) {
        throw new InvariantViolation('TICK', 'tur sonunda değişmez ihlali', {
          tick: tick.seq.toString(), violations: close.violations,
        });
      }
    }
    return { durationMs, overBudget: durationMs > definition.budgetMs, result };
  } catch (error) {
    await sql`
      UPDATE tick_phase_runs SET status = 'FAILED', error = ${String(error)}
       WHERE tick_id = ${tick.id} AND phase = ${definition.phase}`;
    await sql`UPDATE economic_ticks SET status = 'FAILED' WHERE id = ${tick.id}`;
    throw error;
  }
}
