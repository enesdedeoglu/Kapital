/**
 * Kalıcı emir kararları — oyuncu yokken şirket ne yapsın.
 *
 * ★ Bu bir OTOMASYON değil, DELEGE EDİLMİŞ KARARdır. Oyuncu hedefi ve fiyat
 * sınırını kendisi koyar; motor yalnız uygular. Gizli bir sübvansiyon yoktur:
 * nakit yetmezse alım olmaz, fiyat sınırı aşılırsa emir verilmez.
 *
 * Saf fonksiyon (ADR-0003).
 */
import type { Money, Qty } from '@kapital/shared';

export interface RestockDecision {
  /** Alınacak miktar; 0 ise bu turda işlem yok. */
  readonly quantity: Qty;
  /** Verilecek teklif — nakliye dahil tavan (R20). */
  readonly bidPrice: Money;
  readonly reason: string;
}

export interface RestockInput {
  readonly onHand: Qty;
  readonly targetQuantity: Qty;
  /** Depoda kalan yer — hedefe ulaşmak için yeterli olmayabilir. */
  readonly freeCapacity: Qty;
  readonly reference: Money;
  /** Şehir için birim başına tipik navlun (R20). */
  readonly freightAllowance: Money;
  /** Oyuncunun koyduğu tavan; yoksa referanstan türetilir. */
  readonly maxPrice?: Money | null;
  /** Harcanabilir nakit. */
  readonly budget: Money;
  /**
   * Hedefin bu oranının altına düşünce alım tetiklenir. Her turda azıcık
   * almak yerine anlamlı partiler hâlinde alınır: emir defteri şişmesin.
   */
  readonly triggerRatio?: number;
  /** Referansın üstüne konan pay — malı gerçekten isteyen alıcı öder. */
  readonly premium?: number;
}

export function standingRestock(input: RestockInput): RestockDecision | null {
  const trigger = input.triggerRatio ?? 0.5;
  const premium = input.premium ?? 0.06;

  const threshold = (input.targetQuantity * BigInt(Math.round(trigger * 1000))) / 1000n;
  if (input.onHand >= threshold) return null;

  let want = (input.targetQuantity as bigint) - (input.onHand as bigint);
  if (want > (input.freeCapacity as bigint)) want = input.freeCapacity as bigint;
  if (want <= 0n) return null;

  // Teklif: referans + pay + navlun. Oyuncunun tavanı varsa onunla sınırlanır.
  const derived = (input.reference * BigInt(Math.round((1 + premium) * 1000))) / 1000n
    + (input.freightAllowance as bigint);
  const bid = input.maxPrice != null && input.maxPrice < derived ? input.maxPrice : derived;
  if (bid <= 0n) return null;

  // ★ Nakit sınırı: kalıcı emir oyuncuyu batıramaz. Bütçe yetmiyorsa miktar
  //   kısılır, emir tamamen iptal edilmez — az mal, hiç maldan iyidir.
  const affordable = ((input.budget as bigint) * 1000n) / bid;
  if (affordable <= 0n) return null;
  if (want > affordable) want = affordable;
  if (want <= 0n) return null;

  return {
    quantity: want as Qty,
    bidPrice: bid as Money,
    reason: input.maxPrice != null && input.maxPrice < derived
      ? 'kalıcı emir — oyuncunun tavanı'
      : 'kalıcı emir — referans + navlun',
  };
}

export interface SurplusDecision {
  readonly quantity: Qty;
  readonly askPrice: Money;
  readonly reason: string;
}

export interface SurplusInput {
  readonly onHand: Qty;
  readonly targetQuantity: Qty;
  readonly unitCost: Money;
  readonly reference: Money;
  /** Oyuncunun koyduğu taban; yoksa maliyet+marj kullanılır. */
  readonly minPrice?: Money | null;
  readonly margin?: number;
}

/**
 * Hedefin üstündeki fazlayı satar.
 *
 * ★ Taban maliyettir: kalıcı emir oyuncuyu zarara satmaya zorlayamaz. Oyuncu
 * daha yüksek bir taban koyduysa o geçerlidir ve mal satılmadan bekleyebilir —
 * bu onun kararıdır.
 */
export function standingSurplus(input: SurplusInput): SurplusDecision | null {
  const surplus = (input.onHand as bigint) - (input.targetQuantity as bigint);
  if (surplus <= 0n) return null;

  const margin = input.margin ?? 0.15;
  const costBased = (input.unitCost * BigInt(Math.round((1 + margin) * 1000))) / 1000n;
  const marketBased = input.reference as bigint;
  let ask = costBased > marketBased ? costBased : marketBased;
  if (input.minPrice != null && input.minPrice > ask) ask = input.minPrice;

  return {
    quantity: surplus as Qty,
    askPrice: ask as Money,
    reason: input.minPrice != null && input.minPrice >= ask
      ? 'kalıcı emir — oyuncunun tabanı'
      : 'kalıcı emir — maliyet + marj',
  };
}
