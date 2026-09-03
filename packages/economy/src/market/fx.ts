import { mulMoney, type Money } from '@kapital/shared';

export interface FxModelInput {
  /** Bir önceki turun kuru. */
  readonly previousRate: Money;
  /** Lansman çıpası (`economy.fx.rate0`). */
  readonly baseRate: Money;
  /** Oyun içi enflasyon endeksi (1,0 = lansman seviyesi). */
  readonly gameCpi: number;
  /** (ihracat₺ − ithalat₺) / (ihracat₺ + ithalat₺), son 96 tur. [−1, +1] */
  readonly tradeBalance: number;
  /** PPP'ye çekim hızı (varsayılan 0,05). */
  readonly alpha: number;
  /** Ticaret dengesi baskısı (varsayılan 0,02). */
  readonly tradeBalanceK: number;
  readonly clampPerTick: number;
}

/**
 * Kur modeli — docs/12 §4 (S2 kararı).
 *
 *   hedef = kur₀ × game_cpi                    // satın alma gücü paritesi
 *   kur_t = kur_{t−1} × (1 + α·(hedef/kur_{t−1} − 1) − k·ticaret_dengesi)
 *
 * Okunuşu: **oyun içi enflasyon %20 olursa ₺ zamanla %20 değer kaybeder.**
 * İhracat fazlası veren ekonomi ₺'sini değerlendirir.
 *
 * Kur hiçbir oyuncu tarafından belirlenmediği için manipüle edilemez.
 */
export function nextFxRate(input: FxModelInput): { rate: Money; clamped: boolean } {
  const previous = Number(input.previousRate);
  if (previous <= 0) return { rate: input.baseRate, clamped: false };

  const target = Number(mulMoney(input.baseRate, Math.max(0.01, input.gameCpi)).value);
  const pull = input.alpha * (target / previous - 1);
  const pressure = -input.tradeBalanceK * clamp(input.tradeBalance, -1, 1);

  const factor = 1 + pull + pressure;
  const bounded = clamp(factor, 1 - input.clampPerTick, 1 + input.clampPerTick);

  return {
    rate: mulMoney(input.previousRate, bounded).value,
    clamped: bounded !== factor,
  };
}

/** Dünya fiyatı USD'de çıpalıdır; oyuncu belirleyemez (docs/12 §3.1). */
export function worldPriceUsd(basePriceUsd: Money, worldPriceIndex: number): Money {
  return mulMoney(basePriceUsd, worldPriceIndex).value;
}

/**
 * Sürtünme bandı — docs/12 §3.2. Taban dünya fiyatının %25 altında, tavan
 * %35 üstünde: toplam ~%60 hareket alanı. Band dar olsaydı bütün yurt içi
 * fiyatlar dünya fiyatına çivilenir ve fiyat keşfi ölürdü (R18).
 */
export function foreignPrices(
  worldUsd: Money,
  exportMultiplier: number,
  importMultiplier: number,
): { exportUsd: Money; importUsd: Money } {
  return {
    exportUsd: mulMoney(worldUsd, exportMultiplier).value,
    importUsd: mulMoney(worldUsd, importMultiplier).value,
  };
}

/** Kur dönüşümü: spread `SYS_SINK`'e gider, round-trip bedava olmaz (S4). */
export function fxConversion(
  usdAmount: Money,
  rate: Money,
  spreadPct: number,
  side: 'BUY_USD' | 'SELL_USD',
): { tryAmount: Money; spread: Money } {
  // USD ölçeği (1e4) düşürülür: rate ₺/USD cinsindendir
  const gross = ((usdAmount as bigint) * (rate as bigint)) / 10_000n;
  const spread = mulMoney(gross as Money, spreadPct).value;
  return {
    // Alırken spread eklenir, satarken düşülür — her iki yönde de maliyet
    tryAmount: (side === 'BUY_USD' ? gross + (spread as bigint) : gross - (spread as bigint)) as Money,
    spread,
  };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
