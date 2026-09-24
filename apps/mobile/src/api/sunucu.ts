import * as SecureStore from 'expo-secure-store';

/**
 * Sunucu adresi — oyuncunun elinde, yapıya gömülü değil.
 *
 * ★★★★ ADRES YAPIYA GÖMÜLÜ OLAMAZ. `EXPO_PUBLIC_API_URL` derleme anında
 * pakete yazılır. Sunucu şimdilik geliştirme makinesinde duruyor ve dışarı
 * Cloudflare tüneliyle açılıyor; tünelin ücretsiz adresi her yeniden
 * başlatmada DEĞİŞİYOR. Adres gömülü olsaydı her değişimde TestFlight'a yeni
 * bir yapı yüklemek gerekirdi — oyuncunun elinde çalışmayan bir uygulama,
 * düzeltmesi yarım gün.
 *
 * ★ Kayıtlı adres ÖNCELİKLİDİR: oyuncu bir adres verdiyse yapıdaki varsayılan
 * onu ezmez. Ezseydi, uygulama her güncellemede eski sunucuya dönerdi.
 *
 * ★ Değer BELLEKTE de tutulur (`ozel`): `apiBaseUrl()` her istekte çağrılıyor
 * ve eşzamanlı olmak zorunda. Açılışta bir kez okunur (`sunucuyuYukle`).
 */

const ANAHTAR = 'kapital.sunucuAdresi';

let ozel: string | null = null;

/** Açılışta bir kez: kayıtlı adres belleğe alınır. */
export async function sunucuyuYukle(): Promise<void> {
  try {
    ozel = await SecureStore.getItemAsync(ANAHTAR);
  } catch {
    // Anahtarlık okunamazsa varsayılan adresle devam edilir: uygulama açılsın.
    ozel = null;
  }
}

/** Oyuncunun verdiği adres; yoksa null (yapıdaki varsayılan kullanılır). */
export function ozelSunucu(): string | null {
  return ozel;
}

export async function sunucuyuYaz(adres: string | null): Promise<void> {
  ozel = adres;
  if (adres === null) await SecureStore.deleteItemAsync(ANAHTAR);
  else await SecureStore.setItemAsync(ANAHTAR, adres);
}

/**
 * Yazılan adresi kullanılabilir hâle getirir; anlamsızsa null döner.
 *
 * ★ Şema eklenir: oyuncu "abc.trycloudflare.com" yapıştırdığında `fetch`
 * bunu göreli yol sanar ve istek sessizce boşa gider. HTTPS varsayılır —
 * iOS şifresiz bağlantıyı zaten engelliyor.
 */
export function adresiDuzelt(ham: string): string | null {
  const temiz = ham.trim().replace(/\s/g, '');
  if (temiz === '') return null;

  const semali = /^https?:\/\//i.test(temiz) ? temiz : `https://${temiz}`;
  let url: URL;
  try {
    url = new URL(semali);
  } catch {
    return null;
  }
  if (url.hostname === '') return null;

  // Sondaki eğik çizgi atılır: istek yolları "/auth/login" gibi eğik çizgiyle
  // başlıyor, ikisi birleşince "//auth/login" olurdu.
  return `${url.protocol}//${url.host}`.replace(/\/$/, '');
}
