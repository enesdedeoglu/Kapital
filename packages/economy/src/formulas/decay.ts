import type { Qty } from '@kapital/shared';

export interface BatchDecayInput {
  readonly quality: number;
  readonly quantity: Qty;
  readonly expiresAtTick: bigint | null;
  /** Tur başına oransal kalite kaybı (products.quality_decay_rate). */
  readonly decayRate: number;
}

export interface BatchDecayResult {
  readonly quality: number;
  readonly expired: boolean;
}

/**
 * Lot bazlı bozulma — madde 37. Çelik, cam ve elektronik bozulmaz
 * (decayRate = 0, expiresAtTick = null).
 *
 * Kalite çarpımsal düşer: q ← q × (1 − rate). Raf ömrü dolduğunda lot düşülür.
 */
export function decayBatch(batch: BatchDecayInput, tickSeq: bigint): BatchDecayResult {
  if (batch.expiresAtTick !== null && tickSeq >= batch.expiresAtTick) {
    return { quality: 0, expired: true };
  }
  if (!(batch.decayRate > 0)) return { quality: batch.quality, expired: false };

  const next = batch.quality * (1 - batch.decayRate);
  return { quality: Math.max(0, Math.round(next * 1000) / 1000), expired: false };
}

/** Ürünün raf ömründen bitiş turunu hesaplar. */
export function expiryTick(producedInTick: bigint, shelfLifeTicks: number | null): bigint | null {
  return shelfLifeTicks === null ? null : producedInTick + BigInt(shelfLifeTicks);
}
