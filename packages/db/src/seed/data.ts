/**
 * Başlangıç dünyası — MVP-1 (docs/08).
 * Bu değerler DENGE TOHUMUDUR, kesin değer değildir; F8 simülasyonunda ayarlanır.
 * Hiçbiri koda gömülü değildir: hepsi tablodan okunur, admin panelden değiştirilebilir.
 */
import { money, qty } from '@kapital/shared';

/** Kur çıpası: 1 USD = 35 ₺. Dünya fiyatları bu ana göre sabitlenir (docs/12 §3.1). */
export const FX_RATE_0 = 35;

/**
 * Bakım gideri TUR BAŞINADIR ve kurulum maliyetinden TÜRETİLİR.
 *
 * Elle yazıldığında birim hatası yapılmıştı: günlük değerler tur başına
 * yazılınca 8.000 ₺'lik manavın bakımı günde 11.520 ₺ (kurulumun %144'ü)
 * oluyordu ve ekonomi her tur para kaybediyordu. Türetilmiş değer bu hatanın
 * tekrarını engeller.
 *
 * 0,00025 ≈ kurulum maliyetinin günde %2,4'ü (96 tur).
 */
export const MAINTENANCE_RATE = 0.00025;
const upkeep = (cost: number) => Math.round(cost * MAINTENANCE_RATE * 100) / 100;

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
  { id: 1,  code: 'WHEAT',     name: 'Buğday',  categoryId: 4, unit: 'kg',    price: 8,   demand: 0,    priceSens: 1.4, qualSens: 0.9, brandSens: 0.2, shelfLife: 2880, decay: 0.0004, weight: 1.0,  unlock: 5,  raw: true,  inter: false, retail: false },
  { id: 2,  code: 'FLOUR',     name: 'Un',      categoryId: 5, unit: 'kg',    price: 22,   demand: 0,    priceSens: 1.3, qualSens: 1.0, brandSens: 0.3, shelfLife: 5760, decay: 0.0002, weight: 1.0,  unlock: 6,  raw: false, inter: true,  retail: false },
  /*
   * ★ TİCARET kilitleri ilk hafta oyuncusunun eriştiği pazarı belirler (R50).
   *
   * Ekmek 6, sigara 8'di. 400. turda oyuncular seviye 1 (39 kişi), 2 (17) ve
   * 3 (4) dağılımındaydı — yani ilk haftanın TAMAMI tek ürün: domates.
   * 86 oyuncu dükkânı aynı domates için yarışırken NPC marketleri dördünü
   * birden satıyordu: dükkân başına 2,8 kg/tur vs 37,6. Süresi dolan 2.141
   * oyuncu emrinin hepsi domatesti.
   *
   * Ekmek en büyük pazardır (1.014 kg/tur, domates 634) ve Lv2'de açılması
   * ilk haftayı tek üründen çıkarır. Sigara Lv4 hedef olarak kalır.
   *
   * ÜRETİM kilitleri (buğday 5, un 6) bilerek yukarıda: oyuncu önce satmayı,
   * sonra üretmeyi öğrenir.
   */
  { id: 3,  code: 'BREAD',     name: 'Ekmek',   categoryId: 1, unit: 'adet',  price: 15,   demand: 40,   priceSens: 1.7, qualSens: 0.8, brandSens: 0.35, shelfLife: 96,  decay: 0.0150, weight: 0.5,  unlock: 2,  raw: false, inter: false, retail: true },
  { id: 4,  code: 'TOMATO',    name: 'Domates', categoryId: 2, unit: 'kg',    price: 15,   demand: 25,   priceSens: 1.5, qualSens: 1.1, brandSens: 0.30, shelfLife: 480, decay: 0.0040, weight: 1.0,  unlock: 1,  raw: true,  inter: false, retail: true },
  { id: 5,  code: 'TOBACCO',   name: 'Tütün',   categoryId: 4, unit: 'kg',    price: 30,   demand: 0,    priceSens: 1.2, qualSens: 1.2, brandSens: 0.2, shelfLife: 8640, decay: 0.0001, weight: 1.0,  unlock: 7,  raw: true,  inter: false, retail: false },
  { id: 6,  code: 'CIGARETTE', name: 'Sigara',  categoryId: 3, unit: 'paket', price: 80,   demand: 8,    priceSens: 0.9, qualSens: 0.9, brandSens: 1.20, shelfLife: null, decay: 0,     weight: 0.2,  unlock: 4,  raw: false, inter: false, retail: true },
  { id: 7,  code: 'IRON',      name: 'Demir',   categoryId: 4, unit: 'kg',    price: 24,   demand: 0,    priceSens: 1.5, qualSens: 1.0, brandSens: 0.2, shelfLife: null, decay: 0,     weight: 1.0,  unlock: 13, raw: true,  inter: false, retail: false },
  { id: 8,  code: 'COAL',      name: 'Kömür',   categoryId: 4, unit: 'kg',    price: 14,   demand: 0,    priceSens: 1.5, qualSens: 0.9, brandSens: 0.2, shelfLife: null, decay: 0,     weight: 1.0,  unlock: 13, raw: true,  inter: false, retail: false },
  { id: 9,  code: 'STEEL',     name: 'Çelik',   categoryId: 5, unit: 'kg',    price: 72,   demand: 0,    priceSens: 1.3, qualSens: 1.1, brandSens: 0.25, shelfLife: null, decay: 0,    weight: 1.0,  unlock: 15, raw: false, inter: true,  retail: false },
  { id: 10, code: 'FURNITURE', name: 'Mobilya', categoryId: 6, unit: 'adet',  price: 1200, demand: 0.15, priceSens: 0.9, qualSens: 1.3, brandSens: 1.15, shelfLife: null, decay: 0,    weight: 60.0, unlock: 12, raw: false, inter: false, retail: true },
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
  /*
   * ★ BAŞLANGIÇ TESİSLERİ OYUNUN EN KÖTÜ TESİSLERİ OLAMAZ.
   *
   * F8 ölçümünde geri ödeme süreleri: Manav 13 gün, Büfe 7 gün — Market 3,
   * fırın 2, sebze bahçesi 3. Yeni oyuncu merdivenin EN YAVAŞ basamağında
   * başlıyor ve hızlanamıyordu; 60 oyuncunun 57'si 7 gün boyunca Lv1'de kaldı.
   *
   * Maliyet yarıya indirildi. 30.000 ₺ başlangıç sermayesiyle oyuncu artık
   * ilk oturumda iki-üç dükkân açabilir; geri ödeme Manav 13 → ~6, Büfe
   * 7 → ~3,5 güne iner. Ekonominin geri kalanına dokunulmadı: ölçüm sorunun
   * genel değil, YALNIZ bu iki tesiste olduğunu gösterdi.
   *
   * Depo da büyütüldü: küçük depo, rafın sürekli boşalması demek.
   */
  { id: 1,  code: 'GREENGROCER', name: 'Manav',            category: 'RETAIL',      cost: 4_000, capacity: 0, maintenance: upkeep(4_000), storage: 3_000,  ticks: 1, unlock: 1,  port: false },
  { id: 2,  code: 'KIOSK',       name: 'Büfe',             category: 'RETAIL',      cost: 4_000, capacity: 0, maintenance: upkeep(4_000), storage: 2_500,  ticks: 1, unlock: 1,  port: false },
  { id: 3,  code: 'MARKET',      name: 'Market',           category: 'RETAIL',      cost: 35_000, capacity: 0, maintenance: upkeep(35_000), storage: 8_000,  ticks: 4, unlock: 2,  port: false },
  /*
   * ★ Kilit Lv2 → Lv1 (F8, R33'ün son adımı).
   *
   * Lv2'ye çekmek yetmedi: oyuncular Lv2'ye çıkmak için domates almak
   * zorundaydı, ama domates KIT ve dağıtım "kazanan hepsini alır" biçiminde.
   * Ölçüldü: 60 oyuncunun 54'ü 96 tur boyunca SIFIR ciro yaptı ve hiçbirinin
   * rafında mal yoktu; domatesin %85'ini Lv2'yi geçmiş 6 oyuncu aldı.
   *
   * Bahçe Lv1'de açılınca oyuncu kendi arzını üretir ve kıt malı kapmak için
   * yarışmak zorunda kalmaz. Erken oyun "dükkân aç + bahçe ek" olur; bu, hem
   * onboarding'in "200 kg domates al, sat" adımıyla uyumlu hem de tek ürüne
   * bağımlılığı kırar.
   */
  { id: 4,  code: 'VEG_GARDEN',  name: 'Sebze Bahçesi',    category: 'AGRICULTURE', cost: 20_000, capacity: 18, maintenance: upkeep(20_000), storage: 4_000,  ticks: 6, unlock: 1,  port: false },
  { id: 5,  code: 'WHEAT_FIELD', name: 'Buğday Tarlası',   category: 'AGRICULTURE', cost: 25_000, capacity: 30, maintenance: upkeep(25_000), storage: 6_000,  ticks: 8, unlock: 5,  port: false },
  { id: 6,  code: 'MILL',        name: 'Değirmen',         category: 'INDUSTRY',    cost: 45_000, capacity: 22, maintenance: upkeep(45_000), storage: 6_000,  ticks: 8, unlock: 6,  port: false },
  { id: 7,  code: 'BAKERY',      name: 'Fırın',            category: 'INDUSTRY',    cost: 30_000, capacity: 40, maintenance: upkeep(30_000), storage: 3_000,  ticks: 6, unlock: 6,  port: false },
  { id: 8,  code: 'TOBACCO_FARM',name: 'Tütün Tarlası',    category: 'AGRICULTURE', cost: 30_000, capacity: 16, maintenance: upkeep(30_000), storage: 3_000,  ticks: 8, unlock: 7,  port: false },
  { id: 9,  code: 'CIG_FACTORY', name: 'Sigara Fabrikası', category: 'INDUSTRY',    cost: 70_000, capacity: 14, maintenance: upkeep(70_000), storage: 4_000,  ticks: 12, unlock: 8, port: false },
  { id: 10, code: 'IRON_MINE',   name: 'Demir Madeni',     category: 'MINING',      cost: 60_000, capacity: 26, maintenance: upkeep(60_000), storage: 8_000,  ticks: 12, unlock: 13, port: false },
  { id: 11, code: 'COAL_MINE',   name: 'Kömür Madeni',     category: 'MINING',      cost: 50_000, capacity: 34, maintenance: upkeep(50_000), storage: 8_000,  ticks: 12, unlock: 13, port: false },
  { id: 12, code: 'STEEL_MILL',  name: 'Çelik Fabrikası',  category: 'INDUSTRY',    cost: 120_000, capacity: 18, maintenance: upkeep(120_000), storage: 10_000, ticks: 16, unlock: 15, port: false },
  { id: 13, code: 'PORT',        name: 'Liman',            category: 'LOGISTICS',   cost: 200_000, capacity: 0, maintenance: upkeep(200_000), storage: 20_000, ticks: 20, unlock: 7, port: true },
  { id: 14, code: 'FURNITURE_FACTORY', name: 'Mobilya Fabrikası', category: 'INDUSTRY', cost: 150_000, capacity: 2, maintenance: upkeep(150_000), storage: 6_000, ticks: 18, unlock: 16, port: false },
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
  // ★ Kilit Lv4 → Lv1 (F8, R33). Tesis tipi VE reçete birlikte düşer: yalnız
  // birini indirmek, kurulabilen ama üretemeyen bir tesis bırakırdı.
  { facilityCode: 'VEG_GARDEN',  outputCode: 'TOMATO',    outputQty: 1, cycleTicks: 1, labor: 8,   energy: 3,  unlock: 1,  inputs: [] },
  { facilityCode: 'WHEAT_FIELD', outputCode: 'WHEAT',     outputQty: 1, cycleTicks: 1, labor: 4,   energy: 2,  unlock: 5,  inputs: [] },
  { facilityCode: 'TOBACCO_FARM',outputCode: 'TOBACCO',   outputQty: 1, cycleTicks: 1, labor: 15,  energy: 7,  unlock: 7,  inputs: [] },
  { facilityCode: 'IRON_MINE',   outputCode: 'IRON',      outputQty: 1, cycleTicks: 1, labor: 11,  energy: 7,  unlock: 13, inputs: [] },
  { facilityCode: 'COAL_MINE',   outputCode: 'COAL',      outputQty: 1, cycleTicks: 1, labor: 6,   energy: 4,  unlock: 13, inputs: [] },
  // 4 kg Buğday → 3 kg Un
  { facilityCode: 'MILL',        outputCode: 'FLOUR',     outputQty: 3, cycleTicks: 1, labor: 12,  energy: 5,  unlock: 6,  inputs: [{ code: 'WHEAT', qty: 4 }] },
  // 1 kg Un → 4 Ekmek (350 g/somun)
  { facilityCode: 'BAKERY',      outputCode: 'BREAD',     outputQty: 4, cycleTicks: 1, labor: 16,  energy: 6,  unlock: 6,  inputs: [{ code: 'FLOUR', qty: 1 }] },
  // 8 kg Tütün → 20 paket Sigara. İşçilik yüksektir: paket fiyatının büyük
  // kısmı işleme ve vergidir, yaprak maliyeti değil.
  { facilityCode: 'CIG_FACTORY', outputCode: 'CIGARETTE', outputQty: 20, cycleTicks: 1, labor: 650, energy: 295, unlock: 8, inputs: [{ code: 'TOBACCO', qty: 8, minQuality: 40 }] },
  // 3 kg Kömür + 2 kg Demir → 2 kg Çelik
  { facilityCode: 'STEEL_MILL',  outputCode: 'STEEL',     outputQty: 2, cycleTicks: 1, labor: 11,  energy: 6,  unlock: 15, inputs: [{ code: 'COAL', qty: 3 }, { code: 'IRON', qty: 2, minQuality: 30 }] },
  // 10 kg Çelik → 1 Mobilya. Zincirin en derin ucu: maden → çelik → mobilya.
  { facilityCode: 'FURNITURE_FACTORY', outputCode: 'FURNITURE', outputQty: 1, cycleTicks: 1, labor: 120, energy: 49, unlock: 16, inputs: [{ code: 'STEEL', qty: 10, minQuality: 35 }] },
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
/**
 * Seviye merdiveni — madde 11.
 *
 * ★ `products` (farklı ürün ÜRETMİŞ olma şartı) ile tesis kilit seviyeleri
 * TUTARLI olmalıdır. İlk tasarımda değildi ve merdiven kilitleniyordu:
 * Lv2 "1 farklı ürün üret" istiyordu ama en düşük üretim tesisi (Sebze
 * Bahçesi) Lv4'te açılıyordu. Sonuç: hiçbir oyuncu seviye 1'i geçemiyordu.
 * F8 simülasyonu bunu ortaya çıkardı (200 turda 184 LEVEL_LOCKED reddi).
 *
 * Kural: L seviyesinin `products` şartı, L−1'de üretilebilen farklı ürün
 * sayısını AŞAMAZ. `seed-data.test.ts` bunu doğrular.
 *
 * Üretilebilen ürün sayısı: Lv1–3 → 0 · Lv4 → 1 (domates) · Lv5 → 2 (+buğday)
 * Lv6 → 4 (+un, ekmek) · Lv7 → 5 (+tütün) · Lv8 → 6 (+sigara)
 * Lv13 → 8 (+demir, kömür) · Lv15 → 9 (+çelik) · Lv16 → 10 (+mobilya)
 */
export const companyLevels = [
  { level: 1,  xp: 0,       value: 0,         volume: 0,        units: 0,     products: 0, title: 'Esnaf' },
  /*
   * ★ Lv2 İLK GÜN İÇİNDE ULAŞILABİLİR OLMALI.
   *
   * Onboarding zinciri (docs/08) 7 adımda 700 XP verir ve oyuncuyu Lv2'ye
   * çıkarmayı hedefler: şehir seç → manav aç → 200 kg domates al → fiyat koy →
   * ilk satış → ilk kâr raporu. Ama şart 45.000 ₺ şirket değeriydi — 30.000 ₺
   * başlangıçtan **%50 büyüme**. Tek oturumda imkânsız.
   *
   * F8'de ölçüldü: 60 oyuncunun 57'si 700 tur (7,3 gün) boyunca Lv1'de kaldı.
   * Duvarı geçen 3 oyuncu bahçe kurdu, kendi arzını üretti, marjı sıçradı ve
   * 154.000–357.000 ₺'ye çıktı. Yani ilerleme bir EŞİK ETKİSİ: geçen uçuyor,
   * geçemeyen sıkışıyor. Duvarın kendisi tasarımda yoktu, kazara oluşmuştu.
   *
   * Şartlar ilk günün gerçek getirisine indirildi. Sonraki basamaklar aynı
   * kaldı: asıl mesele merdivenin İLK basamağıydı.
   */
  /*
   * ★ İlk basamağın XP eşiği ÖLÇÜLEN kazanım hızına göre (R50).
   *
   * 700 idi. XP satış cirosundan gelir (100 ₺ = 1 XP) ve ölçüm şuydu: Lv1
   * oyuncusu 120 turda 113 XP topluyor (~0,94 XP/tur), yani 700'e ~745 turda
   * varıyor — ilk hafta (672 tur) tam biterken. Ekmeği Lv2'ye çekmek ancak
   * oyuncu oraya ERKEN varabilirse işe yarar; aksi halde kilit döngüsel kalır:
   * ekmek için Lv2, Lv2 için ekmek cirosu.
   *
   * 200, ölçülen hızda ~2 güne denk gelir: oyuncu ikinci ürününü ilk günlerde
   * alır ve haftanın kalanını iki pazarda geçirir. Ekmek açılınca ciro —
   * dolayısıyla XP — hızlandığı için sonraki basamaklara DOKUNULMADI; merdiven
   * kendi kendini toparlar.
   */
  { level: 2,  xp: 200,     value: 34_000,    volume: 6_000,    units: 0,     products: 0, title: 'Dükkân Sahibi' },
  /*
   * ★ Lv3/Lv4 DEĞER şartı indirildi (R65) — döngüsel kilit.
   *
   * Ölçüldü: oyuncu dükkânı 1,93 ürün satıyor, NPC dükkânı 4,00. Dükkân
   * başına satışı tek başına bu açıklıyor (1,93/4,00 × 14,1 = 6,80 tahmin,
   * 7,00 ölçülen). Sigara Lv4'te ve yüksek değerli: oyuncu hacmin %77'sini
   * taşıyıp cironun %52'sini alıyor, kg başına NPC 3 kat kazanıyor.
   *
   * Döngü: 100.000 ₺ değere ulaşmak için sigara satmak gerekiyordu, sigara
   * satmak için 140.000 ₺ değer. Oyuncular hafta sonunda 56.718 ₺'de takılı
   * kalıyor (seviye 1,95) ve kapının week1_value hedefi hiç geçmiyordu.
   *
   * Bu, R50'nin Lv2'de bulup kırdığı kilidin aynısı. R50'nin notu sonraki
   * basamaklar için "merdiven kendi kendini toparlar" demişti; ÖLÇÜM BU
   * TAHMİNİ ÇÜRÜTTÜ — toparlanma olmadı.
   *
   * Kilit seviyeleri ve ürün sırası AYNI kaldı; yalnız basamak alçaldı.
   * XP ve hacim şartlarına DOKUNULMADI: hangisinin bağladığı ölçülecek
   * (teshis.sql R65 bloğu), tahminle indirilmeyecek.
   */
  /*
   * ★★ XP şartı da indirildi (R70) — ÖLÇÜLEN darboğaz buymuş.
   *
   * R65 bloğu her basamakta aynı şeyi söyledi (tohum 1 / tohum 4):
   *   Lv1 → Lv2 : xp 0,49 / 0,62  ·  değer 0,97 / 1,00
   *   Lv2 → Lv3 : xp 0,57 / 0,58  ·  değer 0,88 / 0,94
   *   Lv3 → Lv4 : xp 0,79 / 0,70  ·  değer 0,92 / 0,92
   *
   * Değer şartı her yerde %88+ karşılanıyordu; onu indirmek (ilk denemem)
   * oyuncuları merdivende bir basamak yukarı taşıdı ama week1_value'yu
   * kıpırdatmadı. Bağlayan hep XP'ydi.
   *
   * 200'den 2.000'e ON KATLIK bir uçurum vardı: R50 ilk basamağı 700'den
   * 200'e indirip sonrakilere dokunmamış ve "merdiven kendi kendini
   * toparlar" demişti. Toparlamadı.
   *
   * Yeni şekil 200 → 1.000 → 2.500 (5× ve 2,5×). Ölçülen XP birikimiyle
   * uyumlu: Lv2'deki oyuncu hafta sonunda ~1.140 XP'de, Lv3'teki ~3.555'te.
   */
  { level: 3,  xp: 1_000,   value: 45_000,    volume: 60_000,   units: 0,     products: 0, title: 'Tüccar' },
  // Sebze Bahçesi artık Lv2'de açılıyor (R33); başlık Lv2'ye taşındı.
  { level: 4,  xp: 2_500,   value: 75_000,    volume: 150_000,  units: 0,     products: 0, title: 'Toptancı' },
  // Lv4'te Sebze Bahçesi açıldı: artık üretim şartı konabilir.
  { level: 5,  xp: 9_000,   value: 240_000,   volume: 320_000,  units: 500,   products: 1, title: 'Çiftçi' },
  { level: 6,  xp: 17_000,  value: 400_000,   volume: 620_000,  units: 2_000, products: 2, title: 'Değirmenci' },
  { level: 7,  xp: 30_000,  value: 650_000,   volume: 1_100_000, units: 5_000, products: 3, title: 'Üretici' },
  { level: 8,  xp: 52_000,  value: 1_050_000, volume: 1_900_000, units: 12_000, products: 4, title: 'Sanayici' },
  { level: 9,  xp: 88_000,  value: 1_700_000, volume: 3_200_000, units: 25_000, products: 5, title: 'Fabrikatör' },
  { level: 10, xp: 145_000, value: 2_700_000, volume: 5_400_000, units: 45_000, products: 5, title: 'Zincir Sahibi' },
  { level: 11, xp: 235_000, value: 4_300_000, volume: 9_000_000, units: 80_000, products: 6, title: 'Grup Başkanı' },
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
  { key: 'economy.upkeep',  value: { maintenanceRate: MAINTENANCE_RATE, conditionWearPerTick: 0.05 } },
  { key: 'economy.loan',    value: { liquidationRate: 0.5, inflationK: 1.0, creditShareAlarm: 0.20 } },
  { key: 'economy.upgrade',    value: { costMultiplier: 0.75, costExponent: 1.55, maxLevel: 10 } },
  // Dünya talep ölçeği (F8) — talep şirket sayısıyla büyür. `baseMultiplier`
  // kalibrasyon koludur; `sweep.ts` ile taranır.
  // ★ `baseMultiplier` 2: kalibrasyonla seçildi (F8). 1'de büyüme çok yavaş
  // (p90 53.112 ₺), 3'te para arzı %43,2 ve kur %26,6 ile eşikleri aşıyor.
  // 2'de NPC üretim payı %61,2 (hedef %60–80), para arzı %38,8, kur %18,0.
  { key: 'economy.demandScale', value: { baseMultiplier: 2, baselineCompanies: 65,
                                         elasticity: 0.85, max: 20 } },
  // ★ `retailMarkup`: raf fiyatının toptan referansa oranı — perakendecinin
  // kendi giderlerinin (bakım, fire, raf) karşılığı. Bu olmadan raf fiyatı
  // toptan seviyesine çöküyor ve perakende katmanı YAPISAL olarak zarar
  // ediyordu; F8'de ölçüldü: brüt marj %2,4, NPC net −53.288 ₺/96 tur.
  // Dünya olayları — ekonominin havası (madde 30/45). `chancePerTick` 0,012 →
  // günde ~1 olay; aynı anda en fazla 3, aynı olay 3 gün soğur.
  /*
   * ★ Dünyanın rastgelelik tohumu (R57). Turun tohumu bundan ve sıra
   * sayısından türer; duvar saatinden DEĞİL. Aynı dünya + aynı tur = aynı zar.
   * Simülasyon her kapı tohumunda bunu kendi tohumuyla değiştirir, böylece
   * tohumlar farklı ama her biri KENDİ İÇİNDE tekrarlanabilir dünya kurar.
   */
  { key: 'world.rng',        value: { seed: 20260101 } },
  { key: 'world.events',     value: { chancePerTick: 0.012, maxConcurrent: 3, cooldownTicks: 288 } },
  { key: 'economy.retail',   value: { redistributionRounds: 3, noiseMin: 0.97, noiseMax: 1.03, cycleAmplitude: 0.12, retailMarkup: 1.35,
                                     // ★ Günlük talep ritmi (R72): piyasa günden güne kıpırdasın.
                                     // Tur gürültüsü günde ortalaması alınıp kaybolur, bu kalır.
                                     dailyRhythmAmplitude: 0.10 } },
  { key: 'economy.pricing',  value: { emaAlpha: 0.25, trimLowPct: 0.10, trimHighPct: 0.90, shockClampPct: 0.15, referenceWindowTicks: 96 } },
  // Kıtlık tayını (F8): arz talebi karşılamıyorsa alıcı başına tur tavanı
  // konur. `minLot` payın anlamsız küçüklüğe inmesini engeller — 50 alıcıya
  // 2'şer birim dağıtmak, 10 alıcıya 10'ar birim vermekten kötüdür.
  // Kalıcı emir: oyuncunun nakit rezervi. Kural şirketi tamamen boşaltamaz.
  { key: 'standing.orders', value: { cashReserveRatio: 0.15 } },
  { key: 'economy.rationing', value: { minLot: 10 } },
  /*
   * Raf fiyatına stok baskısı (R51). Dükkânın kendi satış hızına göre
   * 8 turdan fazla stok birikince fiyat kademeli düşer, en çok %25.
   * Maliyet tabanı ayrıca korunur: amaç zararına satmak değil, rafı
   * döndürmektir.
   */
  { key: 'retail.clearance', value: { targetTicks: 8, maxDiscount: 0.25 } },
  { key: 'economy.shipping', value: { baseRatePerKgDistance: money(0.35).toString() } },
  { key: 'economy.fx',       value: { rate0: FX_RATE_0, alpha: 0.05, tradeBalanceK: 0.02, spreadPct: 0.015, clampPerTick: 0.005, clampPerDay: 0.03, unlockLevel: 7 } },
  { key: 'economy.foreign',  value: { exportMultiplier: 0.75, importMultiplier: 1.35, depthPct: 0.15, prorata: true } },
  { key: 'market.washTrade', value: { bilateralShareThreshold: 0.30, priceDeviationThreshold: 0.20, windowTicks: 96 } },
  { key: 'economy.inventory',value: { liquidityDiscountThreshold: 0.20, liquidityDiscountPct: 0.50 } },
  { key: 'director.bands',   value: { healthy: 75, watch: 55, adjust: 35, stimulate: 20, hysteresisTicks: 6, directiveTtlTicks: 96 } },
  { key: 'director.levers',  value: { INVENTORY_TARGET: 0.40, PRODUCTION_BIAS: 0.30, BUY_BIAS: 0.35, INVESTMENT_BIAS: 0.50, CAPACITY_CAP: 1.0, IMPORT_QUOTA: 3.0 } },
  { key: 'health.weights',   value: { supply: 0.30, sellers: 0.15, buyers: 0.10, depth: 0.15, stability: 0.15, playerShare: 0.15 } },
  { key: 'npc.population',   value: { perProductPerCity: 1.2, priceBandPerTick: 0.03, emergencyBandPerTick: 0.10, emergencyHealthBelow: 35 } },
  { key: 'npc.inventory',    value: { minTicks: 4, targetTicks: 12, maxTicks: 24 } },
  { key: 'npc.throttle',     value: { targetTicks: 8, maxStepPerTick: 0.05, floor: 0.10 } },
  /*
   * ★ Eşik ÖLÇÜLEN skor dağılımına göre kalibre edildi (R49).
   *
   * 0,55 idi; ulaşılabilir en yüksek skor 0,45 çıktı — yani hiçbir fırsat
   * kendi değeriyle eşiği geçemiyordu. Yatırım yalnız atak NPC'lerin
   * `(0,5 + iştah)` çarpanıyla sızıyordu: 700 turda 4 tesis, NPC payı %56,7
   * (hedef %60–80).
   *
   * Ölçülen dağılım (700. tur): tütün 0,45 · buğday 0,41 · kömür 0,39 ·
   * demir 0,35 · değirmen 0,34 · fırın 0,32 · çelik 0,30 · mobilya 0,27 ·
   * sebze 0,15. Eşik 0,38 tam kıt hammaddeleri geçirir, beslenemeyen
   * fabrikaları girdileri düzelene kadar dışarıda tutar.
   *
   * Eşiğin NEYİ kurulacağına etkisi yoktur: `maybeInvest` en yüksek skorlu
   * TEK fırsatı seçer, sıralamayı `strategicNeed` ve açık/boru hattı koruması
   * belirler. Eşik yalnız yatırımın HIZINI ayarlar.
   */
  { key: 'npc.investment',   value: { threshold: 0.38, cashBufferRatio: 1.5, maxFacilities: 4 } },
  /*
   * Yatırımdan çıkış (R58): tesis kısma tabanında bu kadar tur geçirir VE
   * çıktı stoğu bu kadar turluk üretime denk birikirse kapanır. 96 tur = 1 gün.
   * Katı tutulur: dalgalanmayla kapasite yok edilirse kıtlık derinleşir.
   */
  { key: 'npc.divest',       value: { minIdleTicks: 192, minCoverageTicks: 96 } },
  // Seviye ilerleyişi — madde 11. Onboarding zinciri 7 adımda 700 XP verir
  // (Lv2 şartı); sürekli oyun da benzer büyüklükte olmalı.
  { key: 'progression.experience', value: { retailPerXp: 100, tradePerXp: 200,
                                            producedPerXp: 10, facilityBonus: 100 } },
  // Ekonomi Direktörü — madde 29-33. Ağırlıklar admin panelden ayarlanabilir.
  { key: 'director',         value: { hysteresisTicks: 6, directiveTtlTicks: 96,
                                      targetSellers: 4, targetBuyers: 6 } },
  { key: 'director.reserve', value: { emergencyTicks: 12, priceMultiplier: 1.75,
                                      supplyPerTick: 200 } },
  { key: 'npc.simpleSellers', value: simpleNpcSellers },
];

/**
 * MVP-0 NPC satıcıları (docs/08): "yalnız NPC satıcılar, sabit arz, oyuncu alıcı".
 * Bunlar tam NPC ajanı DEĞİLDİR — sabit fiyatlı, her tur tazelenen arz kaynağıdır.
 * Kâr güdüsü, stok yönetimi ve yatırım kararı olan gerçek NPC'ler F6'da gelir.
 */
export const helpers = { money, qty };
