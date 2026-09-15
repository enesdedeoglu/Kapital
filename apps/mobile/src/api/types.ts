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
