import { mulMoney, priceTimesQty, qtyFromNumber, ZERO_MONEY, ZERO_QTY } from '@kapital/shared';
import type { CityDemand, CityDemandParams, DemandModifiers, ProductDemandParams } from '../types.js';

/**
 * Şehir talebi — madde 19 + R10 azaltımı.
 *
 * İki çıktı üretir ve İKİSİ DE bağlayıcıdır:
 *   units  — tüketicilerin istediği miktar
 *   budget — harcayabilecekleri toplam ₺
 *
 * Bütçe olmadan sistem sınırsız para basar: rekabetin olmadığı bir şehirde
 * tek satıcı fiyatı 100 katına çıkarır, pazar payı %100 kalır ve musluk
 * sonsuzdur (docs/10 R10).
 */
export function cityDemand(
  product: ProductDemandParams,
  city: CityDemandParams,
  mods: DemandModifiers,
): CityDemand {
  const raw =
    product.baseDemand *
    city.populationIndex *
    city.incomeIndex *
    city.consumerDemandIndex *
    mods.economicCycle *
    mods.seasonMultiplier *
    mods.eventMultiplier *
    mods.noise;

  if (!(raw > 0)) return { units: ZERO_QTY, budget: ZERO_MONEY };

  const units = qtyFromNumber(raw);
  // Bütçe, referans fiyatla değerlenmiş talebin config'ten gelen bir katıdır.
  // mulMoney kullanılır: Number(bigint) para değerini float'a düşürür ve
  // büyük tutarlarda hassasiyet kaybettirir (ADR-0001).
  const atReference = priceTimesQty(product.referencePrice, units).value;
  const budget = mulMoney(atReference, mods.budgetSlack).value;

  return { units, budget };
}

/* ------------------------------------------------------------------ */

export interface DemandScaleConfig {
  /** Dünyanın taban talep çarpanı — kalibrasyon kolu. */
  readonly baseMultiplier: number;
  /** Ölçeklemenin referans aldığı şirket sayısı (tohum NPC dünyası). */
  readonly baselineCompanies: number;
  /**
   * Şirket sayısına duyarlılık. 1,0 = her yeni şirket kendi müşterisini
   * getirir (nokta başına ciro sabit kalır); 0,8 = rekabet baskısı kalır.
   */
  readonly elasticity: number;
  /** Üst sınır — dünya sınırsız büyümez. */
  readonly max: number;
}

export const DEFAULT_DEMAND_SCALE: DemandScaleConfig = {
  baseMultiplier: 1, baselineCompanies: 65, elasticity: 0.85, max: 20,
};

/**
 * DÜNYA TALEP ÖLÇEĞİ.
 *
 * ★ Spec'te tüketici talebi şehrin sabit özelliklerinden gelir
 * (`population_index × income_index × consumer_demand_index`) ve OYUNCU
 * SAYISINDAN BAĞIMSIZDIR. Bu, oyuncu tabanı büyüdükçe sabit bir pastanın
 * daha çok satış noktası arasında bölünmesi demektir.
 *
 * F8 simülasyonunda ölçüldü: 130 satış noktası, nokta başına 43 ₺/tur ciro,
 * bakım 2 ₺/tur, brüt marj %12 → her dükkân zararda. Oyuncular 30.000 ₺ ile
 * başlayıp 28.766 ₺'ye geriledi; madde 56'nın "1. hafta 100.000–250.000 ₺"
 * hedefi bu talep düzeyinde matematiksel olarak ulaşılamaz.
 *
 * Çözüm: dünya oyuncu tabanıyla büyür. Her yeni şirket kendi müşteri çevresini
 * de getirir (çalışanı, tedarikçisi, ailesi). Esneklik 1'in altında tutulur ki
 * rekabet baskısı tamamen kalkmasın: nokta başına ciro biraz seyrelir.
 *
 * Saf fonksiyon.
 */
export function worldDemandScale(
  activeCompanies: number, config: DemandScaleConfig = DEFAULT_DEMAND_SCALE,
): number {
  const baseline = Math.max(1, config.baselineCompanies);
  const ratio = Math.max(1, activeCompanies) / baseline;
  const scaled = Math.pow(ratio, config.elasticity);
  const bounded = Math.max(1, Math.min(config.max, scaled));
  return config.baseMultiplier * bounded;
}
