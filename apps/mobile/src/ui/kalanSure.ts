import { useEffect, useState } from 'react';

/**
 * Hedef zamana kalan süreyi canlı sayar.
 *
 * ★ SUNUCU ZAMAN GÖNDERİR, KALAN SÜRE DEĞİL. Kalan süre gönderilseydi ağ
 * gecikmesi ve ekranın açık kaldığı süre kadar yanlış olurdu. Hedef saati
 * alıp farkı burada saymak, sekmeler arasında gezinirken bile doğru kalır.
 *
 * ★ TEK YERDEN: geri sayımın iki müşterisi var — sıradaki tur rozeti
 * (`GeriSayim`) ve yoldaki malın varış saati. İkisine ayrı birer `setInterval`
 * yazmak, birinin ötekinden kayması demekti.
 */
export function useKalan(hedef: string | null): number {
  const [kalanMs, setKalanMs] = useState(() => fark(hedef));

  useEffect(() => {
    setKalanMs(fark(hedef));
    if (hedef === null) return;
    const t = setInterval(() => setKalanMs(fark(hedef)), 1000);
    return () => clearInterval(t);
  }, [hedef]);

  return kalanMs;
}

export function fark(hedef: string | null): number {
  return hedef === null ? 0 : new Date(hedef).getTime() - Date.now();
}

/** Sıradaki tur rozeti — dakika:saniye, çünkü bir tur 15 dakika. */
export function sayacBicimle(ms: number): string {
  const toplam = Math.floor(ms / 1000);
  const dk = Math.floor(toplam / 60);
  const sn = toplam % 60;
  return `${dk}:${sn.toString().padStart(2, '0')}`;
}

/**
 * Uzun aralık — yoldaki mal saatlerce, bazen günlerce yolda olur.
 *
 * ★ SANİYE GÖSTERİLMEZ: üç tur uzaktaki bir sevkiyat için "44:59" hem yanlış
 * bir kesinlik duygusu verir hem de okunmaz. Kalan yarım saatse dakika,
 * yarım günse saat, ötesi gün.
 */
export function sureBicimle(ms: number): string {
  if (ms <= 0) return 'birazdan';
  const dk = Math.round(ms / 60_000);
  if (dk < 60) return `${dk} dk`;
  const sa = Math.floor(dk / 60);
  const kalanDk = dk % 60;
  if (sa < 24) return kalanDk === 0 ? `${sa} sa` : `${sa} sa ${kalanDk} dk`;
  const gun = Math.floor(sa / 24);
  const kalanSa = sa % 24;
  return kalanSa === 0 ? `${gun} gün` : `${gun} gün ${kalanSa} sa`;
}
