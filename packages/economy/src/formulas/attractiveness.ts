import { mulMoney, type Money } from '@kapital/shared';
import type { CategoryWeights, ProductDemandParams, RetailOffer, ScoredOffer } from '../types.js';

/**
 * Mağaza çekiciliği — madde 20.
 *
 *   price_score   = (referans / satış) ^ fiyat_hassasiyeti
 *   quality_score = 0,50 + kalite/100
 *   brand_score   = 0,75 + itibar/400
 *   store_score   = 1 + tesis_seviyesi × 0,03
 *   attractiveness = price^pw × quality^qw × brand^bw × store
 *
 * ★ Rezervasyon fiyatı (R10): satış fiyatı referansın `reservationPriceMult`
 * katını aşarsa çekicilik SIFIRLANIR. Tüketici o fiyata almaz — rekabet
 * olmasa bile. Bu, fiyatın üst sınırıdır ve para basmayı engeller.
 */
export function scoreOffer(
  offer: RetailOffer,
  product: ProductDemandParams,
  weights: CategoryWeights,
): ScoredOffer {
  const reservationCeiling = mulMoney(product.referencePrice, product.reservationPriceMult).value;
  const aboveReservationPrice = offer.sellingPrice > reservationCeiling;

  const priceRatio = Number(product.referencePrice) / Number(offer.sellingPrice);
  const priceScore = Math.pow(priceRatio, product.priceSensitivity);
  const qualityScore = 0.5 + offer.avgQuality / 100;
  const brandScore = 0.75 + offer.reputation / 400;
  const storeScore = 1 + offer.facilityLevel * 0.03;

  const attractiveness = aboveReservationPrice
    ? 0
    : Math.pow(priceScore, weights.priceWeight) *
      Math.pow(qualityScore, weights.qualityWeight) *
      Math.pow(brandScore, weights.brandWeight) *
      storeScore;

  return {
    ...offer,
    attractiveness: Number.isFinite(attractiveness) ? attractiveness : 0,
    priceScore, qualityScore, brandScore, storeScore, aboveReservationPrice,
  };
}

/** Rezervasyon tavanı — UI'da "bu fiyattan kimse almaz" uyarısı için. */
export function reservationCeiling(product: ProductDemandParams): Money {
  return mulMoney(product.referencePrice, product.reservationPriceMult).value;
}
