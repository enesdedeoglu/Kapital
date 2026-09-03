import { TICKS_PER_YEAR, type Season } from '@kapital/shared';

/**
 * İş çevrimi — madde 19'da formülde vardı ama kaynağı tanımsızdı (docs/11 C5).
 * Sinüzoidal, periyot 1 oyun yılı (2688 tur), genlik config'ten.
 *
 * Deterministiktir: aynı tur her zaman aynı değeri verir. Oyuncular çevrimi
 * öğrenip ona göre yatırım yapabilir — bu kasıtlıdır.
 */
export function economicCycle(tickSeq: bigint, amplitude: number): number {
  const phase = Number(tickSeq % BigInt(TICKS_PER_YEAR)) / TICKS_PER_YEAR;
  return 1 + amplitude * Math.sin(2 * Math.PI * phase);
}

/**
 * Mevsim çarpanı. Ürün bazlı tablo config'ten gelir; tanımsız ürün için 1,0.
 * Tarım ürünlerinde hasat mevsimi arzı artırır, kış talebi kaydırır.
 */
export function seasonMultiplier(
  season: Season,
  table: Readonly<Record<string, readonly number[]>> | undefined,
  productCode: string,
): number {
  const row = table?.[productCode];
  if (!row || row.length !== 4) return 1;
  return row[season] ?? 1;
}

/** Talep gürültüsü — madde 19: küçük olmalı, stratejiyi bozmamalı. */
export function demandNoise(rng: () => number, min = 0.97, max = 1.03): number {
  return min + rng() * (max - min);
}
