/**
 * Şirket seviye ilerleyişi — madde 11.
 *
 * Seviye, ürün ve tesis kilitlerini açar. `company_levels` tablosu şartları
 * taşır; buradaki iş, bir turluk faaliyetin ne kadar deneyim ürettiğini ve
 * şartların sağlanıp sağlanmadığını hesaplamaktır.
 *
 * ★ Spec deneyim kazanımını yalnızca ONBOARDING görevleri için tanımlıyordu
 * (7 adım = 700 XP = tam olarak Lv2 şartı). Sürekli oyun için bir kural yoktu;
 * bu yüzden faaliyet temelli bir kural tanımlandı ve config'e alındı.
 * Onboarding'in 700 XP'si bu kuralla uyumludur: aktif bir oyuncu ilk gününde
 * benzer büyüklükte XP toplar.
 *
 * Saf fonksiyon: veritabanına dokunmaz.
 */
import type { Money, Qty } from '@kapital/shared';

export interface ExperienceRates {
  /** Perakende cirosunun kaç ₺'si 1 XP eder. */
  readonly retailPerXp: number;
  /** Toptan ticaret hacminin kaç ₺'si 1 XP eder. */
  readonly tradePerXp: number;
  /** Kaç birim üretim 1 XP eder. */
  readonly producedPerXp: number;
  /** Tesis kurma primi. */
  readonly facilityBonus: number;
}

export const DEFAULT_EXPERIENCE_RATES: ExperienceRates = {
  retailPerXp: 100, tradePerXp: 200, producedPerXp: 10, facilityBonus: 100,
};

export interface ActivityInput {
  readonly retailRevenue: Money;
  readonly tradeVolume: Money;
  readonly unitsProduced: Qty;
  readonly facilitiesBuilt: number;
}

/**
 * Bir turluk faaliyetin deneyim karşılığı.
 *
 * Para ölçeği 1e4, miktar ölçeği 1e3'tür (ADR-0001); oranlar ₺ ve birim
 * cinsinden verildiği için ölçek burada BİR KEZ düşürülür.
 */
export function experienceGain(
  activity: ActivityInput, rates: ExperienceRates = DEFAULT_EXPERIENCE_RATES,
): number {
  const retail = Number(activity.retailRevenue) / 10_000 / rates.retailPerXp;
  const trade = Number(activity.tradeVolume) / 10_000 / rates.tradePerXp;
  const produced = Number(activity.unitsProduced) / 1_000 / rates.producedPerXp;
  const facilities = activity.facilitiesBuilt * rates.facilityBonus;
  const total = retail + trade + produced + facilities;
  return total > 0 ? Math.floor(total) : 0;
}

export interface LevelRequirement {
  readonly level: number;
  readonly requiredXp: bigint;
  readonly requiredCompanyValue: bigint;
  readonly requiredTradeVolume: bigint;
  readonly requiredUnitsProduced: bigint;
  readonly requiredDistinctProducts: number;
}

export interface CompanyProgress {
  readonly level: number;
  readonly experience: bigint;
  readonly companyValue: bigint;
  readonly tradeVolume: bigint;
  readonly unitsProduced: bigint;
  readonly distinctProducts: number;
}

/**
 * Şirketin ulaşabileceği en yüksek seviye.
 *
 * ★ Şartların TAMAMI sağlanmalı: yalnız XP toplayarak seviye atlanmaz, şirket
 * gerçekten büyümüş olmalı. Bir seviyenin şartı sağlanmıyorsa üstündekilere
 * bakılmaz — atlamalı ilerleme yoktur.
 */
export function nextLevel(
  progress: CompanyProgress, requirements: readonly LevelRequirement[],
): number {
  const ordered = [...requirements].sort((a, b) => a.level - b.level);
  let reached = progress.level;
  for (const req of ordered) {
    if (req.level <= reached) continue;
    if (req.level > reached + 1) break; // sıra atlanmaz
    const ok =
      progress.experience >= req.requiredXp &&
      progress.companyValue >= req.requiredCompanyValue &&
      progress.tradeVolume >= req.requiredTradeVolume &&
      progress.unitsProduced >= req.requiredUnitsProduced &&
      progress.distinctProducts >= req.requiredDistinctProducts;
    if (!ok) break;
    reached = req.level;
  }
  return reached;
}
