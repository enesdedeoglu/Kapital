/**
 * Oturum bağlamı: jeton nerede duruyorsa orada kalsın, ekranlar bilmesin.
 * Erişim jetonu süresi dolarsa TEK yerde yenilenir (client.ts'e sarmalanır).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { ApiError, request, type RequestOptions } from './api/client';
import { oturumuOku, oturumuSil, oturumuYaz, yenile } from './api/session';
import type { OturumYaniti } from './api/types';
import { sunucuyuKesfet, sunucuyuYukle } from './api/sunucu';
import { tekUcus } from './tekUcus';

interface Jeton { readonly access: string; readonly refresh: string }

/**
 * Şirket durumu — kayıttan sonra oyunun başlayıp başlamadığı.
 *
 * ★ 'yok' HALİ GERÇEKTİR, hata değil: yeni hesabın şirketi olmaz ve kuruluş
 * ekranına gitmesi gerekir. Bu ayrım yapılmadığı için yeni oyuncu boş
 * sekmelerde ve 0 ₺ kasayla kalıyordu.
 */
export type SirketDurumu = 'bilinmiyor' | 'var' | 'yok';

interface OturumDurumu {
  readonly hazir: boolean;
  readonly girisli: boolean;
  readonly sirket: SirketDurumu;
  /** Kuruluş ekranı şirketi kurunca çağırır; kapı yeniden sormaz. */
  readonly sirketKuruldu: () => void;
  /** Jeton yenilemeyi kendi halleden istek yardımcısı. */
  readonly iste: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  readonly girisOldu: (access: string, refresh: string) => Promise<void>;
  /** Parola değiştirir; sunucu taze jeton verir, oturum düşmez. */
  readonly parolaDegistir: (mevcut: string, yeni: string) => Promise<void>;
  readonly cikisYap: () => Promise<void>;
}

const Baglam = createContext<OturumDurumu | null>(null);

export function OturumSaglayici({ children }: { children: ReactNode }) {
  const [hazir, setHazir] = useState(false);
  const [girisli, setGirisli] = useState(false);
  /*
   * ★★★★ JETONUN DOĞRULUK KAYNAĞI REF, STATE DEĞİL.
   *
   * Jetonu yalnızca state'te tutarken `iste` onu KAPANIŞTA yakalıyordu. Yenileme
   * bittikten sonra React yeniden çizene kadar geçen aralıkta başlayan her istek
   * hâlâ ESKİ erişim jetonunu kullanıyor, 403 alıyor ve ROTASYONLA İPTAL EDİLMİŞ
   * yenileme jetonuyla ikinci bir yenilemeye kalkıyordu — yenileme "geçerli
   * oturum yok" deyince oyuncu atılıyordu. Şirketim sekmesi tam bu deseni
   * üretiyor: önce `/facilities`, sonra tesis başına `/stock`.
   *
   * Ref her istekte ANINDA okunur; render beklemez. State yalnızca "girişli mi"
   * sorusunu çizime taşır.
   */
  const jetonRef = useRef<Jeton | null>(null);
  const [sirket, setSirket] = useState<SirketDurumu>('bilinmiyor');

  const jetonuKur = useCallback((yeni: Jeton | null) => {
    jetonRef.current = yeni;
    setGirisli(yeni !== null);
    // Oturum değişti: şirket bilgisi yeni hesabın değil, yeniden sorulmalı.
    if (yeni === null) setSirket('bilinmiyor');
  }, []);

  const sirketKuruldu = useCallback(() => setSirket('var'), []);

  /**
   * Yenileme kapısı: paralel isteklerin hepsi TEK yenilemeye biner.
   * Neden şart olduğu ve neyi önlediği `tekUcus.ts`'te anlatılıyor.
   */
  // useRef ile: useMemo'yu React teoride atabilir, kapı ise atılırsa garanti çöker.
  const yenilemeKapisi = useRef(tekUcus<Jeton>());

  useEffect(() => {
    void (async () => {
      /*
       * ★ SUNUCU ADRESİ JETONDAN ÖNCE OKUNUR. `hazir` olur olmaz ekranlar
       * istek atmaya başlıyor; adres o an bellekte olmazsa ilk istekler
       * yapıya gömülü ESKİ adrese gider ve oyuncu sebepsiz bir hata görür.
       */
      await sunucuyuYukle();
      /*
       * ★ YAYINLANMIŞ ADRES AÇILIŞTA SORULUR, ama açılışı BEKLETMEZ. Sunucu
       * taşındıysa doğru adres buradan gelir; GitHub yavaşsa oyuncuyu açılış
       * ekranında tutmanın anlamı yok — keşif arka planda bitse de sonraki
       * istekler onu kullanır (apiBaseUrl sırası, client.ts).
       */
      await Promise.race([
        sunucuyuKesfet(),
        new Promise((bitir) => setTimeout(bitir, 2500)),
      ]);
      const kayitli = await oturumuOku();
      jetonuKur(kayitli);
      setHazir(true);
    })();
  }, [jetonuKur]);

  const girisOldu = useCallback(async (access: string, refresh: string) => {
    await oturumuYaz({ accessToken: access, refreshToken: refresh });
    jetonuKur({ access, refresh });
  }, [jetonuKur]);

  /** Yalnız cihazdaki jetonları siler — sunucuya haber vermez. */
  const jetonlariBirak = useCallback(async () => {
    await oturumuSil();
    jetonuKur(null);
  }, [jetonuKur]);

  /**
   * Çıkış — sunucudaki yenileme jetonu da iptal edilir.
   *
   * ★★ ÖNCE YALNIZ CİHAZDAN SİLİYORDU ve `POST /auth/logout` hiç çağrılmıyordu.
   * Sunucudaki yenileme jetonu 30 gün daha geçerli kalıyordu: çıkış yapmak
   * oturumu KAPATMIYORDU, sadece gizliyordu. Telefonu kaybeden oyuncu için
   * "çıkış yaptım" bir güvence değildi.
   *
   * ★ Bildirim BEST-EFFORT: ağ yoksa ya da jeton zaten geçersizse cihazdaki
   * jeton yine silinir. Aksi halde çevrimdışı oyuncu uygulamaya kilitlenirdi.
   */
  const cikisYap = useCallback(async () => {
    const jeton = jetonRef.current;
    if (jeton) {
      try {
        await request('/auth/logout', { method: 'POST', token: jeton.access });
      } catch {
        // Sunucuya ulaşılamadı: jeton süresi dolunca kendiliğinden ölür.
      }
    }
    await jetonlariBirak();
  }, [jetonlariBirak]);

  const iste = useCallback(async <T,>(
    path: string, options: Omit<RequestOptions, 'token'> = {},
  ): Promise<T> => {
    const kullanilan = jetonRef.current;
    if (!kullanilan) return request<T>(path, options);
    try {
      return await request<T>(path, { ...options, token: kullanilan.access });
    } catch (e) {
      /*
       * ★★ JETON SORUNU DURUMA DEĞİL, KODA BAKILARAK ANLAŞILIR.
       *
       * API süresi dolmuş jeton için 403 döner (401 değil): `jwt.guard.ts` →
       * `DomainError('FORBIDDEN', 'Oturum geçersiz veya süresi dolmuş')`.
       * Ama 403'ü OYUN KURALLARI da kullanır: `LEVEL_LOCKED` ("Buğday
       * ticareti için seviye 5 gerekli") de 403'tür.
       *
       * Önce sadece duruma bakıyordum ve seviye kilidi yüzünden jeton
       * yenilemeye çalışıyordum; yenileme tutmayınca oyuncu NORMAL BİR OYUN
       * KURALI yüzünden oturumdan atılıyordu. Simülatörde buğday almaya
       * çalışınca giriş ekranına düştük.
       *
       * Kod `FORBIDDEN` ise kimlik sorunudur, yenilenir. `LEVEL_LOCKED`,
       * `INSUFFICIENT_STOCK` gibi kodlar oyunun cevabıdır — olduğu gibi
       * ekrana çıkar.
       */
      const jetonSorunu = e instanceof ApiError
        && (e.status === 401 || (e.status === 403 && e.code === 'FORBIDDEN'));
      if (!jetonSorunu) throw e;

      const simdiki = jetonRef.current;
      let taze: Jeton;
      if (simdiki && simdiki.access !== kullanilan.access) {
        // Biz beklerken başkası yenilemiş: yenileme jetonunu boşuna harcama.
        taze = simdiki;
      } else {
        try {
          taze = await yenilemeKapisi.current(async () => {
            const cevap = await yenile(kullanilan.refresh);
            // `yenile` tazelenen jetonu depoya kendisi yazar (session.ts).
            const yeni = { access: cevap.accessToken, refresh: cevap.refreshToken };
            jetonuKur(yeni);
            return yeni;
          });
        } catch (yenilemeHatasi) {
          /*
           * ★ Yenileme de başarısızsa oturum GERÇEKTEN bitmiştir.
           *
           * Önce bu hata olduğu gibi ekrana düşüyordu ve ana sayfada
           * "Oturum geçersiz veya süresi dolmuş" yazan bir kart kalıyordu —
           * oyuncu ne yapacağını bilmiyor, hiçbir düğme onu girişe götürmüyor.
           * Doğru davranış: jetonu temizlemek. `_layout` girişli olmadığını
           * görünce oyuncuyu giriş ekranına yönlendirir.
           *
           * Dikkat: bu yakalama YALNIZCA yenilemeyi sarar. İsteğin kendi ağ
           * hatası buraya düşerse oyuncuyu bağlantı koptu diye atmış oluruz.
           */
          await jetonlariBirak();
          throw yenilemeHatasi;
        }
      }
      return await request<T>(path, { ...options, token: taze.access });
    }
  }, [jetonuKur, jetonlariBirak]);

  /**
   * Parola değişimi — sunucu diğer oturumları kapatır ve bu oturuma taze bir
   * jeton çifti verir.
   *
   * ★ YENİ JETONLAR YAZILMAZSA OYUNCU KENDİ TELEFONUNDAN ATILIRDI: sunucu
   * bütün yenileme jetonlarını iptal ediyor, elimizdeki eski çift ölüyor.
   */
  const parolaDegistir = useCallback(async (mevcut: string, yeni: string) => {
    const yanit = await iste<OturumYaniti>('/auth/password', {
      method: 'PATCH',
      body: { currentPassword: mevcut, newPassword: yeni },
    });
    await oturumuYaz(yanit);
    jetonuKur({ access: yanit.accessToken, refresh: yanit.refreshToken });
  }, [iste, jetonuKur]);

  /*
   * Şirket var mı? Girişten sonra BİR KEZ sorulur.
   *
   * ★ 404 = şirket yok; başka her hata 'bilinmiyor' bırakır. Ağ koptuğunda
   * oyuncuyu kuruluş ekranına atmak, var olan şirketinin üstüne ikinci bir
   * şirket kurdurmaya çalışmak olurdu (sunucu reddeder, oyuncu kilitlenir).
   */
  useEffect(() => {
    if (!girisli || sirket !== 'bilinmiyor') return;
    let iptal = false;
    void (async () => {
      try {
        await iste('/company');
        if (!iptal) setSirket('var');
      } catch (e) {
        if (!iptal && e instanceof ApiError && e.status === 404) setSirket('yok');
      }
    })();
    return () => { iptal = true; };
  }, [girisli, sirket, iste]);

  const deger = useMemo<OturumDurumu>(
    () => ({ hazir, girisli, sirket, sirketKuruldu, iste, girisOldu, parolaDegistir, cikisYap }),
    [hazir, girisli, sirket, sirketKuruldu, iste, girisOldu, parolaDegistir, cikisYap],
  );
  return <Baglam.Provider value={deger}>{children}</Baglam.Provider>;
}

export function useOturum(): OturumDurumu {
  const d = useContext(Baglam);
  if (!d) throw new Error('useOturum, OturumSaglayici içinde kullanılmalı');
  return d;
}
