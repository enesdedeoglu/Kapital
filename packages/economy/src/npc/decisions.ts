import { asQty, mulMoney, qtyFromNumber, type Money, type Qty } from '@kapital/shared';

export interface PriceDecisionInput {
  /** NPC'nin bu üründeki ağırlıklı ortalama birim maliyeti. */
  readonly unitCost: Money;
  /** Piyasa referansı (EMA). */
  readonly reference: Money;
  /** NPC'nin şu anki fiyatı; ilk kez fiyatlıyorsa null. */
  readonly currentPrice: Money | null;
  readonly targetMargin: number;
  /** 0 = maliyet+marj · 1 = piyasayı takip et. */
  readonly priceAggressiveness: number;
  /** Ürünün market health skoru (0–100); bilinmiyorsa 100. */
  readonly marketHealth: number;
  readonly normalBand: number;
  readonly emergencyBand: number;
  readonly emergencyHealthBelow: number;
}

export interface PriceDecision {
  readonly price: Money;
  readonly desired: Money;
  readonly clamped: boolean;
  readonly emergency: boolean;
  readonly reason: string;
}

/**
 * NPC fiyat algoritması — madde 25 + R4 azaltımı.
 *
 *   hedef  = maliyet × (1 + marj)
 *   arzu   = hedef × (1 − agresiflik) + piyasa × agresiflik
 *   fiyat  = clamp(arzu, önceki × (1 − bant), önceki × (1 + bant))
 *
 * ★ ACİL BANT (R4): normal ±%3 bant krizde çok yavaştır — %50'lik bir hareket
 * için ~23 tur (6 saat) gerekir ve o sürede oyuncular NPC stoklarını ucuza
 * toplayıp geri satar (risksiz arbitraj). Market health düşük VE sapma
 * büyükse bant tek seferliğine genişler.
 */
export function decidePrice(input: PriceDecisionInput): PriceDecision {
  const target = mulMoney(input.unitCost, 1 + Math.max(0, input.targetMargin)).value;
  const weight = Math.max(0, Math.min(1, input.priceAggressiveness));

  const desiredRaw =
    Number(target) * (1 - weight) + Number(input.reference) * weight;
  const desired = BigInt(Math.max(1, Math.round(desiredRaw))) as Money;

  if (input.currentPrice === null || input.currentPrice <= 0n) {
    return { price: desired, desired, clamped: false, emergency: false, reason: 'ilk fiyatlama' };
  }

  const previous = input.currentPrice;
  const deviation = Math.abs(Number(desired) - Number(previous)) / Number(previous);
  const emergency = input.marketHealth < input.emergencyHealthBelow && deviation > 0.25;
  const band = emergency ? input.emergencyBand : input.normalBand;

  const upper = mulMoney(previous, 1 + band).value;
  const lower = mulMoney(previous, 1 - band).value;

  let price = desired;
  let clamped = false;
  if (desired > upper) { price = upper; clamped = true; }
  else if (desired < lower) { price = lower; clamped = true; }

  return {
    price, desired, clamped, emergency,
    reason: emergency
      ? `acil bant ±%${(band * 100).toFixed(0)} (health ${input.marketHealth.toFixed(0)})`
      : clamped ? `bant ±%${(band * 100).toFixed(0)}` : 'serbest',
  };
}

export interface InventoryPlanInput {
  readonly onHand: Qty;
  /** Tur başına tüketim/satış hızı. 0 ise plan yapılmaz. */
  readonly consumptionPerTick: number;
  readonly minTicks: number;
  readonly targetTicks: number;
  readonly maxTicks: number;
  /** Economic Director `BUY_BIAS` direktifi, −1..+1. */
  readonly buyBias?: number;
}

export interface InventoryPlan {
  readonly coverageTicks: number;
  readonly buyQuantity: Qty;
  readonly urgent: boolean;
  readonly reason: string;
}

/**
 * NPC stok yönetimi — madde 26.
 *
 *   minimum 4 tur · hedef 12 tur · maksimum 24 tur
 *
 * Minimumun altına düşerse agresif alım yapar; maksimumun üstündeyse alımı
 * keser. `buyBias` Economic Director'ın kaldıracıdır: hedefi büyütür veya
 * küçültür ama NPC'nin kendi mantığını ezmez (ADR-0004).
 */
export function planInventory(input: InventoryPlanInput): InventoryPlan {
  if (!(input.consumptionPerTick > 0)) {
    return { coverageTicks: Number.POSITIVE_INFINITY, buyQuantity: asQty(0n), urgent: false, reason: 'tüketim yok' };
  }

  const coverage = Number(input.onHand) / 1000 / input.consumptionPerTick;
  const bias = Math.max(-1, Math.min(1, input.buyBias ?? 0));
  const target = input.targetTicks * (1 + bias * 0.4);

  if (coverage >= input.maxTicks) {
    return { coverageTicks: coverage, buyQuantity: asQty(0n), urgent: false, reason: 'stok maksimumda' };
  }
  if (coverage >= target) {
    return { coverageTicks: coverage, buyQuantity: asQty(0n), urgent: false, reason: 'stok hedefte' };
  }

  const missing = (target - coverage) * input.consumptionPerTick;
  return {
    coverageTicks: coverage,
    buyQuantity: qtyFromNumber(missing),
    urgent: coverage < input.minTicks,
    reason: coverage < input.minTicks ? 'stok minimumun altında' : 'hedefe tamamlama',
  };
}

export interface InvestmentScoreInput {
  /** Son turların kâr marjı, 0..1'e normalize. */
  readonly profitMargin: number;
  /** Talep − arz açığı, 0..1'e normalize. */
  readonly demandGap: number;
  /** Fiyat eğilimi, 0..1'e normalize (yükseliş = yüksek). */
  readonly priceTrend: number;
  /** Kendi tedarik zincirindeki eksik halka, 0..1. */
  readonly strategicNeed: number;
  /** Rekabet yoğunluğu, 0..1 (yüksek = kötü). */
  readonly competition: number;
}

/**
 * NPC yatırım skoru — madde 27.
 *
 *   kâr marjı × 0,35 + talep açığı × 0,30 + fiyat eğilimi × 0,15
 * + stratejik ihtiyaç × 0,10 − rekabet × 0,10
 *
 * Eşik aşılırsa yeni tesis / kapasite yükseltme kararı verilir. Yatırım ANINDA
 * tamamlanmaz: inşaat süresi vardır (madde 27), dolayısıyla NPC'ler bir arz
 * açığına anında değil gecikmeli tepki verir — gerçekçi ve oyuncuya fırsat bırakır.
 */
/**
 * Tohum ekonomisinin TASARLANMIŞ marj bandı: referans fiyat, birim üretim
 * maliyetinin bu kat aralığında olur.
 *
 * ★ Tek kaynaktır: tohum testi fiyatları buna karşı doğrular, yatırım skoru
 * marj terimini bunun üzerine ölçekler. Ayrı yaşadıklarında sessizce
 * ayrışıyorlardı — skor 2,5 kata kadar ölçekleniyordu, yani ekonominin hiç
 * ulaşamayacağı bir aralığa. Sonuç: marj terimi her üründe 0,22–0,27'de
 * sıkıştı, hiçbir ürünü diğerinden ayırmadı ve skorun %35'i ölü ağırlık oldu
 * (R47).
 */
export const PRICE_MARKUP_BAND = { min: 1.15, max: 1.75 } as const;

/** Marj oranını (fiyat ÷ birim maliyet) 0..1 fırsat puanına çevirir. */
export function marginScore(markup: number): number {
  const { min, max } = PRICE_MARKUP_BAND;
  return Math.max(0, Math.min(1, (markup - min) / (max - min)));
}

export function investmentScore(input: InvestmentScoreInput): number {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return (
    clamp01(input.profitMargin) * 0.35 +
    clamp01(input.demandGap) * 0.30 +
    clamp01(input.priceTrend) * 0.15 +
    clamp01(input.strategicNeed) * 0.10 -
    clamp01(input.competition) * 0.10
  );
}

/**
 * NPC kapasite tavanı — madde 31.
 *
 * Oyuncu arzı arttıkça NPC kapasitesi otomatik geri çekilir. Geri çekilme
 * KADEMELİdir (tur başına en fazla %2): aksi halde oyuncular bir üründe
 * üretime başladığında NPC'ler aniden çekilir, arz çöker ve fiyat patlar.
 */
export function npcCapacityCap(
  playerSupplyShare: number, previousCap: number, maxStepPerTick = 0.02,
): number {
  const target = npcShareTarget(playerSupplyShare);
  const delta = target - previousCap;
  const step = Math.max(-maxStepPerTick, Math.min(maxStepPerTick, delta));
  return Math.max(0.10, Math.min(0.85, previousCap + step));
}

/** Hedeflenen NPC arz payı — kademelilik uygulanmamış ham değer (madde 31). */
export function npcShareTarget(playerSupplyShare: number): number {
  return Math.max(0.10, Math.min(0.85, 1 - playerSupplyShare * 1.15));
}

/* ------------------------------------------------------------------ */

export interface InputBidInput {
  /** Girdinin ulusal referans fiyatı (EMA). */
  readonly reference: Money;
  /** `planInventory` acil dedi mi — stok asgarinin altına düştü. */
  readonly urgent: boolean;
  /**
   * Alıcının şehri için birim başına TİPİK navlun. Alıcı bunu peşinen
   * bütçeler; hangi satıcıyla eşleşeceğini bilmediği için tek bir satıcının
   * gerçek mesafesini değil, şehrinin medyan mesafesini kullanır.
   */
  readonly freightAllowance: Money;
  /** Normal durumda referansın üstüne konan pay. */
  readonly normalPremium?: number;
  /** Stok kritikken konan pay. */
  readonly urgentPremium?: number;
}

/**
 * NPC'nin girdi alış teklifi — madde 16/17.
 *
 * ★ Eşleştirme motorunda alıcının fiyatı **nakliye dahil tavandır**
 * (`matching.ts`: `sell.pricePerUnit + shippingPerUnit <= buy.pricePerUnit`).
 * Navlum payı olmayan bir teklif bu yüzden yalnızca AYNI ŞEHİRDEKİ satıcıyla
 * eşleşebilir. Ucuz ve ağır mallarda (buğday 3,86 ₺/birim, Konya→Ankara navlun
 * 0,91 ₺/birim) bu, zincirin şehirler arasında tamamen kopması demektir:
 * tarlanın deposu dolar, değirmen girdisiz kalır.
 *
 * Pay bir TAVANDIR, ödenen fiyat değil: motor adayları `istek + navlun`
 * toplamına göre sıralar ve orta noktadan fiyatlar. Yani aynı şehirde ucuz
 * satıcı varsa yine o kazanır; pay sadece uzaktaki arzı erişilebilir kılar.
 */
export function inputBid(input: InputBidInput): Money {
  const premium = input.urgent
    ? (input.urgentPremium ?? 0.10)
    : (input.normalPremium ?? 0.02);
  return (mulMoney(input.reference, 1 + premium).value + input.freightAllowance) as Money;
}

/**
 * Bir şehrin navlun payı için kullanılan temsilî mesafe: diğer şehirlere olan
 * mesafelerin MEDYANI. Ortalama uzak aykırı değerlerden şişer, minimum ise en
 * yakın komşudan öteye erişimi kapatır; medyan ikisinin arasındadır.
 */
export function representativeDistance(distances: readonly number[]): number {
  const positive = distances.filter((d) => d > 0).sort((a, b) => a - b);
  if (positive.length === 0) return 0;
  const mid = positive.length >> 1;
  return positive.length % 2 === 1
    ? positive[mid]!
    : (positive[mid - 1]! + positive[mid]!) / 2;
}

export interface OutputThrottleInput {
  /** Satılmamış çıktı stoğu, tur başına üretim cinsinden: stok ÷ kapasite. */
  readonly coverageTicks: number;
  /** Bu kadar turluk tampon normaldir; üstü aşırı üretimdir. */
  readonly targetTicks: number;
  /** Tesisin mevcut `utilization` değeri. */
  readonly previous: number;
  /** Tur başına en fazla değişim — ani arz şoku olmasın diye. */
  readonly maxStep?: number;
  /** Alt sınır: tesis tamamen durmaz, yoksa fiyat sinyali de kaybolur. */
  readonly floor?: number;
}

/**
 * Üretim kısma — madde 31'in talep tarafı.
 *
 * `npcCapacityCap` NPC'yi OYUNCU arzı karşısında geri çeker; bu fonksiyon ise
 * kendi satılmamış stoğu karşısında geri çeker. İkisi farklı sorunlardır:
 * oyuncusuz bir dünyada da hammadde üreticileri aşağı halkanın işleyebileceğinden
 * fazlasını üretir.
 *
 * ★ Neden gerekli: kapasiteye üreten bir tesis, malı satılmasa bile her tur
 * işçilik öder. Depo dolana kadar bu para SYS_SINK'e akar ve ekonomiden çıkar.
 * 500 turluk oyuncusuz koşuda ölçülen sızıntı tur başına 1.996 ₺ idi; buğday
 * 4.197 üretilip 2.175'i öğütülüyordu.
 *
 * Kontrol basit bir orantısal geri beslemedir: hedef kullanım = hedef ÷ kapsam.
 * Stok hedefin iki katıysa üretim yarıya iner. Değişim kademelidir.
 */
export function outputThrottle(input: OutputThrottleInput): number {
  const floor = input.floor ?? 0.10;
  const maxStep = input.maxStep ?? 0.05;
  const target =
    input.coverageTicks <= input.targetTicks
      ? 1
      : Math.max(floor, Math.min(1, input.targetTicks / input.coverageTicks));
  const delta = target - input.previous;
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  return Math.max(floor, Math.min(1, input.previous + step));
}

/**
 * Raf fiyatına STOK BASKISI — satılmayan mal fiyatı aşağı çeker.
 *
 * ★ Üretimde bu geri besleme vardı (`outputThrottle`: satılmayan stok
 * birikince kapasiteyi kıs), fiyatta yoktu. Hem NPC hem oyuncu rafı,
 * referansın sabit `retailMarkup` katıyla fiyatlıyordu — dükkânın kendi
 * deposu taşarken bile. Üstelik çıpa rakiplerin ortalama raf fiyatı olduğu
 * için herkes pahalıysa herkes pahalı kalıyordu: kapalı bir döngü.
 *
 * Ölçülen (F8): domates arz/talep oranı 1,28–1,67 ile FAZLA üretilirken
 * talebin %38,6'sı tüketicinin bütçesi yetmediği için alınamıyordu. Fazla
 * mal, buna rağmen pahalı — fiyatın düşmesini sağlayan hiçbir kuvvet yoktu.
 *
 * İndirim KADEMELİdir ve maliyet tabanını delmez (çağıran taraf tabanı
 * ayrıca uygular): amaç zararına satmak değil, rafı döndürmektir.
 */
export interface ClearanceInput {
  /** Eldeki stok kaç turluk satışa yeter. */
  readonly coverageTicks: number;
  /** Normal kabul edilen kapsam — bunun altında indirim yok. */
  readonly targetTicks: number;
  /** En fazla indirim oranı (0,25 = %25). */
  readonly maxDiscount: number;
  /**
   * Ürünün PİYASA genelindeki arz/talep oranı. 1'in üstü fazla arz demektir.
   *
   * ★ Bu olmadan indirim yanlış şeyi cezalandırıyordu: kapsam dükkânın KENDİ
   * satış hızına bölünür, dolayısıyla yavaş satan küçük bir dükkânda az stok
   * bile "20 turluk kapsam" çıkarıp %25 indirim tetikliyordu. Ölçülen sonucu
   * (F8): domates fazlası eridi (1,67 → 1,13) ve satış %50 arttı ama oyuncu
   * serveti 58.081 → 39.679 ₺ geriledi — raflar %8,8 doluyken, yani ortada
   * eritilecek fazla yokken indirim uygulanıyordu.
   *
   * İndirim FAZLAYI eritmek içindir, küçük dükkânı cezalandırmak için değil.
   */
  readonly marketRatio?: number;
}

export function clearanceFactor(input: ClearanceInput): number {
  const { coverageTicks, targetTicks, maxDiscount, marketRatio } = input;
  if (!(targetTicks > 0) || !(maxDiscount > 0)) return 1;
  if (!(coverageTicks > targetTicks)) return 1;
  // Piyasa kıt ya da dengedeyse indirim yok: sorun fiyat değil, arz.
  if (marketRatio !== undefined && marketRatio <= 1.05) return 1;
  // Fazla kapsam hedefin KATI olarak ölçülür: hedefin iki katında doyar.
  const excess = Math.min(1, (coverageTicks - targetTicks) / targetTicks);
  return 1 - maxDiscount * excess;
}
