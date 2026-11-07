/**
 * Kapital API istemcisi.
 *
 * Tek giriş noktası: her istek buradan geçer. Sebebi tek bir yerde
 * tutulabilmesi gereken üç şey var — taban adres, oturum jetonu ve hata
 * biçimi. Bunlar ekranlara dağılırsa jeton yenileme her ekranda tekrar yazılır.
 */
import Constants from 'expo-constants';
import { kesfedilenSunucu, ozelSunucu, sunucuyuKesfet } from './sunucu';

/**
 * Taban adres. Dört kaynak, bu sırayla:
 *
 *  1. OYUNCUNUN AYARI — her şeyi ezer. Sunucu adresi yapıya gömülü olamaz;
 *     gerekçesi `sunucu.ts`te.
 *  2. YAYINLANMIŞ ADRES (keşif). Tünel adresi değiştiğinde yapı yenilenmeden
 *     uygulamanın sunucuyu bulmasını sağlayan tek yol; gerekçesi `sunucu.ts`te.
 *  3. Yapıya gömülü varsayılan (`EXPO_PUBLIC_API_URL`).
 *  4. Geliştirme: Expo sunucusunun IP'si. Simülatör `localhost`u kendi
 *     çözer; gerçek cihaz çözemez.
 */
export function apiBaseUrl(): string {
  const kayitli = ozelSunucu();
  if (kayitli) return kayitli;

  const yayin = kesfedilenSunucu();
  if (yayin) return yayin;

  const acik = process.env.EXPO_PUBLIC_API_URL;
  if (acik) return acik.replace(/\/$/, '');

  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly token?: string | null;
  /** Yazma uçlarında çift gönderimi engeller (API'nin Idempotency-Key'i). */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

/**
 * ★★★ AĞ HATASINDA ADRES BİR KEZ YENİDEN KEŞFEDİLİR.
 *
 * Sunucu yer değiştirdiğinde (tünel yeniden başladı) uygulamanın elindeki
 * adres ölüdür ve HER istek ağ hatasıyla düşer. Oyuncunun gördüğü şey
 * "bağlanamadı"dır; yapabileceği hiçbir şey yoktur. Burada yayınlanmış adres
 * yeniden okunur, DEĞİŞMİŞSE istek bir kez tekrarlanır — oyuncu kesintiyi
 * çoğu zaman hiç fark etmez.
 *
 * ★ Yalnız AĞ hatasında: sunucudan gelen 4xx/5xx yanıtı adresin doğru
 * olduğunu kanıtlar, tekrar etmek yanlış olurdu.
 * ★ Yalnız BİR KEZ ve adres GERÇEKTEN değiştiyse: aksi halde çevrimdışı bir
 * oyuncunun her isteği iki katına çıkar.
 * ★ İstek sunucuya VARMADIĞI için yazma uçlarında tekrar güvenlidir: yeni
 * adres farklı bir sunucudur, eskisinde de hiçbir şey uygulanmamıştır.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const taban = apiBaseUrl();
  try {
    return await gonder<T>(taban, path, options);
  } catch (e) {
    if (!agHatasi(e) || ozelSunucu() !== null) throw e;
    const yeni = await sunucuyuKesfet();
    if (yeni === null || yeni === taban) throw e;
    return gonder<T>(yeni, path, options);
  }
}

/**
 * `fetch` ağa hiç çıkamadığında TypeError atar ("Network request failed").
 * `ApiError` sunucunun cevabıdır — o ağ hatası değildir.
 */
function agHatasi(e: unknown): boolean {
  return !(e instanceof ApiError) && e instanceof Error && e.name !== 'AbortError';
}

async function gonder<T>(
  taban: string, path: string, options: RequestOptions,
): Promise<T> {
  const { method = 'GET', body, token, idempotencyKey, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${taban}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text.length > 0 ? safeJson(text) : null;

  if (!response.ok) {
    const hata = parsed as { code?: string; message?: string } | null;
    throw new ApiError(
      response.status,
      hata?.code ?? 'UNKNOWN',
      hata?.message ?? `İstek başarısız (${response.status})`,
    );
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
