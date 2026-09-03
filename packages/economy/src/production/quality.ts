export interface OutputQualityInput {
  /** Tüketilen girdilerin miktar ağırlıklı ortalama kalitesi (0–100). */
  readonly inputQuality: number;
  /** 0..1 — AR-GE. F11'e kadar 0. */
  readonly technologyBonus: number;
  /** 0..1 — personel. F11'e kadar sabit 0,5. */
  readonly staffScore: number;
  /** 0–100 — tesis durumu. */
  readonly condition: number;
  /** Seed'li RNG. `Math.random()` YASAK. */
  readonly rng: () => number;
  /** ± sapma bandı (madde 14: küçük olmalı, stratejiyi bozmamalı). */
  readonly variance?: number;
}

/**
 * Üretim çıktı kalitesi — madde 14.
 *
 *   girdi_kalitesi × 0,70
 * + teknoloji      × 0,15
 * + personel       × 0,10
 * + tesis_durumu   × 0,05
 * + rastgele sapma (−1,5 … +1,5)
 *
 * Bileşenlerin hepsi 0–100 ölçeğine getirilir. Rastgelelik KÜÇÜK tutulur:
 * ekonomik stratejiyi bozacak kadar büyük olursa oyuncu planlama yapamaz.
 */
export function outputQuality(input: OutputQualityInput): number {
  const variance = input.variance ?? 1.5;
  const noise = (input.rng() * 2 - 1) * variance;

  const value =
    input.inputQuality * 0.7 +
    input.technologyBonus * 100 * 0.15 +
    input.staffScore * 100 * 0.1 +
    input.condition * 0.05 +
    noise;

  return clampQuality(value);
}

/**
 * Girdisiz üretim (tarla, maden) için taban kalite.
 * Toprak/cevher kalitesi şehrin sektör bonusuyla ölçeklenir: Konya'da buğday
 * İstanbul'dakinden kaliteli çıkar.
 */
export function rawInputQuality(baseQuality: number, cityBonus: number): number {
  return clampQuality(baseQuality * cityBonus);
}

export const clampQuality = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value * 1000) / 1000));
