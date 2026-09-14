import { asQty, divRoundHalfEven, priceTimesQty, type Money, type Qty } from '@kapital/shared';

export interface BookOrder {
  readonly orderId: bigint;
  readonly companyId: string;
  readonly facilityId: string | null;
  readonly cityId: number;
  readonly remaining: Qty;
  readonly pricePerUnit: Money;
  readonly minQuality: number;
  readonly quality: number;
  readonly maxDeliveryDistance: number | null;
  readonly createdAt: number;
}

export interface MatchCandidate {
  readonly sell: BookOrder;
  /** Alıcının şehrine birim başına nakliye. */
  readonly shippingPerUnit: Money;
  readonly distanceIndex: number;
  readonly transitTicks: number;
}

export interface Match {
  readonly buy: BookOrder;
  readonly sell: BookOrder;
  readonly quantity: Qty;
  /** Malın fiyatı — satıcının aldığı. Nakliye buna DAHİL DEĞİLDİR. */
  readonly pricePerUnit: Money;
  readonly shippingPerUnit: Money;
  readonly shippingTotal: Money;
  readonly goodsTotal: Money;
  /** Alıcının ödediği toplam: mal + nakliye. */
  readonly buyerTotal: Money;
  readonly transitTicks: number;
  readonly distanceIndex: number;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Bir alış emri için uygun satış emirlerini bulur ve doldurur — madde 16 + C2.
 *
 * Eşleşme kuralı: `satış_fiyatı + nakliye ≤ alış_fiyatı`.
 * Yani alıcının verdiği fiyat **nakliye dahil tavan fiyattır**; uzak satıcı
 * kendiliğinden elenir. Bu, "toplam gerçek maliyet" ilkesinin (madde 16)
 * eşleştirme motorundaki karşılığıdır.
 *
 * Sıralama: alıcı için en ucuz TOPLAM maliyet önce. Aynı toplamda daha eski
 * emir önce (zaman önceliği).
 */
export function matchBuyOrder(
  buy: BookOrder,
  candidates: readonly MatchCandidate[],
): { matches: Match[]; filled: Qty } {
  const eligible = candidates
    .filter((c) => {
      if (c.sell.companyId === buy.companyId) return false;          // kendine satış yok
      if (c.sell.remaining <= 0n) return false;
      if (c.sell.quality < buy.minQuality) return false;
      if (buy.maxDeliveryDistance !== null && c.distanceIndex > buy.maxDeliveryDistance) return false;
      return c.sell.pricePerUnit + c.shippingPerUnit <= buy.pricePerUnit; // ★ nakliye dahil tavan
    })
    .sort((a, b) => {
      const totalA = a.sell.pricePerUnit + a.shippingPerUnit;
      const totalB = b.sell.pricePerUnit + b.shippingPerUnit;
      if (totalA !== totalB) return totalA < totalB ? -1 : 1;
      return a.sell.createdAt - b.sell.createdAt;
    });

  const matches: Match[] = [];
  let remaining = buy.remaining as bigint;

  for (const candidate of eligible) {
    if (remaining <= 0n) break;
    const quantity = min(remaining, candidate.sell.remaining as bigint);
    if (quantity <= 0n) continue;

    /*
     * ★ BİLİNEN SIZINTI — ÖLÇÜLDÜ, HENÜZ KAPATILMADI (R88 bulgusu).
     *
     * Alıcının tavanı bir REZERVASYON fiyatıdır ve iki bileşeni de piyasa
     * dışıdır: `referans × (1 + %2) + navlun_payı`. Navlun payı şehrin MEDYAN
     * mesafesine göre sabit hesaplanır; satıcı aynı şehirdeyse gerçek nakliye
     * SIFIRDIR ve o payın tamamı fazlalık kalır. Orta nokta kuralı yarısını
     * satıcıya verir ve `price_history` üzerinden ENDEKSE yazar — endeks de
     * bir sonraki turun referansıdır.
     *
     * Denge: referans = [(1−w)·maliyet·(1+marj)·s + F] / (1 − w − b)
     * Payda ~0,43 olduğu için navlun payı fiyata ~2,3 KATI yansıyor.
     * ÖLÇÜLDÜ (tohum 20260904): WHEAT %24,2 · COAL %20,8 · TOMATO %19,3 ·
     * FLOUR %8,5 · CIGARETTE %0,7 — en çok ağır ve ucuz malları vuruyor.
     *
     * NEDEN KAPATILMADI — ÖLÇÜLDÜ, BEDELİ OYUNCU İLERLEMESİ:
     *
     * İki kapatma yolu denendi, ikisi de beş tohumda ölçüldü.
     *
     * (a) `price = candidate.sell.pricePerUnit` — sızıntıyı tamamen kapatır
     *     ama fazlalık PAYLAŞIMINI da kaldırır. Taban fiyatlar sızıntı varken
     *     kalibre edildiği için fiyat seviyesi 1,08'den 0,79'a düştü; reçete
     *     maliyetlerini sızıntısız dengeye (1,255) kalibre etmek gerekti.
     *     Sonuç: kur çıpası mükemmel (medyan %-2,9) ama kararsız ölçüt sayısı
     *     sıfırdan YEDİYE çıktı, bir dünyada 1. hafta büyümesi 1,29×'e indi.
     *
     * (b) Mal tavanından `max(nakliye, navlun_payı)` düşmek — CERRAHİ. Navlun
     *     emirde ayrı saklanır (yeni sütun), uygunluk kuralı değişmez.
     *     Kalibrasyon gerekmedi: fiyat seviyesi 1,040'a kendiliğinden oturdu.
     *     Kapı GEÇTİ (13,14,14,12,14) ve kur beş dünyada da düzeldi
     *     (medyan %11,6 → %6,8). Kalan bedel: orta nokta kuralındaki navlun
     *     payı satıcıya gidiyordu ve OYUNCULAR DA SATICI — 1. hafta büyümesi
     *     medyanı 1,81×'ten 1,74×'e, bir dünyada 1,79×'ten 1,48×'e (eşik 1,5×)
     *     düştü.
     *
     * (b) çalışan ve ölçülmüş bir düzeltmedir; bekletilme sebebi teknik değil:
     *     oyuncunun kaybettiği gelirin BİLEREK geri verilmesi gerekiyor
     *     (perakende marjı ya da tesis gideri gibi açık bir kanaldan). Gizli
     *     bir endeks sızıntısıyla telafi etmek yerine ayarlanabilir bir yerden
     *     vermek doğru olur. O karar verilmeden kapatılmadı.
     */
    const buyerGoodsCeiling = (buy.pricePerUnit as bigint) - (candidate.shippingPerUnit as bigint);
    const price = divRoundHalfEven((candidate.sell.pricePerUnit as bigint) + buyerGoodsCeiling, 2n);

    const goodsTotal = priceTimesQty(price as Money, asQty(quantity)).value;
    const shippingTotal = priceTimesQty(candidate.shippingPerUnit, asQty(quantity)).value;

    matches.push({
      buy,
      sell: candidate.sell,
      quantity: asQty(quantity),
      pricePerUnit: price as Money,
      shippingPerUnit: candidate.shippingPerUnit,
      shippingTotal,
      goodsTotal,
      buyerTotal: (goodsTotal + shippingTotal) as Money,
      transitTicks: candidate.transitTicks,
      distanceIndex: candidate.distanceIndex,
    });
    remaining -= quantity;
  }

  return { matches, filled: asQty((buy.remaining as bigint) - remaining) };
}

/** Emir defteri özeti — UI'da derinlik göstermek için. */
export function bookDepth(orders: readonly BookOrder[]): {
  totalQuantity: Qty; bestPrice: Money | null; orderCount: number;
} {
  if (orders.length === 0) return { totalQuantity: asQty(0n), bestPrice: null, orderCount: 0 };
  const total = orders.reduce((sum, o) => sum + (o.remaining as bigint), 0n);
  const best = orders.reduce((b, o) => (b === null || o.pricePerUnit < b ? o.pricePerUnit : b), null as Money | null);
  return { totalQuantity: asQty(total), bestPrice: best, orderCount: orders.length };
}

/* ------------------------------------------------------------------ */

export interface RationInput {
  /** Bu turda satışa çıkan toplam miktar. */
  readonly totalSupply: Qty;
  /** Açık alış emirlerinin toplam miktarı. */
  readonly totalDemand: Qty;
  /** Farklı alıcı sayısı (şirket, emir değil). */
  readonly buyerCount: number;
  /**
   * En küçük anlamlı tahsis. Bunun altına düşen pay kimseye yaramaz: 50
   * alıcıya 2'şer birim dağıtmak, 10 alıcıya 10'ar birim vermekten kötüdür.
   */
  readonly minLot: Qty;
}

/**
 * KITLIKTA ADİL DAĞITIM — alıcı başına tur tavanı.
 *
 * ★ Eşleştirme motoru fiyat önceliğiyle çalışır: en yüksek teklif önce ve
 * DOYANA KADAR doldurulur. Gerçek bir borsada doğrudur, ama kıtlıkta oyunu
 * kırar. Ölçüldü (F8): domates arzı talebin dörtte biriyken 6 oyuncu arzın
 * %85'ini aldı, 54 oyuncu SIFIR aldı ve 2.103 emri mal bulamadan öldü.
 * Rafı hiç dolmayan oyuncu satamaz, satamayan büyüyemez, büyüyemeyen bir
 * daha asla o 6 oyuncuyla yarışamaz — kıtlık kendini besleyen bir kilit
 * hâline gelir.
 *
 * Kural: arz talebi karşılamıyorsa her alıcı bu turda en fazla "adil payını"
 * alır. Fiyat önceliği KALKMAZ — pay içinde yine en yüksek teklif önce
 * eşleşir ve ucuz teklif hiç eşleşmeyebilir. Değişen tek şey, tek bir
 * alıcının tüm arzı süpürememesi.
 *
 * Tavan dolduktan sonra artan arz varsa (kimi alıcı fiyat veya mesafe
 * yüzünden eşleşememişse) ikinci turda tavansız dağıtılır: adalet uğruna mal
 * çürütülmez.
 *
 * @returns Alıcı başına tur tavanı; kıtlık yoksa `null` (tayın uygulanmaz).
 */
export function scarcityRation(input: RationInput): Qty | null {
  if (input.buyerCount <= 1) return null;
  if (input.totalSupply <= 0n) return null;
  if (input.totalDemand <= input.totalSupply) return null; // kıtlık yok

  const share = (input.totalSupply as bigint) / BigInt(input.buyerCount);
  return (share > (input.minLot as bigint) ? share : input.minLot) as Qty;
}
