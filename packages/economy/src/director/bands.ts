/**
 * Müdahale bantları ve direktif planlaması — madde 30, docs/07 §3–4.
 *
 * ED yalnızca 6 kaldıraca dokunabilir ve her direktif `expires_tick` ile
 * KENDİLİĞİNDEN sönümlenir. Kalıcı müdahale yoktur: sağlık düzelirse ekonomi
 * kendi haline döner.
 */

export type HealthBand = 'HEALTHY' | 'WATCH' | 'ADJUST' | 'STIMULATE' | 'EMERGENCY';

export type DirectiveLever =
  | 'INVENTORY_TARGET' | 'PRODUCTION_BIAS' | 'BUY_BIAS'
  | 'INVESTMENT_BIAS' | 'CAPACITY_CAP' | 'IMPORT_QUOTA';

export interface PlannedDirective {
  readonly lever: DirectiveLever;
  /** -1..+1. NPC tarafında kaldıraca özgü sınırla çarpılır. */
  readonly magnitude: number;
  readonly reason: string;
}

/** Bant eşikleri (docs/07 §4). Skor 0–100. */
export const BAND_THRESHOLDS = {
  healthy: 75,
  watch: 55,
  adjust: 35,
  stimulate: 20,
} as const;

export function classifyBand(score: number): HealthBand {
  if (score > BAND_THRESHOLDS.healthy) return 'HEALTHY';
  if (score > BAND_THRESHOLDS.watch) return 'WATCH';
  if (score > BAND_THRESHOLDS.adjust) return 'ADJUST';
  if (score > BAND_THRESHOLDS.stimulate) return 'STIMULATE';
  return 'EMERGENCY';
}

export interface HysteresisState {
  readonly band: HealthBand;
  readonly streakBand: HealthBand | null;
  readonly streakCount: number;
}

/**
 * Histerezis — docs/07 §4.
 *
 * Bant değişimi için skorun yeni bandı **üst üste N tur** göstermesi gerekir.
 * Aksi halde ED bant sınırında salınır ve NPC'ler her tur strateji değiştirir;
 * bu, düzeltmek istediği oynaklığı ED'nin kendisinin üretmesi demektir.
 *
 * ★ Tek istisna EMERGENCY'ye DÜŞÜŞTÜR: kriz beklemez. Yukarı çıkarken
 * (iyileşme) histerezis yine uygulanır — erken rahatlama krizi geri getirir.
 */
export function advanceHysteresis(
  previous: HysteresisState | null,
  observed: HealthBand,
  requiredStreak = 6,
): HysteresisState {
  const current = previous?.band ?? observed;
  if (observed === current) {
    return { band: current, streakBand: null, streakCount: 0 };
  }
  if (observed === 'EMERGENCY') {
    return { band: 'EMERGENCY', streakBand: null, streakCount: 0 };
  }
  const count = previous?.streakBand === observed ? previous.streakCount + 1 : 1;
  if (count >= requiredStreak) {
    return { band: observed, streakBand: null, streakCount: 0 };
  }
  return { band: current, streakBand: observed, streakCount: count };
}

/**
 * Banda göre direktif seti (docs/07 §4).
 *
 * Büyüklükler kaldıracın KENDİ sınırıyla çarpılacak oranlardır, yüzde değil:
 * `INVENTORY_TARGET` sınırı ±%40 olduğu için 0,25 büyüklük ±%10 demektir.
 *
 * ★ YÖN, arz/talep oranından gelir. Spec'in bant tablosu (madde 30) düşük
 * sağlığın her zaman KITLIK demek olduğunu varsayar ve hep teşvik verir. Oysa
 * `f_supply` çift yönlüdür: 1,0'da tepe yapar, hem kıtlık hem BOLLUK skoru
 * düşürür. Yön ayrımı yapılmazsa ED bolluk gördüğünde üretimi daha da artırır
 * ve düzeltmek istediği sorunu kendisi büyütür.
 *
 * Ölçülen örnek (F7 ilk koşusu): buğday arzı 4.108, ara talep 2.128 → oran
 * 1,93 → f_supply 0 → ADJUST → PRODUCTION_BIAS +%15 → daha çok buğday.
 *
 * Bolluk yönünde:
 *   • üretim ve alım kaldıraçları TERSİNE çevrilir (kısma),
 *   • stok hedefi de düşürülür (depoyu şişirmek çözüm değil),
 *   • ithalat kapısı AÇILMAZ — zaten fazla mal var.
 *
 * @param supplyRatio arz ÷ talep. 1'in üstü bolluk, altı kıtlık.
 * @param importable ürün ithal edilebiliyor mu (`world_market.importable`).
 *   Nihai perakende ürünleri (ekmek, domates, sigara) ithal edilemez; onlarda
 *   `IMPORT_QUOTA` yayınlamak boş bir kaldıraçtır ve oyuncuya "ithalat kapısı
 *   açıldı" denip hiçbir mal gelmemesi yanıltıcı olur. Bu ürünlerde tek
 *   kalan yol `SYS_RESERVE`'dür (docs/07 §4.1).
 */
export function directivesForBand(
  band: HealthBand, supplyRatio = 0, importable = true,
): PlannedDirective[] {
  const glut = supplyRatio > 1;
  const dir = glut ? -1 : 1;
  const yon = glut ? 'fazla arz' : 'kıtlık';

  switch (band) {
    case 'HEALTHY':
      // Müdahale yok. Geçerli direktifler süresi dolunca kendiliğinden söner.
      return [];

    case 'WATCH':
      return [
        { lever: 'INVENTORY_TARGET', magnitude: 0.25 * dir, reason: `izleme (${yon}): stok tamponu` },
      ];

    case 'ADJUST':
      return [
        { lever: 'INVENTORY_TARGET', magnitude: 0.625 * dir, reason: `düzeltme (${yon}): stok tamponu` },
        { lever: 'PRODUCTION_BIAS', magnitude: 0.5 * dir, reason: `düzeltme (${yon}): üretim` },
        { lever: 'BUY_BIAS', magnitude: 0.571 * dir, reason: `düzeltme (${yon}): alım` },
      ];

    case 'STIMULATE': {
      const set: PlannedDirective[] = [
        { lever: 'INVENTORY_TARGET', magnitude: 0.625 * dir, reason: `canlandırma (${yon}): stok tamponu` },
        { lever: 'PRODUCTION_BIAS', magnitude: 0.5 * dir, reason: `canlandırma (${yon}): üretim` },
        { lever: 'BUY_BIAS', magnitude: 0.571 * dir, reason: `canlandırma (${yon}): alım` },
      ];
      // Yatırım ve ithalat yalnız KITLIKTA anlamlıdır.
      if (!glut) {
        set.push({ lever: 'INVESTMENT_BIAS', magnitude: 0.8, reason: 'canlandırma: yatırım eşiği düşürülüyor' });
        if (importable) {
          set.push({ lever: 'IMPORT_QUOTA', magnitude: 0.5, reason: 'canlandırma: ithalat derinliği artırılıyor' });
        }
      }
      return set;
    }

    case 'EMERGENCY': {
      if (glut) {
        // Bolluk krizinde acil çözüm ÜRETİMİ KISMAKtır; ithalat felaket olurdu.
        return [
          { lever: 'PRODUCTION_BIAS', magnitude: -1, reason: 'acil (fazla arz): üretim kısılıyor' },
          { lever: 'INVENTORY_TARGET', magnitude: -0.625, reason: 'acil (fazla arz): stok hedefi düşürülüyor' },
          { lever: 'INVESTMENT_BIAS', magnitude: -1, reason: 'acil (fazla arz): yatırım durduruluyor' },
        ];
      }
      // ★ Sıra önemlidir: önce İTHALAT kapısı. Rezerv son çaredir ve ayrı bir
      // koşula bağlıdır (docs/07 §4.1) — burada yayınlanmaz.
      const acil: PlannedDirective[] = [
        { lever: 'INVENTORY_TARGET', magnitude: 0.625, reason: 'acil: stok tamponu' },
        { lever: 'PRODUCTION_BIAS', magnitude: 0.75, reason: 'acil: üretim teşviki' },
        { lever: 'BUY_BIAS', magnitude: 0.571, reason: 'acil: alım desteği' },
        { lever: 'INVESTMENT_BIAS', magnitude: 1, reason: 'acil: yatırım eşiği düşürülüyor' },
      ];
      return importable
        ? [{ lever: 'IMPORT_QUOTA', magnitude: 1, reason: 'acil: ithalat kapısı açıldı' }, ...acil]
        : acil;
    }
  }
}

/** Kaldıraç sınırları (docs/07 §3). Direktif büyüklüğü bunlarla çarpılır. */
export const LEVER_LIMITS: Record<DirectiveLever, number> = {
  INVENTORY_TARGET: 0.40,
  PRODUCTION_BIAS: 0.30,
  BUY_BIAS: 0.35,
  INVESTMENT_BIAS: 0.50,
  CAPACITY_CAP: 1.00,
  IMPORT_QUOTA: 1.00,
};

/**
 * Direktifin NPC parametresine uygulanmış hali.
 *
 * `magnitude` −1..+1 aralığındadır ve kaldıracın sınırıyla çarpılır; sonuç
 * bir ÇARPANDIR. Örnek: INVENTORY_TARGET, magnitude 0,625 → 1 + 0,625×0,40 = 1,25,
 * yani hedef stok %25 artar.
 */
export function leverMultiplier(lever: DirectiveLever, magnitude: number): number {
  const bounded = Math.max(-1, Math.min(1, magnitude));
  return 1 + bounded * LEVER_LIMITS[lever];
}

/**
 * Alım desteği tabanı — madde 33.
 *
 * ED, NPC'yi "her fiyattan almaya" zorlayamaz. `BUY_BIAS` yalnızca eğilimi
 * artırır; teklif fiyatı bu tabanın üstüne ED tarafından çıkarılamaz.
 * Oyuncu kötü yatırım yaptıysa zarar eder — bu bilinçlidir.
 */
export function softFloor(emaReference: bigint, multiplier = 0.55): bigint {
  return (emaReference * BigInt(Math.round(multiplier * 1000))) / 1000n;
}
