import { mulMoney, type Money } from '@kapital/shared';

export type FacilityCategory =
  | 'RETAIL' | 'AGRICULTURE' | 'LIVESTOCK' | 'MINING' | 'INDUSTRY' | 'LOGISTICS';

export interface CapacityInput {
  /** `facility_types.base_capacity` — Lv1, %100 durumdaki tur başına çıktı. */
  readonly baseCapacity: number;
  /** `facility_level_curve.capacity_multiplier` — Lv1 %100 … Lv10 %1150. */
  readonly levelMultiplier: number;
  /** 0–100. Yıpranmış tesis daha az üretir. */
  readonly condition: number;
  /** Şehrin sektör bonusu (tarım veya sanayi). */
  readonly cityBonus: number;
  /** 0..1, AR-GE (F11'de gerçek değer alır). */
  readonly technologyBonus: number;
  /** Dünya olayı arz çarpanı. */
  readonly eventMultiplier?: number;
}

/**
 * Tesis üretim kapasitesi — madde 12.
 *
 *   kapasite = taban × seviye_çarpanı × (durum/100) × şehir_bonusu
 *              × (1 + teknoloji) × olay_çarpanı
 *
 * Çalışan skoru kapasiteye DEĞİL kaliteye girer (madde 14): personel çıktının
 * miktarını değil niteliğini belirler.
 */
export function productionCapacity(input: CapacityInput): number {
  const capacity =
    input.baseCapacity *
    input.levelMultiplier *
    (Math.max(0, Math.min(100, input.condition)) / 100) *
    input.cityBonus *
    (1 + input.technologyBonus) *
    (input.eventMultiplier ?? 1);
  return capacity > 0 ? capacity : 0;
}

/** Tesis kategorisine göre hangi şehir bonusu geçerli. */
export function cityBonusFor(
  category: FacilityCategory,
  city: { agricultureBonus: number; industrialBonus: number },
): number {
  switch (category) {
    case 'AGRICULTURE':
    case 'LIVESTOCK':
      return city.agricultureBonus;
    case 'MINING':
    case 'INDUSTRY':
      return city.industrialBonus;
    default:
      return 1;
  }
}

/**
 * Yükseltme maliyeti — madde 12: `taban × 0,75 × seviye^1,55`.
 * `targetLevel` yükseltilecek seviyedir (Lv2'ye çıkmak için 2).
 */
export function upgradeCost(
  baseCost: Money,
  targetLevel: number,
  multiplier: number,
  exponent: number,
): Money {
  return mulMoney(baseCost, multiplier * Math.pow(targetLevel, exponent)).value;
}
