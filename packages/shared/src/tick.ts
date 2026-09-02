/**
 * Oyun takvimi — docs/00 §5.
 * İş mantığında `Date.now()` KULLANILMAZ; tek zaman kaynağı tick sırasıdır.
 */
export const TICK_MINUTES = 15;
export const TICKS_PER_HOUR = 4;
export const TICKS_PER_DAY = 96;
export const TICKS_PER_SEASON = 672; // 7 gerçek gün
export const TICKS_PER_YEAR = 2688; // 28 gerçek gün · 4 mevsim

export type Season = 0 | 1 | 2 | 3; // İlkbahar, Yaz, Sonbahar, Kış

export function seasonOf(tickSeq: number): Season {
  return (Math.floor((tickSeq % TICKS_PER_YEAR) / TICKS_PER_SEASON) % 4) as Season;
}

export const SEASON_NAMES = ['İlkbahar', 'Yaz', 'Sonbahar', 'Kış'] as const;

/** Deterministik RNG — docs/05 §6. `Math.random()` tick içinde yasaktır. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tick + faz + shard + varlık için çakışmayan tohum üretir. */
export function deriveSeed(tickSeed: bigint, phase: number, shard: number, entity: string): number {
  let h = Number(BigInt.asUintN(32, tickSeed)) ^ (phase * 0x9e3779b1) ^ (shard * 0x85ebca6b);
  for (let i = 0; i < entity.length; i++) {
    h = Math.imul(h ^ entity.charCodeAt(i), 0xc2b2ae35);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
