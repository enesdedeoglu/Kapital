/** API'nin döndürdüğü biçimler. Para alanları STRING gelir (ADR-0001: bigint). */

export interface Sehir {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

export interface Sirket {
  readonly id: string;
  readonly name: string;
  /** Kuruş cinsinden bigint, string olarak taşınır. */
  readonly cash: string;
  readonly cashFormatted: string;
  readonly usdBalance: string;
  readonly companyValue: string;
  readonly level: number;
  readonly levelTitle: string;
  readonly experience: string;
  readonly reputation: string;
  readonly city: Sehir;
  readonly status: string;
  readonly createdAt: string;
}

export interface OturumYaniti {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn?: number;
}

/** Ana sayfa özeti — `GET /dashboard`. Beş şey tek yanıtta (bkz. dashboard.service). */
export interface Ozet {
  readonly tur: {
    readonly seq: string;
    /** Sıradaki turun ISO zamanı; bekleyen tur yoksa null. */
    readonly sonraki: string | null;
    readonly dakika: number;
  };
  readonly kar: {
    readonly net: string;
    readonly ciro: string;
    readonly gider: string;
    /** Dönem başı nakde oran; karşılaştırılacak bakiye yoksa null. */
    readonly oran: number | null;
  };
  readonly kritikStok: readonly {
    readonly facilityId: string;
    readonly facilityName: string;
    readonly productCode: string;
    readonly productName: string;
    readonly kalan: number;
    readonly turBasiSatis: number;
    readonly kalanTur: number;
  }[];
  readonly olaylar: readonly {
    readonly kod: string;
    readonly ad: string;
    readonly aciklama: string;
    readonly kapsam: string;
    readonly urunKodu: string | null;
    readonly kalanTur: number;
    readonly talep: number;
    readonly arz: number;
    readonly maliyet: number;
  }[];
}

/** Ürün kataloğu — `GET /products`. */
export interface Urun {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly isRetailProduct?: boolean;
  readonly unlockLevel?: number;
}

/** Emir defteri — `GET /market/book/:kod`. Madde 16: üç rakam AYRI. */
export interface Defter {
  readonly product: { readonly code: string; readonly name: string; readonly unit: string };
  readonly deliveryCityId: number;
  readonly sell: readonly {
    readonly orderId: string;
    readonly seller: { readonly name: string; readonly kind: string };
    readonly city: { readonly code: string; readonly name: string };
    readonly available: string;
    readonly availableFormatted: string;
    readonly quality: number;
    readonly goodsPrice: string;
    readonly goodsPriceFormatted: string;
    readonly shippingPerUnit: string;
    readonly shippingPerUnitFormatted: string;
    readonly totalPerUnit: string;
    readonly totalPerUnitFormatted: string;
    readonly distanceIndex: number;
    readonly transitTicks: number;
  }[];
  readonly buy: readonly {
    readonly orderId: string;
    readonly buyer: string;
    readonly cityCode: string;
    readonly wanted: string;
    readonly maxTotalPerUnit: string;
    readonly maxTotalPerUnitFormatted: string;
    readonly minQuality: number;
  }[];
}

/** Tesis — `GET /facilities`. */
export interface Tesis {
  readonly id: string;
  readonly name: string;
  readonly type: { readonly code: string; readonly name: string; readonly category: string };
  readonly city: { readonly id: number; readonly code: string; readonly name: string };
  readonly level: number;
  readonly condition: string;
  readonly storageCapacity: string;
  readonly usedCapacity: string;
  readonly storageUsedPct: number;
  readonly productionEnabled: boolean;
  readonly isUnderConstruction: boolean;
  readonly ticksRemaining: number;
}

/** Tesis stoğu — `GET /facilities/:id/stock`. */
export interface TesisStok {
  readonly facilityId: string;
  readonly capacity: string;
  readonly usedCapacity: string;
  readonly freeCapacity: string;
  readonly products: readonly {
    readonly productId: number;
    readonly code: string;
    readonly name: string;
    readonly unit: string;
    readonly total: string;
    readonly totalFormatted: string;
    readonly available: string;
    readonly reserved: string;
    readonly avgQuality: number;
    readonly weightedAvgCost: string;
    readonly weightedAvgCostFormatted: string;
    readonly batchCount: number;
  }[];
}

/** Lot — `GET /facilities/:id/batches?productId=`. */
export interface Lot {
  readonly id: string;
  readonly product: { readonly id: number; readonly code: string; readonly name: string; readonly unit: string };
  readonly quantity: string;
  readonly quantityFormatted: string;
  readonly reserved: string;
  readonly quality: number;
  readonly unitCost: string;
  readonly unitCostFormatted: string;
  readonly expiresAtTick: string | null;
  readonly producedInTick: string | null;
}

/** Oyuncunun açık emri — `GET /market/orders`. */
export interface AcikEmir {
  readonly id: string;
  readonly side: 'BUY' | 'SELL';
  readonly status: string;
  readonly product: { readonly code: string; readonly name: string; readonly unit: string };
  readonly city: { readonly code: string; readonly name: string };
  readonly quantity: string;
  readonly remaining: string;
  readonly remainingFormatted: string;
  readonly pricePerUnit: string;
  readonly pricePerUnitFormatted: string;
  readonly expiresAtTick: string | null;
}

/** Raf teklifi — `GET /retail/:facilityId`, `PUT /retail/:facilityId/prices`. */
export interface RafTeklifi {
  readonly productCode: string;
  readonly productName: string;
  readonly unit: string;
  readonly sellingPrice: string;
  readonly sellingPriceFormatted: string;
  readonly enabled: boolean;
  /** Piyasa referans fiyatı — neye göre fiyatladığını görsün. */
  readonly referencePrice: string;
  readonly referencePriceFormatted: string;
  /** Müşterinin ödemeyi kabul ettiği TAVAN; üstünde kimse almaz. */
  readonly reservationCeiling: string;
  readonly reservationCeilingFormatted: string;
  readonly aboveCeiling: boolean;
  readonly availableStock: string;
}

/**
 * Şehir künyesi — `/cities`.
 *
 * Endekslerin her birinin motorda somut bir karşılığı var; ekran ham sayıyı
 * değil bu karşılığı anlatmalı:
 *   populationIndex × incomeIndex × consumerDemandIndex → tüketici talebi
 *     (`economy/formulas/demand.ts`) — mağaza cirosunu bu belirler.
 *   agricultureBonus / industrialBonus → üretim kapasitesi çarpanı
 *     (`economy/production/capacity.ts`, tesis kategorisine göre seçilir).
 *   landCostIndex → tesis kurma maliyeti (`facility.service.ts`).
 *   logisticsModifier → hedef şehrin nakliye çarpanı (`economy/market/shipping.ts`).
 *   hasPort → dış ticaret yapılabilir mi.
 */
export interface SehirBilgi {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly populationIndex: number;
  readonly incomeIndex: number;
  readonly landCostIndex: number;
  readonly industrialBonus: number;
  readonly agricultureBonus: number;
  readonly consumerDemandIndex: number;
  readonly logisticsModifier: number;
  readonly hasPort: boolean;
}

/** `/cities/:code/distances` — kaynak şehrin kendisi de 0 mesafeyle gelir. */
export interface Mesafe {
  readonly cityCode: string;
  readonly cityName: string;
  readonly distanceIndex: number;
  readonly transitTicks: number;
}
