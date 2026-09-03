import { loadConfigSnapshot, type ConfigSnapshot } from '@kapital/config';
import type { Sql } from '@kapital/db';
import { deriveSeed, mulberry32, seasonOf, type Season } from '@kapital/shared';

export interface EngineTick {
  readonly id: bigint;
  readonly seq: bigint;
  readonly rngSeed: bigint;
  readonly season: Season;
  readonly isCatchUp: boolean;
  readonly config: ConfigSnapshot;
}

/**
 * Tur bağlamı. Config P0'da ANLIK GÖRÜNTÜ olarak alınır: admin turun ortasında
 * bir parametre değiştirse bile tur yarısı eski yarısı yeni değerle hesaplanmaz (R12).
 */
export async function buildTickContext(sql: Sql, tick: {
  id: bigint; seq: bigint; rng_seed: bigint; season: number; is_catch_up: boolean;
  config_version: unknown;
}): Promise<EngineTick> {
  const config = await loadConfigSnapshot(sql, tick.seq);
  return {
    id: tick.id,
    seq: tick.seq,
    rngSeed: tick.rng_seed,
    season: seasonOf(Number(tick.seq)) as Season,
    isCatchUp: tick.is_catch_up,
    config,
  };
}

/**
 * Faz + shard + varlık için çakışmayan, tekrarlanabilir RNG.
 * `Math.random()` tick içinde YASAKTIR: idempotency ve hata ayıklama buna bağlı.
 */
export function rngFor(tick: EngineTick, phase: number, shard: number, entity: string): () => number {
  return mulberry32(deriveSeed(tick.rngSeed, phase, shard, entity));
}

export function configValue<T>(tick: EngineTick, key: string, fallback: T): T {
  const value = tick.config.values[key];
  return value === undefined ? fallback : (value as T);
}
