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
import { tekUcus } from './tekUcus';

interface Jeton { readonly access: string; readonly refresh: string }

interface OturumDurumu {
  readonly hazir: boolean;
  readonly girisli: boolean;
  /** Jeton yenilemeyi kendi halleden istek yardımcısı. */
  readonly iste: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  readonly girisOldu: (access: string, refresh: string) => Promise<void>;
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

  const jetonuKur = useCallback((yeni: Jeton | null) => {
    jetonRef.current = yeni;
    setGirisli(yeni !== null);
  }, []);

  /**
   * Yenileme kapısı: paralel isteklerin hepsi TEK yenilemeye biner.
   * Neden şart olduğu ve neyi önlediği `tekUcus.ts`'te anlatılıyor.
   */
  // useRef ile: useMemo'yu React teoride atabilir, kapı ise atılırsa garanti çöker.
  const yenilemeKapisi = useRef(tekUcus<Jeton>());

  useEffect(() => {
    void (async () => {
      const kayitli = await oturumuOku();
      jetonuKur(kayitli);
      setHazir(true);
    })();
  }, [jetonuKur]);

  const girisOldu = useCallback(async (access: string, refresh: string) => {
    await oturumuYaz({ accessToken: access, refreshToken: refresh });
    jetonuKur({ access, refresh });
  }, [jetonuKur]);

  const cikisYap = useCallback(async () => {
    await oturumuSil();
    jetonuKur(null);
  }, [jetonuKur]);

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
          await cikisYap();
          throw yenilemeHatasi;
        }
      }
      return await request<T>(path, { ...options, token: taze.access });
    }
  }, [jetonuKur, cikisYap]);

  const deger = useMemo<OturumDurumu>(
    () => ({ hazir, girisli, iste, girisOldu, cikisYap }),
    [hazir, girisli, iste, girisOldu, cikisYap],
  );
  return <Baglam.Provider value={deger}>{children}</Baglam.Provider>;
}

export function useOturum(): OturumDurumu {
  const d = useContext(Baglam);
  if (!d) throw new Error('useOturum, OturumSaglayici içinde kullanılmalı');
  return d;
}
