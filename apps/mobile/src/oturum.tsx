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
      // 401 = erişim jetonu eskimiş. Bir kez yenile, bir kez daha dene.
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      const taze = await yenile(jeton.refresh);
      setJeton({ access: taze.accessToken, refresh: taze.refreshToken });
      return request<T>(path, { ...options, token: taze.accessToken });
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
