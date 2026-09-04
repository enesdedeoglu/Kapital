/**
 * Dünya olayları kataloğu — madde 30/45.
 *
 * Ekonominin havasıdır. Onsuz Kapital doğru çalışan ama tepki verilecek hiçbir
 * şeyi olmayan bir arz-talep öğütmesidir: spekülatör arketipinin var olma
 * sebebi, stok tutmanın anlamı ve fiyat oynaklığı (hedef %5–15, olaysız
 * ölçülen %0,1) hep buradan doğar.
 *
 * ★ Olayların yarısından fazlası OLUMLU olmalı. Yalnız felaket üreten bir
 * dünya, oyuncuya "ne yaparsan yap başına bir şey gelir" der; oysa amaç
 * fırsat da yaratmaktır. Bereketli hasat da bir olaydır.
 *
 * Saf veri: veritabanına, zamana ve rastgeleliğe dokunmaz.
 */

export type EventScope = 'PRODUCT' | 'SECTOR' | 'CITY' | 'GLOBAL';

export interface WorldEventTemplate {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly scope: EventScope;
  /** SECTOR kapsamında hangi kategori — tesis kategorisi veya ürün kategorisi. */
  readonly category?: string;
  /** PRODUCT kapsamında hangi ürünler arasından seçilir (kod). Boşsa hepsi. */
  readonly productCodes?: readonly string[];
  readonly demandMultiplier: number;
  readonly supplyMultiplier: number;
  readonly costMultiplier: number;
  /** Süre aralığı (tur). Gerçek süre bu aralıkta rastgele seçilir. */
  readonly minTicks: number;
  readonly maxTicks: number;
  /** Seçilme ağırlığı — büyük olan daha sık çıkar. */
  readonly weight: number;
}

export const WORLD_EVENTS: readonly WorldEventTemplate[] = [
  /* ---- ARZ ŞOKLARI (olumsuz) --------------------------------------- */
  {
    code: 'DROUGHT', name: 'Kuraklık',
    description: 'Uzun süren kuraklık tarımsal üretimi vurdu.',
    scope: 'SECTOR', category: 'AGRICULTURE',
    demandMultiplier: 1, supplyMultiplier: 0.55, costMultiplier: 1.15,
    minTicks: 96, maxTicks: 288, weight: 10,
  },
  {
    code: 'MINE_ACCIDENT', name: 'Maden kazası',
    description: 'Bir ocakta göçük oldu; bölgedeki üretim durduruldu.',
    scope: 'SECTOR', category: 'MINING',
    demandMultiplier: 1, supplyMultiplier: 0.5, costMultiplier: 1.1,
    minTicks: 48, maxTicks: 144, weight: 8,
  },
  {
    code: 'ENERGY_CRISIS', name: 'Enerji krizi',
    description: 'Elektrik ve yakıt fiyatları fırladı; her üretim pahalılaştı.',
    scope: 'GLOBAL',
    demandMultiplier: 1, supplyMultiplier: 1, costMultiplier: 1.45,
    minTicks: 96, maxTicks: 192, weight: 9,
  },
  {
    code: 'MACHINE_FAILURE', name: 'Tedarik aksaması',
    description: 'Yedek parça bulunamıyor; fabrikalar düşük kapasiteyle çalışıyor.',
    scope: 'SECTOR', category: 'INDUSTRY',
    demandMultiplier: 1, supplyMultiplier: 0.75, costMultiplier: 1.05,
    minTicks: 48, maxTicks: 96, weight: 7,
  },

  /* ---- TALEP ŞOKLARI ------------------------------------------------ */
  {
    code: 'HEALTH_SCARE', name: 'Sağlık uyarısı',
    description: 'Sağlık Bakanlığı uyarısı sonrası talep sert düştü.',
    scope: 'PRODUCT', productCodes: ['CIGARETTE', 'TOBACCO'],
    demandMultiplier: 0.5, supplyMultiplier: 1, costMultiplier: 1,
    minTicks: 192, maxTicks: 384, weight: 6,
  },
  {
    code: 'COLD_SNAP', name: 'Soğuk dalgası',
    description: 'Sert soğuklar temel gıdaya talebi artırdı.',
    scope: 'CITY',
    demandMultiplier: 1.35, supplyMultiplier: 0.9, costMultiplier: 1,
    minTicks: 48, maxTicks: 96, weight: 8,
  },

  /* ---- OLUMLU OLAYLAR ----------------------------------------------- */
  {
    code: 'FESTIVAL', name: 'Bayram',
    description: 'Bayram alışverişi başladı; tüm şehirlerde talep canlandı.',
    scope: 'GLOBAL',
    demandMultiplier: 1.5, supplyMultiplier: 1, costMultiplier: 1,
    minTicks: 48, maxTicks: 96, weight: 12,
  },
  {
    code: 'HARVEST_BOUNTY', name: 'Bereketli hasat',
    description: 'Elverişli hava tarımsal üretimi artırdı.',
    scope: 'SECTOR', category: 'AGRICULTURE',
    demandMultiplier: 1, supplyMultiplier: 1.4, costMultiplier: 0.9,
    minTicks: 96, maxTicks: 192, weight: 11,
  },
  {
    code: 'TECH_UPGRADE', name: 'Verimlilik hamlesi',
    description: 'Yeni üretim yöntemleri yaygınlaştı; maliyetler düştü.',
    scope: 'SECTOR', category: 'INDUSTRY',
    demandMultiplier: 1, supplyMultiplier: 1.2, costMultiplier: 0.85,
    minTicks: 96, maxTicks: 192, weight: 9,
  },
  {
    code: 'CITY_BOOM', name: 'Şehre göç',
    description: 'Şehrin nüfusu hızla arttı; tüketim yükseldi.',
    scope: 'CITY',
    demandMultiplier: 1.4, supplyMultiplier: 1, costMultiplier: 1,
    minTicks: 192, maxTicks: 384, weight: 10,
  },
];

/** Katalog dengesi: felaket üreten bir dünya oyuncuyu yalnız cezalandırır. */
export function positiveEventWeight(): number {
  const total = WORLD_EVENTS.reduce((sum, e) => sum + e.weight, 0);
  const positive = WORLD_EVENTS
    .filter((e) => e.demandMultiplier > 1 || e.supplyMultiplier > 1 || e.costMultiplier < 1)
    .reduce((sum, e) => sum + e.weight, 0);
  return total > 0 ? positive / total : 0;
}
