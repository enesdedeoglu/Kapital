import { describe, expect, it } from 'vitest';
import { sayiOku } from './sayiOku';

/*
 * ★ BU TESTLERİN ÇIKIŞ NOKTASI GERÇEK BİR HATA.
 *
 * Eski kural `Number(metin.replace(',', '.'))` idi. Uygulama sayıları Türkçe
 * basıyor (binlik "." , ondalık ","), yani oyuncu EKRANDA GÖRDÜĞÜNÜ yazınca
 * bambaşka bir sayı oluşuyordu: "1.500" → 1,5. Satış emrinde 1.500 ₺ yerine
 * 1,50 ₺ demek.
 */
describe('sayı okuma', () => {
  it('düz tam sayı', () => {
    expect(sayiOku('1500')).toBe(1500);
    expect(sayiOku('0')).toBe(0);
  });

  it('★ Türkçe binlik ayıracı ondalık sanılmaz', () => {
    expect(sayiOku('1.500')).toBe(1500);
    expect(sayiOku('12.000')).toBe(12000);
    expect(sayiOku('1.234.567')).toBe(1234567);
  });

  it('★ Türkçe ondalık: virgül', () => {
    expect(sayiOku('23,61')).toBeCloseTo(23.61, 10);
    expect(sayiOku('0,5')).toBeCloseTo(0.5, 10);
  });

  it('★ binlik ve ondalık birlikte — eskiden NaN veriyordu', () => {
    expect(sayiOku('1.500,50')).toBeCloseTo(1500.5, 10);
    expect(sayiOku('2.241,16')).toBeCloseTo(2241.16, 10);
  });

  it('İngilizce klavyeyle yazılmış ondalık da okunur', () => {
    // Son noktadan sonra üç basamak YOK → ondalık sayılır.
    expect(sayiOku('23.61')).toBeCloseTo(23.61, 10);
    expect(sayiOku('1.5')).toBeCloseTo(1.5, 10);
  });

  it('boşluklar yok sayılır', () => {
    expect(sayiOku(' 42 ')).toBe(42);
    expect(sayiOku('1 500')).toBe(1500);
  });

  it('geçersiz girdi NaN — çağıran eler', () => {
    expect(Number.isNaN(sayiOku(''))).toBe(true);
    expect(Number.isNaN(sayiOku('   '))).toBe(true);
    expect(Number.isNaN(sayiOku('abc'))).toBe(true);
    expect(Number.isNaN(sayiOku('1,2,3'))).toBe(true);
  });

  /*
   * ★ BELİRSİZ HÂL AÇIKÇA SABİTLENİYOR: "1.500" hem "bin beş yüz" hem
   * "bir nokta beş yüz" okunabilir. Uygulama sayıları Türkçe bastığı için
   * Türkçe okuma seçildi. Karar burada yazılı olmazsa ileride sessizce
   * değişebilirdi.
   */
  it('★ üç basamaklı kuyruk BİNLİK sayılır — uygulamanın kendi biçimi', () => {
    expect(sayiOku('1.500')).toBe(1500);
    expect(sayiOku('1.50')).toBeCloseTo(1.5, 10);   // iki basamak → ondalık
    expect(sayiOku('1.5000')).toBeCloseTo(1.5, 10); // dört basamak → ondalık
  });

  it('başta nokta varsa ondalık sayılır', () => {
    expect(sayiOku('.500')).toBeCloseTo(0.5, 10);
  });
});
