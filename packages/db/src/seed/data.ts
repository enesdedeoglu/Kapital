/**
 * Başlangıç dünyası — MVP-1 (docs/08).
 * Bu değerler DENGE TOHUMUDUR, kesin değer değildir; F8 simülasyonunda ayarlanır.
 * Hiçbiri koda gömülü değildir: hepsi tablodan okunur, admin panelden değiştirilebilir.
 */
import { money, qty } from '@kapital/shared';

/** Kur çıpası: 1 USD = 35 ₺. Dünya fiyatları bu ana göre sabitlenir (docs/12 §3.1). */
export const FX_RATE_0 = 35;

export const cities = [
  // id, kod, ad, nüfus, gelir, arsa, sanayi, tarım, talep, lojistik, liman
  { id: 1, code: 'IST', name: 'İstanbul', populationIndex: 1.60, incomeIndex: 1.20, landCostIndex: 1.50, industrialBonus: 1.05, agricultureBonus: 0.85, consumerDemandIndex: 1.0, logisticsModifier: 1.0, hasPort: true },
  { id: 2, code: 'ANK', name: 'Ankara',   populationIndex: 1.00, incomeIndex: 1.05, landCostIndex: 1.00, industrialBonus: 1.00, agricultureBonus: 1.00, consumerDemandIndex: 1.0, logisticsModifier: 1.0, hasPort: false },
  { id: 3, code: 'IZM', name: 'İzmir',    populationIndex: 0.90, incomeIndex: 1.10, landCostIndex: 1.15, industrialBonus: 0.95, agricultureBonus: 1.05, consumerDemandIndex: 1.0, logisticsModifier: 1.0, hasPort: true },
  { id: 4, code: 'KON', name: 'Konya',    populationIndex: 0.65, incomeIndex: 0.90, landCostIndex: 0.70, industrialBonus: 0.95, agricultureBonus: 1.20, consumerDemandIndex: 1.0, logisticsModifier: 1.05, hasPort: false },
  { id: 5, code: 'BRS', name: 'Bursa',    populationIndex: 0.75, incomeIndex: 1.00, landCostIndex: 0.90, industrialBonus: 1.15, agricultureBonus: 0.95, consumerDemandIndex: 1.0, logisticsModifier: 1.0, hasPort: true },
] as const;

/** distance_index ≈ 100 km başına 1,0 · transit_ticks = mesafeyle artan gecikme (A3). */
export const cityDistances: [number, number, number, number][] = [
  // [kaynak, hedef, mesafe, transit tur]
  [1, 2, 4.5, 2], [1, 3, 4.8, 2], [1, 4, 6.6, 3], [1, 5, 1.5, 1],
  [2, 3, 5.9, 3], [2, 4, 2.6, 2], [2, 5, 3.9, 2],
  [3, 4, 5.5, 3], [3, 5, 3.3, 2],
  [4, 5, 4.7, 2],
];

export const productCategories = [
  { id: 1, code: 'STAPLE_FOOD',  name: 'Temel Gıda',   priceWeight: 1.60, qualityWeight: 0.80, brandWeight: 0.35 },
  { id: 2, code: 'PRODUCE',      name: 'Taze Ürün',    priceWeight: 1.40, qualityWeight: 1.10, brandWeight: 0.30 },
  { id: 3, code: 'TOBACCO',      name: 'Tütün Ürünü',  priceWeight: 1.00, qualityWeight: 0.90, brandWeight: 1.20 },
  { id: 4, code: 'RAW_MATERIAL', name: 'Hammadde',     priceWeight: 1.50, qualityWeight: 1.00, brandWeight: 0.20 },
  { id: 5, code: 'INDUSTRIAL',   name: 'Ara Ürün',     priceWeight: 1.35, qualityWeight: 1.05, brandWeight: 0.25 },
  { id: 6, code: 'DURABLE',      name: 'Dayanıklı Mal', priceWeight: 0.95, qualityWeight: 1.30, brandWeight: 1.15 },
];

/**
 * base_demand = tur başına birim, nüfus indeksi 1,0 için.
 * Hedef pacing (docs/08 §hedefler): 30.000 ₺ ile başlayan oyuncu ilk hafta
 * 100–250k ₺'ye ulaşsın → başlangıçta ~50–100 ₺/tur net kâr.
 */
export const products = [
  { id: 1,  code: 'WHEAT',     name: 'Buğday',  categoryId: 4, unit: 'kg',    price: 10,   demand: 0,    priceSens: 1.4, qualSens: 0.9, brandSens: 0.2, shelfLife: 2880, decay: 0.0004, weight: 1.0,  unlock: 5,  raw: true,  inter: false, retail: false },
  { id: 2,  code: 'FLOUR',     name: 'Un',      categoryId: 5, unit: 'kg',    price: 16,   demand: 0,    priceSens: 1.3, qualSens: 1.0, brandSens: 0.3, shelfLife: 5760, decay: 0.0002, weight: 1.0,  unlock: 6,  raw: false, inter: true,  retail: false },
  { id: 3,  code: 'BREAD',     name: 'Ekmek',   categoryId: 1, unit: 'adet',  price: 15,   demand: 40,   priceSens: 1.7, qualSens: 0.8, brandSens: 0.35, shelfLife: 96,  decay: 0.0150, weight: 0.5,  unlock: 6,  raw: false, inter: false, retail: true },
  { id: 4,  code: 'TOMATO',    name: 'Domates', categoryId: 2, unit: 'kg',    price: 15,   demand: 25,   priceSens: 1.5, qualSens: 1.1, brandSens: 0.30, shelfLife: 480, decay: 0.0040, weight: 1.0,  unlock: 1,  raw: true,  inter: false, retail: true },
  { id: 5,  code: 'TOBACCO',   name: 'Tütün',   categoryId: 4, unit: 'kg',    price: 30,   demand: 0,    priceSens: 1.2, qualSens: 1.2, brandSens: 0.2, shelfLife: 8640, decay: 0.0001, weight: 1.0,  unlock: 7,  raw: true,  inter: false, retail: false },
  { id: 6,  code: 'CIGARETTE', name: 'Sigara',  categoryId: 3, unit: 'paket', price: 80,   demand: 8,    priceSens: 0.9, qualSens: 0.9, brandSens: 1.20, shelfLife: null, decay: 0,     weight: 0.2,  unlock: 8,  raw: false, inter: false, retail: true },
  { id: 7,  code: 'IRON',      name: 'Demir',   categoryId: 4, unit: 'kg',    price: 28,   demand: 0,    priceSens: 1.5, qualSens: 1.0, brandSens: 0.2, shelfLife: null, decay: 0,     weight: 1.0,  unlock: 13, raw: true,  inter: false, retail: false },
  { id: 8,  code: 'COAL',      name: 'Kömür',   categoryId: 4, unit: 'kg',    price: 18,   demand: 0,    priceSens: 1.5, qualSens: 0.9, brandSens: 0.2, shelfLife: null, decay: 0,     weight: 1.0,  unlock: 13, raw: true,  inter: false, retail: false },
  { id: 9,  code: 'STEEL',     name: 'Çelik',   categoryId: 5, unit: 'kg',    price: 72,   demand: 0,    priceSens: 1.3, qualSens: 1.1, brandSens: 0.25, shelfLife: null, decay: 0,    weight: 1.0,  unlock: 15, raw: false, inter: true,  retail: false },
  { id: 10, code: 'FURNITURE', name: 'Mobilya', categoryId: 6, unit: 'adet',  price: 6000, demand: 0.15, priceSens: 0.9, qualSens: 1.3, brandSens: 1.15, shelfLife: null, decay: 0,    weight: 60.0, unlock: 12, raw: false, inter: false, retail: true },
] as const;

/**
 * Dış ticaret izinleri — docs/12 §3.4.
 * Kural: nihai perakende ürünü ithal EDİLEMEZ (oyuncunun mağazası dünya
 * piyasasıyla rekabet etmesin).
 * MVP-1 İSTİSNASI: Mobilya ithal edilebilir — kereste zinciri (Ağaç → Kereste)
 * henüz yok, dolayısıyla yurt içi üretimi mümkün değil. Zincir F11'de gelince
 * bu istisna kapatılır ve `importable = false` yapılır.
 */
export const worldMarket = [
  { productId: 1,  importable: true,  exportable: true  }, // Buğday
  { productId: 2,  importable: true,  exportable: true  }, // Un
  { productId: 3,  importable: false, exportable: true  }, // Ekmek — nihai
  { productId: 4,  importable: false, exportable: true  }, // Domates — nihai
  { productId: 5,  importable: true,  exportable: true  }, // Tütün
  { productId: 6,  importable: false, exportable: true  }, // Sigara — nihai
  { productId: 7,  importable: true,  exportable: true  }, // Demir
  { productId: 8,  importable: true,  exportable: true  }, // Kömür
  { productId: 9,  importable: true,  exportable: true  }, // Çelik
  { productId: 10, importable: true,  exportable: true  }, // Mobilya — MVP-1 istisnası
];

export const facilityTypes = [
  { id: 1,  code: 'GREENGROCER', name: 'Manav',            category: 'RETAIL',      cost: 8_000,   capacity: 0,   maintenance: 120, storage: 2_000,  ticks: 1, unlock: 1,  port: false },
  { id: 2,  code: 'KIOSK',       name: 'Büfe',             category: 'RETAIL',      cost: 8_000,   capacity: 0,   maintenance: 120, storage: 1_500,  ticks: 1, unlock: 1,  port: false },
  { id: 3,  code: 'MARKET',      name: 'Market',           category: 'RETAIL',      cost: 35_000,  capacity: 0,   maintenance: 380, storage: 8_000,  ticks: 4, unlock: 2,  port: false },
  { id: 4,  code: 'VEG_GARDEN',  name: 'Sebze Bahçesi',    category: 'AGRICULTURE', cost: 20_000,  capacity: 18,  maintenance: 210, storage: 4_000,  ticks: 6, unlock: 4,  port: false },
  { id: 5,  code: 'WHEAT_FIELD', name: 'Buğday Tarlası',   category: 'AGRICULTURE', cost: 25_000,  capacity: 30,  maintenance: 240, storage: 6_000,  ticks: 8, unlock: 5,  port: false },
  { id: 6,  code: 'MILL',        name: 'Değirmen',         category: 'INDUSTRY',    cost: 45_000,  capacity: 22,  maintenance: 460, storage: 6_000,  ticks: 8, unlock: 6,  port: false },
  { id: 7,  code: 'BAKERY',      name: 'Fırın',            category: 'INDUSTRY',    cost: 30_000,  capacity: 40,  maintenance: 380, storage: 3_000,  ticks: 6, unlock: 6,  port: false },
  { id: 8,  code: 'TOBACCO_FARM',name: 'Tütün Tarlası',    category: 'AGRICULTURE', cost: 30_000,  capacity: 9,   maintenance: 280, storage: 3_000,  ticks: 8, unlock: 7,  port: false },
  { id: 9,  code: 'CIG_FACTORY', name: 'Sigara Fabrikası', category: 'INDUSTRY',    cost: 70_000,  capacity: 14,  maintenance: 720, storage: 4_000,  ticks: 12, unlock: 8, port: false },
  { id: 10, code: 'IRON_MINE',   name: 'Demir Madeni',     category: 'MINING',      cost: 60_000,  capacity: 26,  maintenance: 640, storage: 8_000,  ticks: 12, unlock: 13, port: false },
  { id: 11, code: 'COAL_MINE',   name: 'Kömür Madeni',     category: 'MINING',      cost: 50_000,  capacity: 34,  maintenance: 560, storage: 8_000,  ticks: 12, unlock: 13, port: false },
  { id: 12, code: 'STEEL_MILL',  name: 'Çelik Fabrikası',  category: 'INDUSTRY',    cost: 120_000, capacity: 18,  maintenance: 1_250, storage: 10_000, ticks: 16, unlock: 15, port: false },
  { id: 13, code: 'PORT',        name: 'Liman',            category: 'LOGISTICS',   cost: 200_000, capacity: 0,   maintenance: 1_800, storage: 20_000, ticks: 20, unlock: 7, port: true },
] as const;

/** Kapasite katsayıları — madde 12. Kod içine gömülmez. */
export const facilityLevelCurve = [
  [1, 1.00], [2, 1.40], [3, 1.90], [4, 2.50], [5, 3.30],
  [6, 4.30], [7, 5.60], [8, 7.20], [9, 9.10], [10, 11.50],
] as const;

/** Reçeteler — madde 13. Girdisiz olanlar hammadde üreticileridir. */
export const recipes: {
  facilityCode: string; outputCode: string; outputQty: number;
  cycleTicks: number; labor: number; energy: number; unlock: number;
  inputs: { code: string; qty: number; minQuality?: number }[];
}[] = [
  { facilityCode: 'VEG_GARDEN',  outputCode: 'TOMATO',    outputQty: 1, cycleTicks: 1, labor: 3,   energy: 1,  unlock: 4,  inputs: [] },
  { facilityCode: 'WHEAT_FIELD', outputCode: 'WHEAT',     outputQty: 1, cycleTicks: 1, labor: 2,   energy: 1,  unlock: 5,  inputs: [] },
  { facilityCode: 'TOBACCO_FARM',outputCode: 'TOBACCO',   outputQty: 1, cycleTicks: 1, labor: 6,   energy: 2,  unlock: 7,  inputs: [] },
  { facilityCode: 'IRON_MINE',   outputCode: 'IRON',      outputQty: 1, cycleTicks: 1, labor: 6,   energy: 5,  unlock: 13, inputs: [] },
  { facilityCode: 'COAL_MINE',   outputCode: 'COAL',      outputQty: 1, cycleTicks: 1, labor: 4,   energy: 4,  unlock: 13, inputs: [] },
  // 4 kg Buğday → 3 kg Un
  { facilityCode: 'MILL',        outputCode: 'FLOUR',     outputQty: 3, cycleTicks: 1, labor: 4,   energy: 3,  unlock: 6,  inputs: [{ code: 'WHEAT', qty: 4 }] },
  // 1 kg Un → 2 Ekmek
  { facilityCode: 'BAKERY',      outputCode: 'BREAD',     outputQty: 2, cycleTicks: 1, labor: 3,   energy: 2,  unlock: 6,  inputs: [{ code: 'FLOUR', qty: 1 }] },
  // 1 kg Tütün → 20 paket Sigara
  { facilityCode: 'CIG_FACTORY', outputCode: 'CIGARETTE', outputQty: 20, cycleTicks: 1, labor: 18, energy: 9,  unlock: 8,  inputs: [{ code: 'TOBACCO', qty: 1, minQuality: 40 }] },
  // 3 kg Kömür + 2 kg Demir → 2 kg Çelik
  { facilityCode: 'STEEL_MILL',  outputCode: 'STEEL',     outputQty: 2, cycleTicks: 1, labor: 9,   energy: 14, unlock: 15, inputs: [{ code: 'COAL', qty: 3 }, { code: 'IRON', qty: 2, minQuality: 30 }] },
];

/**
 * Kredi şartları — F5. Faiz TUR BAŞINADIR.
 * Çıpa: ~%50 / oyun yılı (2688 tur) → (1.5)^(1/2688) − 1 ≈ 0,000151.
 * Düşük seviyede risk primi eklenir. Kaldıraç düşük tutulur (R16).
 */
export const loanTerms = [
  { levelMin: 1,  leverageRatio: 0.40, interestRate: 0.00025, maxTermTicks: 2688, defaultAfterMissed: 3 },
  { levelMin: 6,  leverageRatio: 0.60, interestRate: 0.00020, maxTermTicks: 2688, defaultAfterMissed: 3 },
  { levelMin: 13, leverageRatio: 0.75, interestRate: 0.00015, maxTermTicks: 5376, defaultAfterMissed: 3 },
];

/**
 * Seviyeler 1–12 — madde 42. BEŞ kriter de sağlanmalıdır (AND, OR değil);
 * böylece zengin bir arkadaştan para almak tek başına seviye atlatmaz (C4).
 */
export const companyLevels = [
  { level: 1,  xp: 0,       value: 0,         volume: 0,        units: 0,     products: 0, title: 'Esnaf' },
  { level: 2,  xp: 700,     value: 45_000,    volume: 15_000,   units: 0,     products: 1, title: 'Dükkân Sahibi' },
  { level: 3,  xp: 2_000,   value: 80_000,    volume: 60_000,   units: 0,     products: 1, title: 'Tüccar' },
  { level: 4,  xp: 4_500,   value: 140_000,   volume: 150_000,  units: 0,     products: 2, title: 'Bahçe Sahibi' },
  { level: 5,  xp: 9_000,   value: 240_000,   volume: 320_000,  units: 500,   products: 2, title: 'Çiftçi' },
  { level: 6,  xp: 17_000,  value: 400_000,   volume: 620_000,  units: 2_000, products: 3, title: 'Değirmenci' },
  { level: 7,  xp: 30_000,  value: 650_000,   volume: 1_100_000, units: 5_000, products: 3, title: 'Üretici' },
  { level: 8,  xp: 52_000,  value: 1_050_000, volume: 1_900_000, units: 12_000, products: 4, title: 'Sanayici' },
  { level: 9,  xp: 88_000,  value: 1_700_000, volume: 3_200_000, units: 25_000, products: 4, title: 'Fabrikatör' },
  { level: 10, xp: 145_000, value: 2_700_000, volume: 5_400_000, units: 45_000, products: 5, title: 'Zincir Sahibi' },
  { level: 11, xp: 235_000, value: 4_300_000, volume: 9_000_000, units: 80_000, products: 5, title: 'Grup Başkanı' },
  { level: 12, xp: 380_000, value: 6_800_000, volume: 15_000_000, units: 140_000, products: 6, title: 'Holding' },
];

export const simpleNpcSellers = [
  { name: 'Ege Sebze Toptan',    cityCode: 'IZM', productCode: 'TOMATO', priceMult: 0.92, supplyPerTick: 400, quality: 78 },
  { name: 'Trakya Tarım',        cityCode: 'IST', productCode: 'TOMATO', priceMult: 1.00, supplyPerTick: 300, quality: 68 },
  { name: 'Konya Ovası Hububat', cityCode: 'KON', productCode: 'WHEAT',  priceMult: 0.95, supplyPerTick: 800, quality: 72 },
  { name: 'Anadolu Değirmen',    cityCode: 'ANK', productCode: 'FLOUR',  priceMult: 1.02, supplyPerTick: 500, quality: 75 },
  { name: 'Marmara Fırıncılık',  cityCode: 'BRS', productCode: 'BREAD',  priceMult: 0.96, supplyPerTick: 600, quality: 70 },
];

/** Denge parametreleri — hepsi admin panelden değiştirilebilir (madde 47). */
export const gameConfigs: { key: string; value: unknown }[] = [
  { key: 'economy.calendar', value: { tickMinutes: 15, ticksPerDay: 96, ticksPerSeason: 672, ticksPerYear: 2688 } },
  { key: 'economy.start',    value: { cash: money(30_000).toString(), level: 1, facilityChoices: ['GREENGROCER', 'KIOSK'] } },
  { key: 'economy.production', value: { rawBaseQuality: 70, qualityVariance: 1.5, conditionWearPerTick: 0.05, haltBelowCondition: 30 } },
  { key: 'economy.upgrade',    value: { costMultiplier: 0.75, costExponent: 1.55, maxLevel: 10 } },
  { key: 'economy.retail',   value: { redistributionRounds: 3, noiseMin: 0.97, noiseMax: 1.03, cycleAmplitude: 0.12 } },
  { key: 'economy.pricing',  value: { emaAlpha: 0.25, trimLowPct: 0.10, trimHighPct: 0.90, shockClampPct: 0.15, referenceWindowTicks: 96 } },
  { key: 'economy.shipping', value: { baseRatePerKgDistance: money(0.35).toString() } },
  { key: 'economy.fx',       value: { rate0: FX_RATE_0, alpha: 0.05, tradeBalanceK: 0.02, spreadPct: 0.015, clampPerTick: 0.005, clampPerDay: 0.03, unlockLevel: 7 } },
  { key: 'economy.foreign',  value: { exportMultiplier: 0.75, importMultiplier: 1.35, depthPct: 0.15, prorata: true } },
  { key: 'economy.inventory',value: { liquidityDiscountThreshold: 0.20, liquidityDiscountPct: 0.50 } },
  { key: 'director.bands',   value: { healthy: 75, watch: 55, adjust: 35, stimulate: 20, hysteresisTicks: 6, directiveTtlTicks: 96 } },
  { key: 'director.levers',  value: { INVENTORY_TARGET: 0.40, PRODUCTION_BIAS: 0.30, BUY_BIAS: 0.35, INVESTMENT_BIAS: 0.50, CAPACITY_CAP: 1.0, IMPORT_QUOTA: 3.0 } },
  { key: 'health.weights',   value: { supply: 0.30, sellers: 0.15, buyers: 0.10, depth: 0.15, stability: 0.15, playerShare: 0.15 } },
  { key: 'npc.population',   value: { perProductPerCity: 1.2, priceBandPerTick: 0.03, emergencyBandPerTick: 0.10, emergencyHealthBelow: 35 } },
  { key: 'npc.inventory',    value: { minTicks: 4, targetTicks: 12, maxTicks: 24 } },
  { key: 'npc.simpleSellers', value: simpleNpcSellers },
];

/**
 * MVP-0 NPC satıcıları (docs/08): "yalnız NPC satıcılar, sabit arz, oyuncu alıcı".
 * Bunlar tam NPC ajanı DEĞİLDİR — sabit fiyatlı, her tur tazelenen arz kaynağıdır.
 * Kâr güdüsü, stok yönetimi ve yatırım kararı olan gerçek NPC'ler F6'da gelir.
 */
export const helpers = { money, qty };
