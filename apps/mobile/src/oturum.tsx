/**
 * Oturum bağlamı: jeton nerede duruyorsa orada kalsın, ekranlar bilmesin.
 * Erişim jetonu süresi dolarsa TEK yerde yenilenir (client.ts'e sarmalanır).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, request, type RequestOptions } from './api/client';
import { oturumuOku, oturumuSil, oturumuYaz, yenile } from './api/session';

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
  const [jeton, setJeton] = useState<{ access: string; refresh: string } | null>(null);

  useEffect(() => {
    void (async () => {
      setJeton(await oturumuOku());
      setHazir(true);
    })();
  }, []);

  const girisOldu = useCallback(async (access: string, refresh: string) => {
    await oturumuYaz({ accessToken: access, refreshToken: refresh });
    setJeton({ access, refresh });
  }, []);

  const cikisYap = useCallback(async () => {
    await oturumuSil();
    setJeton(null);
  }, []);

  const iste = useCallback(async <T,>(
    path: string, options: Omit<RequestOptions, 'token'> = {},
  ): Promise<T> => {
    if (!jeton) return request<T>(path, options);
    try {
      return await request<T>(path, { ...options, token: jeton.access });
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
      try {
        const taze = await yenile(jeton.refresh);
        setJeton({ access: taze.accessToken, refresh: taze.refreshToken });
        return await request<T>(path, { ...options, token: taze.accessToken });
      } catch (yenilemeHatasi) {
        /*
         * ★ Yenileme de başarısızsa oturum GERÇEKTEN bitmiştir.
         *
         * Önce bu hata olduğu gibi ekrana düşüyordu ve ana sayfada
         * "Oturum geçersiz veya süresi dolmuş" yazan bir kart kalıyordu —
         * oyuncu ne yapacağını bilmiyor, hiçbir düğme onu girişe götürmüyor.
         * Yenileme jetonu bir kez kullanılınca döndüğü için (rotasyon) eski
         * bir kopyayla açılan uygulamada bu durum normaldir.
         *
         * Doğru davranış: jetonu temizlemek. `_layout` girişli olmadığını
         * görünce oyuncuyu giriş ekranına yönlendirir.
         */
        await oturumuSil();
        setJeton(null);
        throw yenilemeHatasi;
      }
    }
  }, [jeton]);

  const deger = useMemo<OturumDurumu>(
    () => ({ hazir, girisli: jeton !== null, iste, girisOldu, cikisYap }),
    [hazir, jeton, iste, girisOldu, cikisYap],
  );
  return <Baglam.Provider value={deger}>{children}</Baglam.Provider>;
}

export function useOturum(): OturumDurumu {
  const d = useContext(Baglam);
  if (!d) throw new Error('useOturum, OturumSaglayici içinde kullanılmalı');
  return d;
}
