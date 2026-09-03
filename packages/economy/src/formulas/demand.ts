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
