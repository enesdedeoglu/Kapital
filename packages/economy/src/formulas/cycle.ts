import { TICKS_PER_DAY, TICKS_PER_YEAR, type Season } from '@kapital/shared';

/**
 * İş çevrimi — madde 19'da formülde vardı ama kaynağı tanımsızdı (docs/11 C5).
 * Sinüzoidal, periyot 1 oyun yılı (2688 tur), genlik config'ten.
 *
 * Deterministiktir: aynı tur her zaman aynı değeri verir. Oyuncular çevrimi
 * öğrenip ona göre yatırım yapabilir — bu kasıtlıdır.
 */
export function economicCycle(tickSeq: bigint, amplitude: number): number {
  const phase = Number(tickSeq % BigInt(TICKS_PER_YEAR)) / TICKS_PER_YEAR;
  return 1 + amplitude * Math.sin(2 * Math.PI * phase);
}

/**
 * Mevsim çarpanı. Ürün bazlı tablo config'ten gelir; tanımsız ürün için 1,0.
 * Tarım ürünlerinde hasat mevsimi arzı artırır, kış talebi kaydırır.
 */
export function seasonMultiplier(
  season: Season,
  table: Readonly<Record<string, readonly number[]>> | undefined,
  productCode: string,
): number {
  const row = table?.[productCode];
  if (!row || row.length !== 4) return 1;
  return row[season] ?? 1;
}

/** Talep gürültüsü — madde 19: küçük olmalı, stratejiyi bozmamalı. */
export function demandNoise(rng: () => number, min = 0.97, max = 1.03): number {
  return min + rng() * (max - min);
}

/**
 * GÜNLÜK talep ritmi — piyasanın günden güne kıpırdamasını sağlar.
 *
 * ★ Ölçülen boşluk (R72): ekonomide YAVAŞ değişim (iş çevrimi, periyot 1 yıl)
 * ve HIZLI değişim (`demandNoise`, tur başına bağımsız ±%3) vardı, ama GÜNLÜK
 * ölçekte hiçbir şey yoktu. Tur başına bağımsız gürültü 96 turluk bir günde
 * ortalaması alınınca ±%0,3'e iner — günlük ölçekte görünmez.
 *
 * Sonuç ölçümle sabit: beş dünyada tüm hafta fiyat aralığı %10,5–20,5 iken
 * GÜNLÜK aralık %0,4–3,0. Oyuncu her gün girip aynı fiyatları görüyordu ve
 * piyasaya bakmanın bir sebebi kalmıyordu.
 *
 * Periyot 1 gün, faz ÜRÜNE göre kaydırılır: hepsi aynı anda zirve yapmaz,
 * yani günün her saatinde hareket eden bir şey olur.
 *
 * Deterministiktir ve ÖĞRENİLEBİLİRdir — iş çevrimi gibi, bu kasıtlıdır:
 * ritmi çözen oyuncu ucuza alıp pahalıya satar. Oyunun ödüllendirmesi
 * gereken şey tam olarak budur.
 */
export function dailyRhythm(
  tickSeq: bigint, productId: number, amplitude: number,
): number {
  if (!(amplitude > 0)) return 1;
  const phase = Number(tickSeq % BigInt(TICKS_PER_DAY)) / TICKS_PER_DAY;
  // Ürün başına sabit kayma: altın orana göre dağıtılır, ürünler kümelenmesin.
  const offset = (productId * 0.6180339887) % 1;
  return 1 + amplitude * Math.sin(2 * Math.PI * (phase + offset));
}
