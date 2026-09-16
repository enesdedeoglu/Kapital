/**
 * Kullanıcının yazdığı sayıyı okur — Türkçe biçimi anlayarak.
 *
 * ★★★★ `Number(metin.replace(',', '.'))` YANLIŞTI ve pahalıya mal olabilirdi.
 * Uygulama sayıları Türkçe basıyor: binlik "." , ondalık "," ("2.241,16 ₺").
 * Oyuncu gördüğünü yazdığında eski kural onu bambaşka bir sayıya çeviriyordu:
 *
 *   "1.500"     → 1,5        (bin beş yüz yerine bir buçuk)
 *   "1.500,50"  → NaN
 *
 * Satış emrinde bu, 1.500 ₺'ye satmak isterken 1,50 ₺'ye satmak demektir.
 *
 * ★ TEK BAŞINA "." OLUNCA KARAR: ayıraç mı, ondalık mı?
 * Virgül varsa iş net — "," ondalık, "." binlik. Yoksa son "."tan sonraki
 * basamak sayısına bakılır: tam üç ise binlik ("1.500" → 1500), değilse
 * ondalık ("23.61" → 23,61). Böylece hem Türkçe biçim hem de İngilizce
 * klavyeyle yazılmış ondalık doğru okunur.
 *
 * ★ TAHMİN GİZLİ KALMIYOR: paneller girilen sayıdan bir toplam hesaplayıp
 * ekranda gösteriyor ("EN FAZLA ÖDERSİN 14.250,00 ₺"). Yanlış anlaşılan bir
 * sayı oraya yanlış yansır ve oyuncu emri vermeden görür.
 *
 * Geçersiz girdide NaN döner; çağıran `Number.isFinite` ile eler.
 */
export function sayiOku(metin: string): number {
  const temiz = metin.replace(/\s/g, '');
  if (temiz === '') return Number.NaN;

  if (temiz.includes(',')) {
    // Virgül ondalık: noktalar binlik ayıracıdır, atılır.
    return Number(temiz.replace(/\./g, '').replace(',', '.'));
  }

  const sonNokta = temiz.lastIndexOf('.');
  if (sonNokta === -1) return Number(temiz);

  const kuyruk = temiz.length - sonNokta - 1;
  const binlik = kuyruk === 3 && sonNokta > 0;
  return Number(binlik ? temiz.replace(/\./g, '') : temiz);
}
