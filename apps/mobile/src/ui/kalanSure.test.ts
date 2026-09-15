import { describe, expect, it } from 'vitest';
import { sayacBicimle, sureBicimle } from './kalanSure';

/*
 * Biçimleyiciler SAF olduğu için ayrı test edilebiliyor — geri sayımın kendisi
 * bir `setInterval`, ama "kalan milisaniye → okunur metin" dönüşümü değil.
 * Yoldaki malın varış süresi burada okunur; yanlış biçim, oyuncunun malı ne
 * zaman bekleyeceğini yanlış bilmesi demek.
 */
describe('kalan süre biçimi', () => {
  it('sıradaki tur sayacı dakika:saniye yazar', () => {
    expect(sayacBicimle(0)).toBe('0:00');
    expect(sayacBicimle(9_000)).toBe('0:09');
    expect(sayacBicimle(65_000)).toBe('1:05');
    expect(sayacBicimle(14 * 60_000 + 3_000)).toBe('14:03');
  });

  it('geçmiş bir hedef "birazdan" olur — eksi süre yazılmaz', () => {
    expect(sureBicimle(0)).toBe('birazdan');
    expect(sureBicimle(-5_000)).toBe('birazdan');
  });

  it('bir saatin altı dakika', () => {
    expect(sureBicimle(60_000)).toBe('1 dk');
    expect(sureBicimle(45 * 60_000)).toBe('45 dk');
    // 59,6 dk yukarı yuvarlanır ama hâlâ dakika: 60 dk = "1 sa" olurdu.
    expect(sureBicimle(59 * 60_000 + 20_000)).toBe('59 dk');
  });

  it('saat ve dakika birlikte', () => {
    expect(sureBicimle(60 * 60_000)).toBe('1 sa');
    expect(sureBicimle(135 * 60_000)).toBe('2 sa 15 dk');
    expect(sureBicimle(23 * 60 * 60_000)).toBe('23 sa');
  });

  it('bir günü aşınca gün', () => {
    expect(sureBicimle(24 * 60 * 60_000)).toBe('1 gün');
    expect(sureBicimle(27 * 60 * 60_000)).toBe('1 gün 3 sa');
    expect(sureBicimle(50 * 60 * 60_000)).toBe('2 gün 2 sa');
  });

  /*
   * ★ SANİYE GÖSTERİLMEZ, ve bu bilerek. Üç tur uzaktaki bir sevkiyat için
   * "44:59" hem okunmaz hem de sahte bir kesinlik verir: varış anı turun
   * koştuğu ana bağlıdır, saniyesi bilinmez.
   */
  it('uzun aralıkta saniye yazılmaz', () => {
    expect(sureBicimle(45 * 60_000 + 59_000)).toBe('46 dk');
  });
});
