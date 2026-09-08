/**
 * Üretim zinciri kapasite hesabı.
 *
 * ★ Tüketici talebi (`products.base_demand`) ile tesis kapasiteleri
 * (`facility_types.base_capacity` × adet) BİRBİRİNE BAKMADAN yazılmıştı.
 * Ölçüldü (F8): ekmek talebi 826 birim/tur, fırın kapasitesi 120 — 6,9 kat
 * eksik. Değirmen 8,0 kat, buğday tarlası 6,4 kat eksikti. Sonuç: perakende
 * ürünlerinin arz/talep oranı 0,10–0,43 arasında sıkışıp kalıyor ve denge
 * kapısının `supply_demand` eşiği hiç geçmiyordu.
 *
 * Bu modül talebi zincirde GERİYE doğru yayar: 826 ekmek 207 un ister, 207 un
 * 276 buğday ister. Böylece dünyanın her aşaması talebe göre boyutlanabilir ve
 * iki sayı bir daha ayrı düşmez.
 *
 * Saf fonksiyon.
 */

export interface ChainRecipe {
  readonly outputCode: string;
  /** Bir çevrimde üretilen çıktı adedi. */
  readonly outputQuantity: number;
  readonly inputs: readonly { readonly code: string; readonly quantity: number }[];
}

export interface ChainRequirement {
  readonly productCode: string;
  /** Tur başına gereken üretim (birim). */
  /**
   * Gereken miktar — ZAMAN TABANI GİRDİYLE AYNIDIR. Hesap saf orandır
   * (çevrim = miktar / çıktı), hiçbir yerde tura bölünmez: tur başı talep
   * verilirsen tur başı, 96 turluk pencere toplamı verirsen pencere toplamı
   * döner. Yönetmen arzı da pencere toplamı olarak ölçtüğü için oran tutar.
   */
  readonly units: number;
  /** Zincirdeki derinlik — 0 nihai tüketim ürünü. */
  readonly depth: number;
}

/**
 * Nihai tüketim talebinden zincirin her aşamasının gereksinimini türetir.
 *
 * Bir ürün birden çok yerde girdi olabilir (kömür hem çeliğe hem başka bir
 * şeye gidebilir); gereksinimler TOPLANIR.
 *
 * Döngüsel graf `validateProductGraph` ile ayrıca engellenir (I8); yine de
 * burada derinlik sınırı vardır: bozuk veri sonsuz döngüye girmemeli.
 */
export function chainRequirements(
  finalDemandPerTick: ReadonlyMap<string, number>,
  recipes: readonly ChainRecipe[],
  maxDepth = 12,
): ChainRequirement[] {
  const byOutput = new Map(recipes.map((r) => [r.outputCode, r]));
  const required = new Map<string, number>();
  const depth = new Map<string, number>();

  const queue: { code: string; amount: number; level: number }[] = [];
  for (const [code, amount] of finalDemandPerTick) {
    if (amount > 0) queue.push({ code, amount, level: 0 });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.level > maxDepth) continue;

    required.set(item.code, (required.get(item.code) ?? 0) + item.amount);
    depth.set(item.code, Math.max(depth.get(item.code) ?? 0, item.level));

    const recipe = byOutput.get(item.code);
    if (!recipe || recipe.outputQuantity <= 0) continue;

    // Bu kadar çıktı için kaç çevrim gerekir, o çevrimler kaç girdi ister.
    const cycles = item.amount / recipe.outputQuantity;
    for (const input of recipe.inputs) {
      queue.push({ code: input.code, amount: cycles * input.quantity, level: item.level + 1 });
    }
  }

  return [...required.entries()]
    .map(([productCode, units]) => ({
      productCode, units, depth: depth.get(productCode) ?? 0,
    }))
    .sort((a, b) => a.depth - b.depth || b.units - a.units);
}

export interface CapacityGap {
  readonly productCode: string;
  readonly requiredPerTick: number;
  readonly availablePerTick: number;
  /** gereken ÷ mevcut. 1'in üstü eksiklik. */
  readonly shortfall: number;
}

/**
 * Dünyanın ne kadarını NPC'lerin karşılaması beklenir; kalanı oyunculara
 * kalır (madde 31). NPC dünyası %100 karşılarsa oyuncuya yatırım yapacak yer
 * kalmaz.
 *
 * ★ TEK KAYNAK. Bu kural önce yalnız dünya KURULUMUNDA uygulanıyordu; çalışma
 * anındaki NPC yatırım yolunda hiç yoktu ve NPC'ler açığın %100'ünü
 * kovalıyordu. Kurulum niyeti yedi gün içinde eziliyordu.
 *
 * Görünmemesinin sebebi bir KAZAydı: NPC'ler açık kovalamakta zaten
 * beceriksizdi (yatırım skoru eşiği hiç geçmiyordu, R61). Skor düzeltilip
 * NPC'ler etkili olunca kaza bitti ve NPC üretim payı %78,6'dan %98,6'ya
 * fırladı — oyunculara üretimin %1,4'ü kaldı.
 *
 * ★ Ürün başına `products.npc_target_market_share` sütunu BİLEREK
 * kullanılmıyor: adı "npc" diyor ama `health.ts` onu OYUNCU hedef payı olarak
 * okuyor (varsayılan 0,5). Anlamı bulanık bir sayıyı üçüncü bir soruya cevap
 * yapmak, bu fazın tekrar eden hatasıydı (R54/R59/R60/R61). Önce o sütunun
 * anlamı netleşmeli.
 */
export const NPC_CAPACITY_SHARE = 0.7;

/**
 * Gereksinimi mevcut kapasiteyle karşılaştırır.
 *
 * `npcShare`: bkz. `NPC_CAPACITY_SHARE`.
 */
export function capacityGaps(
  requirements: readonly ChainRequirement[],
  availablePerTick: ReadonlyMap<string, number>,
  npcShare = NPC_CAPACITY_SHARE,
): CapacityGap[] {
  return requirements.map((req) => {
    const target = req.units * npcShare;
    const available = availablePerTick.get(req.productCode) ?? 0;
    return {
      productCode: req.productCode,
      requiredPerTick: target,
      availablePerTick: available,
      shortfall: available > 0 ? target / available : (target > 0 ? Infinity : 1),
    };
  });
}
