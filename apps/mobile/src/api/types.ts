/** API'nin döndürdüğü biçimler. Para alanları STRING gelir (ADR-0001: bigint). */

export interface Sehir {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

/**
 * Seviye şartı — `company_levels` satırının oyuncuya gösterilen hâli.
 *
 * Seviye atlamak yalnız XP'ye bakmıyor; şirket değeri, ticaret hacmi,
 * üretilen miktar ve farklı ürün sayısı da şart. Biçimli metinler SUNUCUDAN
 * gelir: para bigint aritmetiğiyle (ADR-0001), sayılar da binlik ayıraçla —
 * Hermes'te tam ICU yok, istemci ayıramıyor.
 */
export interface SeviyeSarti {
  readonly key: 'experience' | 'companyValue' | 'tradeVolume' | 'unitsProduced' | 'distinctProducts';
  readonly label: string;
  readonly current: string;
  readonly required: string;
  readonly currentFormatted: string;
  readonly requiredFormatted: string;
  readonly met: boolean;
  /** 0–1 çubuk oranı. */
  readonly ratio: number;
}

export interface Ilerleme {
  readonly atMaxLevel: boolean;
  readonly nextLevel: number | null;
  readonly nextTitle: string | null;
  /** EN YAVAŞ şartın oranı; ortalama değil — bağlayan şart neyse o. */
  readonly ratio: number;
  readonly requirements: readonly SeviyeSarti[];
}

/** `GET /auth/me` — oturumdaki hesabın künyesi. */
export interface Hesap {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
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
  readonly progress: Ilerleme;
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
    /** Alıcının NAKLİYE DAHİL tavanı — satıcının eline geçecek tutar DEĞİL. */
    readonly maxTotalPerUnit: string;
    readonly maxTotalPerUnitFormatted: string;
    /** Benim şehrimden alıcının şehrine birim nakliye. */
    readonly shippingPerUnit: string;
    readonly shippingPerUnitFormatted: string;
    /** Tavan − nakliye: mala kalan, yani verebileceğim en yüksek fiyat. */
    readonly goodsCeilingPerUnit: string;
    readonly goodsCeilingPerUnitFormatted: string;
    /** false ise nakliye tavanı yiyor; bu alıcıya buradan satılamaz. */
    readonly reachable: boolean;
    readonly distanceIndex: number;
    readonly transitTicks: number;
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
  /**
   * Üretim hâli — rozet BUNA bakar, `productionEnabled`e değil.
   *
   * `productionEnabled` sütununun varsayılanı TRUE ve tarifi olmayan tesiste
   * de TRUE kalıyor: ona bakan rozet, hiçbir şey üretmeyen tesise yeşil
   * "çalışıyor" diyordu (R96).
   */
  readonly productionState: 'NONE' | 'NO_RECIPE' | 'PAUSED' | 'RUNNING';
  readonly producedProduct:
    | { readonly code: string; readonly name: string; readonly unit: string }
    | null;
  readonly isUnderConstruction: boolean;
  readonly ticksRemaining: number;
  /**
   * Yükseltme önizlemesi. Maliyet config'teki formülle, yeni kapasite
   * `facility_level_curve` ile bulunur — ikisi de sunucuda, istemcide
   * hesaplanmaz.
   */
  readonly upgrade: {
    readonly nextLevel: number | null;
    readonly atMaxLevel: boolean;
    readonly maxLevel: number;
    readonly cost: string | null;
    readonly costFormatted: string | null;
    readonly nextStorageCapacity: string | null;
    readonly levelMultiplier: number;
    readonly nextLevelMultiplier: number | null;
    /** Perakendede false — yükseltme orada yalnız depoyu büyütür. */
    readonly producesGoods: boolean;
  };
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
/** Rafa konabilecek ürün — `GET /retail/:id` yanıtının `addable` yarısı. */
export interface EklenebilirUrun {
  readonly productCode: string;
  readonly productName: string;
  readonly unit: string;
  /** Bu dükkânın deposunda bekleyen miktar; 0 olabilir. */
  readonly availableStock: string;
  readonly availableStockFormatted: string;
  readonly referencePrice: string;
  readonly referencePriceFormatted: string;
  readonly reservationCeiling: string;
  readonly reservationCeilingFormatted: string;
  /** Önerilen açılış fiyatı (referans × perakende marjı) — sunucuda hesaplanır. */
  readonly suggestedPrice: string;
  readonly suggestedPriceFormatted: string;
}

/** `GET /retail/:id` ve `PUT /retail/:id/prices` — rafta olan ve olabilecek. */
export interface Raf {
  readonly offers: readonly RafTeklifi[];
  readonly addable: readonly EklenebilirUrun[];
}

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

/** Kurulabilir tesis türü — `/facility-types`. */
export interface TesisTuru {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly baseCost: string;
  readonly baseCostFormatted: string;
  readonly baseCapacity: number;
  /** TUR BAŞINA bakım gideri — P5 her turda düşer. */
  readonly maintenanceCost: string;
  readonly maintenanceCostFormatted: string;
  readonly storageCapacity: string;
  readonly constructionTicks: number;
  readonly unlockLevel: number;
  readonly requiresPort: boolean;
  /**
   * Şehir koduna göre GERÇEK kurulum maliyeti (taban × arsa endeksi) ve o
   * şehirde kurulabilir mi (liman şartı). Sunucuda hesaplanır: para çarpımı
   * `mulMoney` ile yapılır, istemcide tekrarlanmaz (ADR-0001).
   */
  readonly cityCosts: Record<string, {
    readonly cost: string;
    readonly costFormatted: string;
    readonly buildable: boolean;
  }>;
}

/** "Sen yokken ne oldu" raporu — `GET /report?sinceTick=N` (madde 45). */
export interface Rapor {
  readonly pencere: {
    readonly baslangicTur: string;
    readonly bitisTur: string;
    readonly turSayisi: number;
    readonly dakika: number;
    /** Pencere 7 günle sınırlandıysa true — rapor "her şeyi" anlatmıyor demektir. */
    readonly kirpildi: boolean;
  };
  /** false = kaçırılan tur yok; rapor gösterilmez. */
  readonly yeniMi: boolean;
  readonly kar: {
    readonly net: string; readonly netFormatted: string;
    readonly ciro: string; readonly ciroFormatted: string;
    readonly gider: string; readonly giderFormatted: string;
  };
  readonly satislar: readonly {
    readonly urunKodu: string; readonly urunAdi: string;
    readonly adet: string; readonly adetFormatted: string;
    readonly ciro: string; readonly ciroFormatted: string;
  }[];
  readonly uretim: readonly {
    readonly urunAdi: string;
    readonly uretilen: string; readonly uretilenFormatted: string;
  }[];
  readonly sorunlar: readonly {
    readonly tesisAdi: string;
    readonly mesaj: string;
    /** Süre CÜMLESİ — anlamı sorunun türüne göre değişir, sunucu kurar. */
    readonly sure: string;
    readonly turSayisi: number;
    readonly ilkTur: string; readonly sonTur: string;
  }[];
  readonly dunya: readonly {
    readonly tur: string; readonly kod: string; readonly onem: string;
    readonly baslik: string; readonly metin: string;
    readonly urunAdi: string | null; readonly sehirAdi: string | null;
  }[];
}

/** Kalıcı emir — "ben yokken şirketim şunu yapsın" (`GET /standing-orders`). */
export interface OtomatikKural {
  readonly id: string;
  readonly facilityId: string;
  readonly product: { readonly code: string; readonly name: string };
  /** RESTOCK: hedefin altına düşünce al · SELL_SURPLUS: hedefin üstünü sat. */
  readonly kind: 'RESTOCK' | 'SELL_SURPLUS';
  readonly targetQuantity: string;
  readonly maxPricePerUnit: string | null;
  readonly minPricePerUnit: string | null;
  readonly enabled: boolean;
  readonly lastRunTick: string | null;
  /** Kuralın ne yapacağını anlatan düz cümle — sunucu kurar, ekran gösterir. */
  readonly explanation: string;
}

/** `GET /facilities/:id/production` — tesis ne üretiyor, nasıl gidiyor. */
export interface Uretim {
  readonly facilityId: string;
  readonly productionEnabled: boolean;
  readonly haltedReason: string | null;
  readonly condition: number;
  readonly level: number;
  /** Tur başına üretebileceği miktar (ondalıklı metin). */
  readonly capacityPerTick: string;
  readonly recipe: {
    readonly outputProduct: { readonly code: string; readonly name: string; readonly unit: string };
    readonly outputQuantity: string;
    readonly cycleTicks: number;
    readonly inputs: readonly {
      readonly code: string;
      readonly name: string;
      readonly unit: string;
      readonly quantity: string;
      readonly quantityFormatted: string;
      readonly minQuality: number;
    }[];
  } | null;
  readonly recentTicks: readonly {
    readonly tickSeq: string;
    readonly capacity: string;
    readonly produced: string;
    readonly outputQuality: number;
    readonly haltedReason: string | null;
  }[];
}

/**
 * Yoldaki mal — `GET /market/shipments`.
 *
 * Alış emri dolduktan sonra mal transit süresince buradadır: emir listeden
 * düşmüş, depoya da girmemiştir. Bu aradaki boşluk ekranda görünmeyince
 * oyuncunun gördüğü tek şey "para gitti, mal yok" oluyordu (R97).
 */
export interface Sevkiyat {
  readonly id: string;
  readonly product: { readonly code: string; readonly name: string; readonly unit: string };
  readonly seller: string;
  /** Hangi tesise geliyor — tesise göre gruplamak için kimlik. */
  readonly toFacilityId: string;
  /** "Manav · İstanbul" — okunur hâli. */
  readonly destination: string;
  readonly quantity: string;
  readonly quantityFormatted: string;
  readonly delivered: string;
  readonly quality: number;
  readonly unitCost: string;
  readonly unitCostFormatted: string;
  readonly shippingCost: string;
  readonly shippingCostFormatted: string;
  readonly arrivalTick: string;
  readonly ticksRemaining: number;
  /** Varış SAATİ; geri sayımı istemci sayar. Tur hiç işlememişse null. */
  readonly arrivesAt: string | null;
  readonly status: string;
}
