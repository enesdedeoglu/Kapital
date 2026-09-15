/**
 * Kapital görsel dili.
 *
 * ★ Bu bir OYUN, pano değil. İlk sürüm gri kartlardan oluşan kurumsal bir
 * gösterge paneline benziyordu. Buradaki üç karar onu oyuna çeviriyor:
 *
 *  1. PARA ALTINDIR. Nakit ekranın en sıcak, en parlak öğesi; gerisi ona
 *     zemin olur. Tycoon oyunlarında bakılan ilk sayı odur.
 *  2. ZEMİN DÜZ DEĞİL. Lacivert→mor bir gradyan ve kartlarda hafif ışıma,
 *     düz #111 yüzeylerin verdiği "form" hissini kırar.
 *  3. HER SAYININ BİR SİMGESİ VAR. Rakamların yanında ikon olunca ekran
 *     tabloya değil oyun arayüzüne benzer.
 */
export const renk = {
  // Zemin — lacivertten mora
  zeminUst: '#141A2E',
  zeminAlt: '#0B0E1A',
  zemin: '#0B0E1A',

  // Yüzeyler
  kart: '#1A2138',
  kartUst: '#222B45',
  kenar: '#2E3A5C',
  kenarIsik: '#3D4E7A',

  // Metin
  metin: '#F2F5FF',
  soluk: '#8B96B8',
  cokSoluk: '#5C6688',

  // Anlam
  altin: '#FFC24B',
  altinKoyu: '#E09A16',
  artı: '#3DDC97',
  eksi: '#FF6B6B',
  mor: '#8B5CF6',
  mavi: '#4EA1FF',
  turuncu: '#FF9F45',
  uyari: '#FFB454',
} as const;

/** Gradyanlar — `expo-linear-gradient` colors dizisi olarak kullanılır. */
export const gradyan = {
  zemin: [renk.zeminUst, renk.zeminAlt] as const,
  kart: [renk.kartUst, renk.kart] as const,
  altin: ['#FFD97A', '#FFC24B', '#E09A16'] as const,
  mor: ['#A78BFA', '#7C3AED'] as const,
  yesil: ['#4EEBA8', '#22B573'] as const,
} as const;

/**
 * ★ İKİ YAZI TİPİ, İKİ İŞ.
 *
 * Sistem fontu her uygulamada aynı görünür; bir OYUNUN kimliği olmaz.
 *
 *  · CHAKRA PETCH — köşeli, teknik. Başlıklar, etiketler, RAKAMLAR ve
 *    düğmeler. HUD gibi okunur; kasadaki sayının karakteri buradan gelir.
 *  · SORA — yumuşak geometrik sans. Paragraf ve açıklama metni. Chakra Petch
 *    uzun metinde yorucu olur; okunurluk gövdede öncelik.
 *
 * İkisi de Latin Extended kapsar, yani Türkçe glifler (ğ ş ı İ ö ü ç) tam.
 */
export const yaziTipi = {
  baslik: 'ChakraPetch_700Bold',
  baslikOrta: 'ChakraPetch_600SemiBold',
  etiket: 'ChakraPetch_600SemiBold',
  rakam: 'ChakraPetch_700Bold',
  govde: 'Sora_400Regular',
  govdeOrta: 'Sora_500Medium',
  govdeKalin: 'Sora_600SemiBold',
} as const;

export const bosluk = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const yuvarlak = { s: 10, m: 14, l: 20, xl: 28, tam: 999 } as const;

/** Kart gölgesi — derinlik hissi düz yüzeyi oyun arayüzüne çevirir. */
export const golge = {
  kart: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  altin: {
    shadowColor: renk.altinKoyu,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

/**
 * ★ BİNLİK AYIRICI ELLE — `toLocaleString('tr-TR')` HERMES'TE ÇALIŞMIYOR.
 *
 * React Native'in Hermes motoru tam ICU verisiyle gelmez; `toLocaleString`
 * dil kodunu sessizce yok sayar ve "30000" basar. Simülatörde yakalandı:
 * kasa kartında 30.000 ₺ yerine 30000 ₺ yazıyordu. Para bu oyunun merkezinde
 * olduğu için gruplama tahmine bırakılamaz.
 */
function binlikAyir(n: bigint): string {
  const s = n.toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += '.';
    out += s[i];
  }
  return out;
}

/**
 * Kuruş cinsinden string'i ₺ olarak biçimler (API para alanlarını string
 * yollar — ADR-0001: para bigint'tir, JSON'da string taşınır).
 */
export function paraBicimle(kurus: string | bigint, basamak = 0): string {
  const v = typeof kurus === 'string' ? BigInt(kurus) : kurus;
  const negatif = v < 0n;
  const mutlak = negatif ? -v : v;
  const tam = mutlak / 10_000n;
  const kesir = mutlak % 10_000n;
  const govde = binlikAyir(tam);
  const son = basamak > 0
    ? `${govde},${kesir.toString().padStart(4, '0').slice(0, basamak)}`
    : govde;
  return `${negatif ? '−' : ''}${son}`;
}

/** Büyük sayıyı kısaltır: 1.250.000 → "1,25 Mn". HUD'da yer kazandırır. */
export function kisaPara(kurus: string | bigint): string {
  const lira = (typeof kurus === 'string' ? BigInt(kurus) : kurus) / 10_000n;
  const mutlak = lira < 0n ? -lira : lira;
  const isaret = lira < 0n ? '−' : '';
  const ondalik = (v: number) => v.toFixed(2).replace('.', ',');
  if (mutlak >= 1_000_000_000n) return `${isaret}${ondalik(Number(mutlak) / 1e9)} Mr`;
  if (mutlak >= 1_000_000n) return `${isaret}${ondalik(Number(mutlak) / 1e6)} Mn`;
  if (mutlak >= 100_000n) return `${isaret}${(Number(mutlak) / 1e3).toFixed(0)} B`;
  return `${isaret}${binlikAyir(mutlak)}`;
}
