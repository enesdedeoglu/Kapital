import * as SecureStore from 'expo-secure-store';
import { tekUcus } from '../tekUcus';

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
 *
 * ★★★★ ADRES KEŞFİ (`sunucuyuKesfet`). Yukarıdaki gerekçe yarım kalmıştı:
 * adres gömülü olmasın diye oyuncuya bir ayar verildi, ama OYUNCU YENİ ADRESİ
 * NEREDEN BİLECEK? Tünel adresi her yeniden başlatmada değişiyor; TestFlight'
 * taki yapı ilk ölümden sonra bir daha hiçbir sunucuya bağlanamıyordu —
 * elimizdeki tek yol oyuncuya adresi mesajla göndermekti.
 *
 * Çözüm: adres sabit bir adreste YAYINLANIR, uygulama açılışta oradan okur.
 * Yayını `infra/oyna.sh` yapıyor (deponun `sunucu` dalına tek satırlık JSON).
 * Böylece sunucu taşındığında yeni yapı gerekmez.
 *
 * ★ GÜVENİLİRLİK: bu dosyaya yalnızca depoya yazabilen kişi dokunabilir;
 * uygulamanın jetonlarını göndereceği adresi belirlediği için önemlidir.
 * İçeriği zaten yapıya gömülü olan bir ana makine adıdır — yeni bir sır değil.
 *
 * ★ SIRA: oyuncunun kendi yazdığı adres keşfi EZER. Oyuncu bir adres
 * verdiyse yayın onu değiştirmemeli, yoksa kendi sunucusunu kuran biri her
 * açılışta bizim sunucumuza geri döner.
 *
 * ★★ KEŞİF GELİŞTİRMEDE KAPALI (`__DEV__`). Açık olsaydı Metro ile çalışan
 * geliştirici kendi makinesindeki API'yi test ettiğini sanırken sessizce
 * YAYINDAKİ sunucuya bağlanırdı — yaptığı değişikliği göremez, üstüne
 * oyuncunun verisine yazar. Üretim yapısında ise tam tersi gerekir: gömülü
 * adres ölüdür, yayın onu ezmek ZORUNDADIR.
 */

const ANAHTAR = 'kapital.sunucuAdresi';
/** Son keşfedilen adres; ağ yoksa açılışta bu kullanılır. */
const BELLEK = 'kapital.kesfedilenAdres';

const KESIF_URL =
  'https://raw.githubusercontent.com/enesdedeoglu/Kapital/sunucu/sunucu.json';

let ozel: string | null = null;
let kesfedilen: string | null = null;

/** Açılışta bir kez: kayıtlı adres ve son keşif belleğe alınır. */
export async function sunucuyuYukle(): Promise<void> {
  try {
    ozel = await SecureStore.getItemAsync(ANAHTAR);
  } catch {
    // Anahtarlık okunamazsa varsayılan adresle devam edilir: uygulama açılsın.
    ozel = null;
  }
  try {
    kesfedilen = await SecureStore.getItemAsync(BELLEK);
  } catch {
    kesfedilen = null;
  }
}

/** Yayınlanmış adres (varsa); `apiBaseUrl()` sırada ikinci olarak kullanır. */
export function kesfedilenSunucu(): string | null {
  return __DEV__ ? null : kesfedilen;
}

const kesifKapisi = tekUcus<string | null>();

/**
 * Yayınlanmış adresi okur. Dönen değer DEĞİŞTİYSE adres döner, yoksa null.
 *
 * ★ Hata yutulur: keşif bir KOLAYLIK, önkoşul değil. Ağ yoksa ya da dosya
 * bozuksa uygulama gömülü adresle devam eder ve oyuncu Sunucu panelinden
 * elle girebilir.
 *
 * ★ Tek uçuş: ağ koptuğunda ekranların paralel istekleri hep birlikte buraya
 * düşüyor; tek bir keşif hepsine yeter.
 */
export async function sunucuyuKesfet(): Promise<string | null> {
  // Geliştirmede yerel sunucu kullanılır; gerekçesi dosya başında.
  if (__DEV__) return null;
  // Oyuncunun kendi adresi varsa keşfe hiç çıkılmaz: onun kararı geçerli.
  if (ozel !== null) return null;
  return kesifKapisi(async () => {
    try {
      const durdurucu = new AbortController();
      const sure = setTimeout(() => durdurucu.abort(), 6000);
      try {
        // Sorgu dizesi CDN önbelleğini atlatmak için: adres değişiminden
        // sonra beş dakika beklemek oyuncu için "uygulama bozuk" demektir.
        const yanit = await fetch(`${KESIF_URL}?t=${Date.now()}`, {
          signal: durdurucu.signal,
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!yanit.ok) return null;
        const veri = (await yanit.json()) as { api?: unknown };
        const adres = typeof veri.api === 'string' ? adresiDuzelt(veri.api) : null;
        if (adres === null || adres === kesfedilen) return null;
        kesfedilen = adres;
        try {
          await SecureStore.setItemAsync(BELLEK, adres);
        } catch {
          // Yazılamadıysa bellekteki değer bu oturum için yeterli.
        }
        return adres;
      } finally {
        clearTimeout(sure);
      }
    } catch {
      return null;
    }
  });
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
