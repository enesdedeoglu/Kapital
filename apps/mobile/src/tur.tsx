/**
 * Tur bağlamı — oyunun saati ve "tur düştü" haberi.
 *
 * ★ NEDEN SOKET DEĞİL. İlk planım WebSocket'ti; tasarıma bakınca yanlış çağrı
 * olduğu çıktı:
 *   · Tur 15 dakikada bir (96/gün). Burası gerçek zamanlı bir alan değil.
 *   · Turları worker koşuyor, API'den AYRI süreç. Soket açsak bile API turu
 *     ancak veritabanından öğrenirdi (LISTEN/NOTIFY ya da yoklama) — yani
 *     soket yoklamayı KALDIRMIYOR, üstüne taşıma katmanı, bağımlılık ve
 *     yeniden bağlanma mantığı ekliyor.
 *   · Mobilde uygulama sürekli arka plana düşer, soket her seferinde ölür;
 *     dönüşte zaten yeniden çekmek gerekir — tam da yoklamanın kendisi.
 *   · Sunucu sıradaki turun SAATİNİ gönderiyor. Yani ne zaman bakacağımızı
 *     biliyoruz; sürekli dinlemeye gerek yok.
 *
 * Bu yüzden: normalde HİÇ istek yok, sadece yerel geri sayım. Turun saati
 * gelince `/tick` yoklanır (ucuz, oturumsuz uç) ve `seq` ilerleyince ekranlar
 * haber alır. Bir de ön plana dönünce bir kez bakılır — arka plandayken
 * zamanlayıcılar askıya alındığı için kaçırılan tur ancak böyle yakalanır.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { request } from './api/client';
import { useOturum } from './oturum';

export interface TurBilgisi {
  /** Son TAMAMLANAN turun sırası — haber sinyali budur (bkz. `/tick` ucu). */
  readonly tamamlanan: string;
  readonly sonraki: string | null;
  readonly dakika: number;
}

interface TurDurumu {
  readonly tamamlanan: string | null;
  readonly sonraki: string | null;
  /** Sıradaki turun saati geçti, sonucu bekliyoruz. */
  readonly isleniyor: boolean;
  /** Tur ilerleyince çağrılacak geri çağrıyı kaydeder; bırakma işlevi döner. */
  readonly abone: (geriCagri: () => void) => () => void;
}

const Baglam = createContext<TurDurumu | null>(null);

/*
 * Yoklama aralıkları. Turun saati geldiğinde sık, sonuç gelmedikçe seyrekleşir.
 *
 * ★ GERİ ÇEKİLME ŞART: worker durursa `sonraki` sonsuza dek geçmişte kalır ve
 * sabit aralık her oyuncuyu kalıcı bir yoklama döngüsüne sokar. Kademeli
 * seyrelme, worker geri geldiğinde en fazla bir dakikada yakalar.
 */
const ARALIKLAR_MS = [5_000, 5_000, 5_000, 15_000, 15_000, 30_000] as const;
const SON_ARALIK_MS = 60_000;

export function TurSaglayici({ children }: { children: ReactNode }) {
  const { girisli } = useOturum();
  const [tur, setTur] = useState<TurBilgisi | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const aboneler = useRef(new Set<() => void>());
  const abone = useCallback((geriCagri: () => void) => {
    aboneler.current.add(geriCagri);
    return () => { aboneler.current.delete(geriCagri); };
  }, []);

  /*
   * Son görülen seq bir REF'te tutulur, state'te değil: yoklama döngüsü
   * kapanışta yakaladığı değeri değil, O ANKİ değeri karşılaştırmalı.
   * (Oturumda aynı hatayı bir kez yaptık: state'teki jeton kapanışta eskiyordu.)
   */
  const sonTur = useRef<string | null>(null);

  const bak = useCallback(async () => {
    const taze = await request<TurBilgisi>('/tick');
    const ilerledi = sonTur.current !== null && taze.tamamlanan !== sonTur.current;
    sonTur.current = taze.tamamlanan;
    setTur(taze);
    setIsleniyor(taze.sonraki === null || new Date(taze.sonraki).getTime() <= Date.now());
    if (ilerledi) for (const f of aboneler.current) f();
    return ilerledi;
  }, []);

  // İlk okuma ve ön plana dönüş: ikisi de "şu an ne durumdayız" sorusudur.
  useEffect(() => {
    if (!girisli) { setTur(null); sonTur.current = null; return; }
    void bak().catch(() => { /* ağ yoksa geri sayım yerel devam eder */ });
    const izle = AppState.addEventListener('change', (durum) => {
      if (durum === 'active') void bak().catch(() => { /* aynı sebep */ });
    });
    return () => izle.remove();
  }, [girisli, bak]);

  /*
   * Yoklama yalnız turun saati geldiğinde başlar. Saat gelmediyse hiçbir
   * istek gitmez — geri sayım tamamen yereldir.
   */
  useEffect(() => {
    if (!girisli || !tur) return;
    const kalan = tur.sonraki === null ? 0 : new Date(tur.sonraki).getTime() - Date.now();
    if (kalan > 0) {
      // Saat gelince bir kez bak; sonucu bu etkiyi yeniden kurar.
      const t = setTimeout(() => setIsleniyor(true), kalan + 250);
      return () => clearTimeout(t);
    }

    let durduruldu = false;
    let adim = 0;
    let zaman: ReturnType<typeof setTimeout>;
    const dongu = () => {
      zaman = setTimeout(() => {
        if (durduruldu) return;
        void bak()
          .then((ilerledi) => { if (!ilerledi && !durduruldu) { adim++; dongu(); } })
          .catch(() => { if (!durduruldu) { adim++; dongu(); } });
      }, ARALIKLAR_MS[adim] ?? SON_ARALIK_MS);
    };
    dongu();
    return () => { durduruldu = true; clearTimeout(zaman); };
  }, [girisli, tur, bak]);

  const deger = useMemo<TurDurumu>(() => ({
    tamamlanan: tur?.tamamlanan ?? null,
    sonraki: tur?.sonraki ?? null,
    isleniyor,
    abone,
  }), [tur, isleniyor, abone]);

  return <Baglam.Provider value={deger}>{children}</Baglam.Provider>;
}

export function useTur(): TurDurumu {
  const d = useContext(Baglam);
  if (!d) throw new Error('useTur, TurSaglayici içinde kullanılmalı');
  return d;
}

/**
 * Tur ilerleyince verilen işi çalıştırır — ekranlar kendini böyle tazeler.
 *
 * ★ Geri çağrı bir REF üzerinden çağrılır: ekran her çizimde yeni bir kapanış
 * verse bile abonelik bir kez kurulur. Doğrudan bağımlılığa koysaydık her
 * çizimde abone olup çıkardık.
 */
export function useTurDegisince(geriCagri: () => void): void {
  const { abone } = useTur();
  const son = useRef(geriCagri);
  son.current = geriCagri;
  useEffect(() => abone(() => son.current()), [abone]);
}
