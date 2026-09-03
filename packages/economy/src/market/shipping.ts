import { mulMoney, type Money, type Qty } from '@kapital/shared';

export interface ShippingInput {
  readonly quantity: Qty;
  /** `products.weight_per_unit` — birim başına ağırlık. */
  readonly weightPerUnit: number;
  /** `city_distances.distance_index` — 0 ise aynı şehir, nakliye yok. */
  readonly distanceIndex: number;
  /** Config: `economy.shipping.baseRatePerKgDistance`. */
  readonly baseRate: Money;
  /** `companies.logistics_modifier` — AR-GE ile düşer (F11). */
  readonly logisticsModifier: number;
  /** Hedef şehrin `logistics_modifier`'ı. */
  readonly cityModifier?: number;
}

/**
 * Nakliye maliyeti — madde 17.
 *
 *   miktar × ağırlık × mesafe × taban_oran × şirket_katsayısı × şehir_katsayısı
 *
 * Aynı şehirde mesafe 0'dır, dolayısıyla maliyet de 0. Şehirler arası ticaret
 * bu yüzden bir TERCİH olur: uzak satıcı ucuz ama nakliyesi pahalı ve yavaş.
 */
export function shippingCost(input: ShippingInput): Money {
  if (input.distanceIndex <= 0 || input.quantity <= 0n) return 0n as Money;
  const factor =
    input.weightPerUnit *
    input.distanceIndex *
    input.logisticsModifier *
    (input.cityModifier ?? 1);
  // miktar ölçeği (1e3) düşürülür: taban oran birim başınadır
  const perUnitTotal = mulMoney(input.baseRate, factor).value;
  return ((perUnitTotal * (input.quantity as bigint)) / 1000n) as Money;
}

/** Birim başına nakliye — UI'da "ürün fiyatı / nakliye / toplam" ayrımı için (madde 16). */
export function shippingPerUnit(
  input: Omit<ShippingInput, 'quantity'>,
): Money {
  if (input.distanceIndex <= 0) return 0n as Money;
  return mulMoney(
    input.baseRate,
    input.weightPerUnit * input.distanceIndex * input.logisticsModifier * (input.cityModifier ?? 1),
  ).value;
}
