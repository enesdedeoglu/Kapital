/** Tek renk/ölçü kaynağı — ekranlar sabit değer yazmaz. */
export const tema = {
  renk: {
    zemin: '#0E1116',
    kart: '#171C24',
    kartKenar: '#232A35',
    metin: '#E8EDF4',
    soluk: '#8A97A8',
    vurgu: '#4EA1FF',
    artı: '#3DD68C',
    eksi: '#FF6B6B',
    uyari: '#FFB454',
  },
  bosluk: { xs: 4, s: 8, m: 12, l: 16, xl: 24 },
  yuvarlak: { s: 8, m: 12, l: 16 },
} as const;

/** Kuruş cinsinden string'i ₺ olarak biçimler (API para alanlarını string yollar). */
export function paraBicimle(kurus: string | bigint, basamak = 0): string {
  const v = typeof kurus === 'string' ? BigInt(kurus) : kurus;
  const negatif = v < 0n;
  const mutlak = negatif ? -v : v;
  const tam = mutlak / 10_000n;
  const kesir = mutlak % 10_000n;
  const govde = tam.toLocaleString('tr-TR');
  const son = basamak > 0
    ? `${govde},${kesir.toString().padStart(4, '0').slice(0, basamak)}`
    : govde;
  return `${negatif ? '−' : ''}${son} ₺`;
}
