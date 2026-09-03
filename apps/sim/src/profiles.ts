/**
 * Oyuncu davranış profilleri — F8 denge kapısı.
 *
 * Simüle edilen oyuncular GERÇEK oyuncularla aynı servis yöntemlerini çağırır
 * (`@kapital/api/services`). Buradaki tek şey KARAR mantığıdır: ne zaman, neyi,
 * hangi fiyattan. Kurallar değil, tercihler.
 *
 * Saf fonksiyonlar: veritabanına dokunmaz, rastgeleliği enjekte edilir
 * (ADR-0003 ile aynı disiplin).
 */
import type { Money } from '@kapital/shared';

export type ProfileCode =
  | 'AGGRESSIVE_TRADER' | 'PASSIVE' | 'DISCOUNTER' | 'QUALITY'
  | 'PRODUCER' | 'RETAILER' | 'VERTICAL' | 'SPECULATOR';

export interface PlayerProfile {
  readonly code: ProfileCode;
  readonly name: string;
  /** Nüfus içindeki payı. Toplamları 1,0 olmalı. */
  readonly share: number;
  /** Kaç turda bir karar verir. Oyuncu her 15 dakikada bir oyuna girmez. */
  readonly actEveryTicks: number;
  /** Perakende fiyatını maliyetin kaç katına koyar. */
  readonly targetMargin: number;
  /** 0..1 — yatırım iştahı. Yüksekse nakdini tesise çevirir. */
  readonly investmentAppetite: number;
  /** 0..1 — kredi iştahı. Yüksekse kaldıraç kullanır. */
  readonly creditAppetite: number;
  /** Kaç turluk stok tutmak ister. */
  readonly inventoryTargetTicks: number;
  /** Üretim tesisi mi kurar, perakende mi, ikisi de mi. */
  readonly builds: 'PRODUCTION' | 'RETAIL' | 'BOTH' | 'NONE';
  /** Toptan piyasada al-sat yapar mı (üretmeden). */
  readonly trades: boolean;
  /** Kaliteye mi fiyata mı oynar — 0 tamamen fiyat, 1 tamamen kalite. */
  readonly qualityBias: number;
}

/**
 * Sekiz profil (yol haritası F8).
 *
 * Paylar gerçek bir oyuncu tabanını taklit eder: çoğunluk pasif ve
 * perakendecidir; dikey entegre ve spekülatör azınlıktır.
 */
export const PLAYER_PROFILES: readonly PlayerProfile[] = [
  {
    code: 'PASSIVE', name: 'Pasif oyuncu', share: 0.28,
    actEveryTicks: 96, targetMargin: 0.25, investmentAppetite: 0.05,
    creditAppetite: 0.0, inventoryTargetTicks: 16, builds: 'RETAIL',
    trades: false, qualityBias: 0.5,
  },
  {
    code: 'RETAILER', name: 'Perakendeci', share: 0.20,
    actEveryTicks: 8, targetMargin: 0.30, investmentAppetite: 0.45,
    creditAppetite: 0.3, inventoryTargetTicks: 10, builds: 'RETAIL',
    trades: false, qualityBias: 0.5,
  },
  {
    code: 'DISCOUNTER', name: 'Ucuzcu', share: 0.14,
    actEveryTicks: 6, targetMargin: 0.10, investmentAppetite: 0.5,
    creditAppetite: 0.45, inventoryTargetTicks: 6, builds: 'RETAIL',
    trades: false, qualityBias: 0.15,
  },
  {
    code: 'PRODUCER', name: 'Üretici', share: 0.14,
    actEveryTicks: 8, targetMargin: 0.28, investmentAppetite: 0.7,
    creditAppetite: 0.5, inventoryTargetTicks: 8, builds: 'PRODUCTION',
    trades: false, qualityBias: 0.6,
  },
  {
    code: 'QUALITY', name: 'Kaliteci', share: 0.10,
    actEveryTicks: 12, targetMargin: 0.45, investmentAppetite: 0.5,
    creditAppetite: 0.25, inventoryTargetTicks: 12, builds: 'BOTH',
    trades: false, qualityBias: 0.9,
  },
  {
    code: 'AGGRESSIVE_TRADER', name: 'Agresif tüccar', share: 0.07,
    actEveryTicks: 4, targetMargin: 0.18, investmentAppetite: 0.25,
    creditAppetite: 0.6, inventoryTargetTicks: 4, builds: 'NONE',
    trades: true, qualityBias: 0.35,
  },
  {
    code: 'VERTICAL', name: 'Dikey entegre', share: 0.05,
    actEveryTicks: 12, targetMargin: 0.35, investmentAppetite: 0.85,
    creditAppetite: 0.55, inventoryTargetTicks: 12, builds: 'BOTH',
    trades: false, qualityBias: 0.7,
  },
  {
    code: 'SPECULATOR', name: 'Spekülatör', share: 0.02,
    actEveryTicks: 6, targetMargin: 0.50, investmentAppetite: 0.15,
    creditAppetite: 0.7, inventoryTargetTicks: 24, builds: 'NONE',
    trades: true, qualityBias: 0.3,
  },
];

/** Paylar 1,0'a toplanmalı; aksi halde nüfus dağılımı sessizce bozulur. */
export function profileShareSum(): number {
  return PLAYER_PROFILES.reduce((sum, p) => sum + p.share, 0);
}

/**
 * Nüfusu profillere böler — en büyük artık yöntemi.
 *
 * Basit yuvarlama toplamı tutturmaz (1000 × 0,07 = 70 ama 0,145 gibi paylarda
 * artık birikir). Artıkları büyükten küçüğe dağıtmak toplamı garanti eder.
 */
export function allocatePopulation(total: number): Map<ProfileCode, number> {
  const exact = PLAYER_PROFILES.map((p) => ({ code: p.code, value: total * p.share }));
  const counts = new Map<ProfileCode, number>();
  let assigned = 0;
  for (const e of exact) {
    const floor = Math.floor(e.value);
    counts.set(e.code, floor);
    assigned += floor;
  }
  const remainders = exact
    .map((e) => ({ code: e.code, rest: e.value - Math.floor(e.value) }))
    .sort((a, b) => b.rest - a.rest);
  for (let i = 0; assigned < total; i++, assigned++) {
    const code = remainders[i % remainders.length]!.code;
    counts.set(code, counts.get(code)! + 1);
  }
  return counts;
}

/** Bu oyuncu bu turda karar veriyor mu — dağıtılmış zamanlama. */
export function actsThisTick(
  profile: PlayerProfile, playerIndex: number, tickSeq: bigint,
): boolean {
  const every = BigInt(Math.max(1, profile.actEveryTicks));
  // Aynı profildeki oyuncular AYNI turda toplu hareket etmesin: kaydırma.
  const offset = BigInt(playerIndex) % every;
  return (tickSeq + offset) % every === 0n;
}

/**
 * Perakende satış fiyatı.
 *
 * ★ Fiyat PİYASAYA göre konumlanır, yalnız maliyete göre değil.
 *
 * İlk simülasyon koşusunda oyuncular rafı toptanın 1,50 katına, NPC'ler ise
 * 1,09 katına fiyatladı. Talep dağıtımı fiyat duyarlı olduğu için oyuncular
 * neredeyse hiç satmadı: 87 dükkân, 100 turda 7.693 ₺ ciro, 17.272 ₺ bakım.
 * Gerçek bir perakendeci rakibinin %37 üstünde fiyatlamaz — rafında kalır.
 *
 * `marketPrice` rakiplerin ortalama raf fiyatıdır. Ucuzcu altına, kaliteci
 * üstüne konumlanır; ama kimse maliyetinin altına inmez: zarara satmak bir
 * strateji değil hatadır.
 */
export function retailPrice(
  profile: PlayerProfile, unitCost: Money, reference: Money, marketPrice?: Money,
): Money {
  const floor = (unitCost * BigInt(Math.round((1 + profile.targetMargin * 0.35) * 1000))) / 1000n;

  // Piyasa fiyatı bilinmiyorsa referans üzerinden tahmin edilir.
  const anchor = marketPrice && marketPrice > 0n ? marketPrice : reference;
  // Konumlanma: ucuzcu %6 altı, kaliteci %12 üstü.
  const position = 0.94 + profile.qualityBias * 0.18;
  const positioned = (anchor * BigInt(Math.round(position * 1000))) / 1000n;

  return (positioned > floor ? positioned : floor) as Money;
}

/**
 * Stok tamamlama teklifi — perakendeci ve üretici için.
 *
 * ★ Eşleştirmede alıcının fiyatı NAKLİYE DAHİL TAVANDIR (R20). Referansın
 * ALTINA teklif veren bir alıcı hiçbir satıcıyla eşleşemez: NPC satıcılar
 * maliyet + marj ile fiyatlar, yani referansın üstünde isterler.
 *
 * İlk simülasyon koşusunda tam olarak bu oldu: 30 oyuncu 138 alış emri verdi,
 * hiçbiri dolmadı, dolayısıyla hiç raf kurulmadı ve NPC payı %100'de kaldı.
 *
 * Malı GERÇEKTEN isteyen alıcı primi öder; spekülatör ödemez (aşağıda).
 */
export function restockBid(
  profile: PlayerProfile, reference: Money, freightAllowance: Money,
): Money {
  // Ucuzcu ince marjla çalışır, primi de düşük tutar; kaliteci mal bulmaya
  // öncelik verir.
  const premium = 1 + 0.04 + profile.qualityBias * 0.06;
  return ((reference * BigInt(Math.round(premium * 1000))) / 1000n + freightAllowance) as Money;
}

/**
 * Toptan alış teklifi — tüccar ve spekülatör için.
 *
 * Spekülatör düşükten alır ve bekler; agresif tüccar piyasaya yakın alır ve
 * hızlı döner. İkisi de referansın üstüne çıkmaz: üstüne çıkmak, kâr marjını
 * peşinen harcamaktır.
 */
export function tradeBid(profile: PlayerProfile, reference: Money): Money {
  const discount = profile.code === 'SPECULATOR' ? 0.80 : 0.97;
  return ((reference * BigInt(Math.round(discount * 1000))) / 1000n) as Money;
}

/** Toptan satış istemi — alış maliyeti + hedef marj, referansın altına inmez. */
export function tradeAsk(
  profile: PlayerProfile, unitCost: Money, reference: Money,
): Money {
  const costBased = (unitCost * BigInt(Math.round((1 + profile.targetMargin) * 1000))) / 1000n;
  return (costBased > reference ? costBased : reference) as Money;
}

/**
 * Yatırım kararı — nakit tamponu korunur.
 *
 * Oyuncu tüm nakdini tesise çevirirse ilk bakım gideri onu batırır. İştah ne
 * kadar yüksek olursa olsun, kurulum maliyetinin üstünde bir tampon şart.
 */
export interface InvestmentInput {
  readonly cash: Money;
  readonly cost: Money;
  readonly roll: number;
  /** Mevcut tesislerin son turlardaki net kârı. Negatifse yeni tesis açılmaz. */
  readonly recentProfit: Money;
  /** Rafı dolu tesis oranı 0..1. Düşükse sorun tesis sayısı değil tedariktir. */
  readonly stockedRatio: number;
  /** Sahip olunan tesis sayısı. */
  readonly owned: number;
}

/**
 * Yatırım kararı.
 *
 * ★ Nakit tamponu tek başına yetmez. İlk simülasyon koşusunda oyuncular
 * satamadıkları halde dükkân açmaya devam etti: 87 perakende noktası kuruldu,
 * ciro bakımı karşılamadı ve herkes zarar etti. Gerçek bir oyuncu boş rafın
 * üstüne ikinci dükkân açmaz.
 *
 * Üç kapı: nakit tamponu · mevcut tesisler zarar etmiyor · raflar dolu.
 */
export function canInvest(profile: PlayerProfile, input: InvestmentInput): boolean {
  if (profile.builds === 'NONE') return false;

  const buffer = (input.cost * 3n) / 2n; // maliyet + %50 işletme sermayesi
  if (input.cash < buffer) return false;

  // İlk tesis her zaman kurulabilir; sonrakiler kanıt ister.
  if (input.owned > 1) {
    if (input.recentProfit < 0n) return false;
    if (input.stockedRatio < 0.6) return false;
  }
  return input.roll < profile.investmentAppetite;
}
