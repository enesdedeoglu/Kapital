import { describe, expect, it } from 'vitest';
import { tesisEtiketi } from './tesisEtiketi';

/*
 * ★ BU TESTİN TEK İŞİ ŞEHRİN DÜŞMEMESİ.
 *
 * Tesise isim verilemiyor: sunucu kurarken `dto.name ?? type.name` yazıyor ve
 * mobil kurma panelinde isim alanı yok. Yani iki manavı olan oyuncunun iki
 * tesisi de "Manav". Emir panelindeki seçici yalnız adı basınca iki özdeş pul
 * çıkıyordu ve oyuncu malı hangi şehre getirttiğini göremiyordu.
 */
describe('tesis etiketi', () => {
  it('ad ile şehri birlikte verir', () => {
    expect(tesisEtiketi({ name: 'Manav', city: { name: 'İstanbul' } }))
      .toBe('Manav · İstanbul');
  });

  it('★ aynı adlı iki tesis FARKLI etiket alır', () => {
    const a = tesisEtiketi({ name: 'Manav', city: { name: 'İstanbul' } });
    const b = tesisEtiketi({ name: 'Manav', city: { name: 'Konya' } });
    expect(a).not.toBe(b);
  });

  it('oyuncu isim verirse o isim korunur, şehir yine eklenir', () => {
    expect(tesisEtiketi({ name: 'Merkez Depo', city: { name: 'İzmir' } }))
      .toBe('Merkez Depo · İzmir');
  });
});
