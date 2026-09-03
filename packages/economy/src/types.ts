import type { Money, Qty } from '@kapital/shared';

/**
 * Tick bağlamı — çağıran tarafından toplanıp geçirilir.
 * Bu pakette `Date.now()` ve `Math.random()` YASAKTIR (ADR-0003).
 */
export interface TickContext {
  /** Tek zaman kaynağı. `NOW()` kullanılmaz. */
  readonly seq: bigint;
  /** Deterministik RNG — `mulberry32(deriveSeed(...))` ile üretilir. */
  readonly rng: () => number;
  readonly season: 0 | 1 | 2 | 3;
}

/** Ürünün talep parametreleri (products tablosundan). */
export interface ProductDemandParams {
  readonly productId: number;
  /** Tur başına birim, nüfus indeksi 1,0 için. */
  readonly baseDemand: number;
  /**
   * Bir ÖNCEKİ turun EMA referans fiyatı. Aynı turda hesaplanan medyan
   * kullanılmaz — döngü kapanır ve sistem osilatöre döner (R2).
   */
  readonly referencePrice: Money;
  /** Bu katın üstünde tüketici almaz; rekabet olmasa bile (R10). */
  readonly reservationPriceMult: number;
  readonly priceSensitivity: number;
}

/** Şehrin talep parametreleri (cities tablosundan). */
export interface CityDemandParams {
  readonly cityId: number;
  readonly populationIndex: number;
  readonly incomeIndex: number;
  readonly consumerDemandIndex: number;
}

/** Tur bazlı çarpanlar — çevrim, mevsim, dünya olayı, gürültü. */
export interface DemandModifiers {
  readonly economicCycle: number;
  readonly seasonMultiplier: number;
  readonly eventMultiplier: number;
  /** rng'den gelir, ~0,97–1,03 (madde 19). */
  readonly noise: number;
  /**
   * ★ R10 azaltımı. Şehrin toplam harcama tavanı:
   *   budget = units × referencePrice × budgetSlack
   * Bu olmadan tek satıcı fiyatı istediği kadar yükseltip para basar.
   */
  readonly budgetSlack: number;
}

export interface CityDemand {
  readonly units: Qty;
  /** Harcanabilecek toplam ₺ tavanı. */
  readonly budget: Money;
}

/** Kategori bazlı ağırlıklar (product_categories tablosundan, madde 20). */
export interface CategoryWeights {
  readonly priceWeight: number;
  readonly qualityWeight: number;
  readonly brandWeight: number;
}

/** Bir mağazanın tek ürün için rafı. */
export interface RetailOffer {
  readonly facilityId: string;
  readonly companyId: string;
  readonly sellingPrice: Money;
  readonly availableStock: Qty;
  /** 0–100, lotların miktar ağırlıklı ortalaması. */
  readonly avgQuality: number;
  /** 0–100, şirket itibarı. */
  readonly reputation: number;
  readonly facilityLevel: number;
}

export interface ScoredOffer extends RetailOffer {
  readonly attractiveness: number;
  readonly priceScore: number;
  readonly qualityScore: number;
  readonly brandScore: number;
  readonly storeScore: number;
  /** Rezervasyon fiyatı aşıldıysa true — çekicilik sıfırlanır. */
  readonly aboveReservationPrice: boolean;
}

export interface RetailAllocation {
  readonly facilityId: string;
  readonly companyId: string;
  readonly units: Qty;
  readonly revenue: Money;
  readonly unitPrice: Money;
  readonly marketShare: number;
}

export interface RetailOutcome {
  readonly allocations: readonly RetailAllocation[];
  readonly soldUnits: Qty;
  readonly revenue: Money;
  /** Karşılanamayan talep — hata değil, "şehirde mal yok" sinyali. */
  readonly unmetUnits: Qty;
  /** Bütçe tavanına takılan talep — R10 izlemesi. */
  readonly budgetLimitedUnits: Qty;
  readonly roundsUsed: number;
}
