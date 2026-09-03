import { asMoney, divRoundHalfEven, mulMoney, type Money, type Qty } from '@kapital/shared';

export interface PriceSample {
  readonly price: Money;
  readonly quantity: Qty;
}

/**
 * Miktar ağırlıklı MEDYAN — madde 22 ve R8.
 *
 * Ortalama kullanılmaz: tek bir uç işlem ortalamayı oynatır, medyanı oynatamaz.
 * Ayrıca [trimLow, trimHigh] yüzdelik bandı dışındaki işlemler tamamen atılır;
 * böylece iki oyuncunun birbirine 1.000 ₺'den çelik satması endeksi kirletemez.
 * İşlem İPTAL EDİLMEZ — yalnız endekse girmez (madde 48).
 */
export function weightedMedian(
  samples: readonly PriceSample[],
  trimLow = 0.1,
  trimHigh = 0.9,
): Money | null {
  const valid = samples.filter((s) => s.price > 0n && s.quantity > 0n);
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  const total = sorted.reduce((sum, s) => sum + (s.quantity as bigint), 0n);

  // Uç bandı kırp (tek örnekte kırpma yapılmaz)
  const lowCut = (total * BigInt(Math.round(trimLow * 1000))) / 1000n;
  const highCut = (total * BigInt(Math.round(trimHigh * 1000))) / 1000n;

  let running = 0n;
  const kept: PriceSample[] = [];
  for (const sample of sorted) {
    const start = running;
    running += sample.quantity as bigint;
    if (sorted.length > 2 && (running <= lowCut || start >= highCut)) continue;
    kept.push(sample);
  }
  const pool = kept.length > 0 ? kept : sorted;

  const poolTotal = pool.reduce((sum, s) => sum + (s.quantity as bigint), 0n);
  const half = poolTotal / 2n;
  let acc = 0n;
  for (const sample of pool) {
    acc += sample.quantity as bigint;
    if (acc >= half) return sample.price;
  }
  return pool[pool.length - 1]!.price;
}

/**
 * EMA yumuşatma — R2 salınım engelleyici.
 * `ema = α × medyan + (1−α) × önceki_ema`
 *
 * Ayrıca devre kesici: tek turda %`clampPct`'ten fazla hareket kırpılır ve
 * çağırana `clamped` olarak bildirilir (PriceShock event'i için).
 */
export function smoothReference(
  median: Money,
  previousEma: Money,
  alpha: number,
  clampPct: number,
): { value: Money; clamped: boolean } {
  if (previousEma <= 0n) return { value: median, clamped: false };

  const blended = mulMoney(median, alpha).value + mulMoney(previousEma, 1 - alpha).value;
  const maxUp = mulMoney(previousEma, 1 + clampPct).value;
  const maxDown = mulMoney(previousEma, 1 - clampPct).value;

  if (blended > maxUp) return { value: maxUp, clamped: true };
  if (blended < maxDown) return { value: maxDown, clamped: true };
  return { value: asMoney(blended), clamped: false };
}

/** Fiyat serisinin oynaklığı — market health'in `f_stability` bileşeni. */
export function priceVolatility(series: readonly Money[]): number {
  if (series.length < 2) return 0;
  const values = series.map(Number);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/** Ağırlıklı ortalama fiyat — raporlama için (endeks için DEĞİL). */
export function weightedAverage(samples: readonly PriceSample[]): Money | null {
  const total = samples.reduce((sum, s) => sum + (s.quantity as bigint), 0n);
  if (total === 0n) return null;
  const weighted = samples.reduce((sum, s) => sum + (s.price as bigint) * (s.quantity as bigint), 0n);
  return asMoney(divRoundHalfEven(weighted, total));
}
