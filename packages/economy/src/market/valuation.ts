import { mulMoney, priceTimesQty, type Money, type Qty } from '@kapital/shared';

export interface ValuationInput {
  readonly quantity: Qty;
  /** Piyasa referansı (EMA) — oyuncunun KENDİ satış fiyatı DEĞİL (madde 41). */
  readonly referencePrice: Money;
  /** Son 24 saatte bu üründe gerçekleşen toplam hacim. */
  readonly marketVolume24h: Qty;
  /** Hacmin bu oranını aşan stok iskontolu değerlenir (config, varsayılan 0,20). */
  readonly threshold: number;
  /** Aşan kısma uygulanan iskonto (config, varsayılan 0,50). */
  readonly discount: number;
}

export interface ValuationResult {
  readonly value: Money;
  readonly discountedQuantity: Qty;
  readonly discountApplied: boolean;
}

/**
 * Stok değerlemesi — madde 41 + likidite iskontosu (docs/11 C3).
 *
 * Stok, oyuncunun kendi satış fiyatıyla DEĞİL piyasa medyanıyla değerlenir;
 * aksi halde herkes rafına fahiş fiyat yazıp şirket değerini şişirirdi.
 *
 * Buna ek olarak: bir şirketin stoğu o ürünün 24 saatlik toplam hacminin
 * `threshold` oranını aşıyorsa, aşan kısım iskontolu değerlenir. Aksi halde
 * tüm piyasayı stoklayan oyuncu, satamayacağı malla sıralamayı ele geçirirdi.
 */
export function valuateStock(input: ValuationInput): ValuationResult {
  if (input.quantity <= 0n) {
    return { value: 0n as Money, discountedQuantity: 0n as Qty, discountApplied: false };
  }

  const liquidLimit = BigInt(
    Math.floor(Number(input.marketVolume24h) * Math.max(0, input.threshold)),
  );
  const quantity = input.quantity as bigint;

  if (liquidLimit <= 0n || quantity <= liquidLimit) {
    return {
      value: priceTimesQty(input.referencePrice, input.quantity).value,
      discountedQuantity: 0n as Qty,
      discountApplied: false,
    };
  }

  const liquid = priceTimesQty(input.referencePrice, liquidLimit as Qty).value;
  const excessQty = (quantity - liquidLimit) as Qty;
  const excessFull = priceTimesQty(input.referencePrice, excessQty).value;
  const excess = mulMoney(excessFull, 1 - Math.min(1, Math.max(0, input.discount))).value;

  return {
    value: (liquid + excess) as Money,
    discountedQuantity: excessQty,
    discountApplied: true,
  };
}
