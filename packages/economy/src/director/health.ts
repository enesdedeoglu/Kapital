/**
 * Market Health Score — madde 29.
 *
 * Bir ürünün piyasasının ne kadar "canlı" olduğunu 0–100 arasında ölçer.
 * Ekonomi Direktörü yalnızca bu skora bakarak karar verir; fiyata, tek bir
 * şirkete veya oyuncu kimliğine bakmaz (ADR-0004).
 *
 * Saf fonksiyondur: çağıran ölçümleri toplar.
 */

export interface HealthInput {
  /** Son 24 turda piyasaya çıkan arz (birim). */
  readonly supply: number;
  /** Son 24 turda talep edilen miktar (birim). */
  readonly demand: number;
  /** Farklı satıcı sayısı. */
  readonly sellerCount: number;
  /** Farklı alıcı sayısı. */
  readonly buyerCount: number;
  /** Zincirdeki toplam stok, kaç turluk tüketime yeter. */
  readonly inventoryDepthTicks: number;
  /** Son 24 turda fiyat oynaklığı (standart sapma / ortalama). */
  readonly priceVolatility: number;
  /**
   * Penceredeki işlem sayısı.
   *
   * ★ Oynaklık tek başına yanıltıcıdır: hiç işlem görmeyen ÖLÜ bir piyasada
   * oynaklık sıfırdır ve istikrar puanı tam çıkar. Oysa fiyat sinyali olmayan
   * piyasa istikrarlı değil, YOKtur. İşlem yoksa istikrar sıfırlanır.
   */
  readonly tradeCount: number;
  /** Arzın oyunculardan gelen payı, 0..1. */
  readonly playerShare: number;
  /** Bu ürün için hedeflenen oyuncu payı — ürün başına ayarlanır. */
  readonly targetPlayerShare: number;
  /** Sağlıklı sayılan satıcı sayısı. */
  readonly targetSellers: number;
  /** Sağlıklı sayılan alıcı sayısı. */
  readonly targetBuyers: number;
}

export interface HealthComponents {
  readonly supply: number;
  readonly sellers: number;
  readonly buyers: number;
  readonly depth: number;
  readonly stability: number;
  readonly playerShare: number;
}

export interface HealthResult {
  readonly score: number;
  readonly components: HealthComponents;
}

/** Ağırlıklar `game_configs` üzerinden değiştirilebilir (docs/07 §7). */
export interface HealthWeights {
  readonly supply: number;
  readonly sellers: number;
  readonly buyers: number;
  readonly depth: number;
  readonly stability: number;
  readonly playerShare: number;
}

export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  supply: 0.30, sellers: 0.15, buyers: 0.10,
  depth: 0.15, stability: 0.15, playerShare: 0.15,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function marketHealthScore(
  input: HealthInput,
  weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
): HealthResult {
  // f_supply, arz/talep oranı 1,0'da TEPE yapar: hem kıtlık hem aşırı arz
  // sağlıksızdır. ±%50 sapmada sıfırlanır.
  const ratio = input.demand > 0 ? input.supply / input.demand : (input.supply > 0 ? 2 : 0);
  const supply = clamp01(1 - Math.min(1, Math.abs(ratio - 1) / 0.5));

  const sellers = input.targetSellers > 0
    ? clamp01(input.sellerCount / input.targetSellers) : 1;
  const buyers = input.targetBuyers > 0
    ? clamp01(input.buyerCount / input.targetBuyers) : 1;
  const depth = clamp01(input.inventoryDepthTicks / 12);
  const stability = input.tradeCount > 0
    ? clamp01(1 - Math.min(1, input.priceVolatility / 0.35))
    : 0;

  // Oyuncu payı hedefe ULAŞTIĞINDA tamdır; hedefi aşmak ceza değildir —
  // amaç zaten oyuncuların ekonomiyi devralması (madde 31).
  const playerShare = input.targetPlayerShare > 0
    ? clamp01(input.playerShare / input.targetPlayerShare) : 1;

  const components: HealthComponents = { supply, sellers, buyers, depth, stability, playerShare };
  const total =
    weights.supply * supply +
    weights.sellers * sellers +
    weights.buyers * buyers +
    weights.depth * depth +
    weights.stability * stability +
    weights.playerShare * playerShare;
  const sum = weights.supply + weights.sellers + weights.buyers +
    weights.depth + weights.stability + weights.playerShare;

  // Ağırlıklar admin panelden değiştirilebildiği için toplamları 1 olmayabilir;
  // normalize edilmezse skor 100'ü aşar ve bant sınırları anlamsızlaşır.
  const score = sum > 0 ? (100 * total) / sum : 0;
  return { score: Math.max(0, Math.min(100, score)), components };
}
