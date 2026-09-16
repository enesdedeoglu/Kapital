import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { useTurDegisince } from '~/tur';
import { ApiError } from '~/api/client';
import type { Lot, Raf, Sevkiyat, Tesis, TesisStok, SehirBilgi, Sirket, TesisTuru, OtomatikKural, Uretim, Urun } from '~/api/types';
import { Etiket, Kart, tesisIkonu } from '~/ui/parcalar';
import { tesisEtiketi } from '~/ui/tesisEtiketi';
import { LotPaneli } from '~/ui/LotPaneli';
import { RafPaneli, type RafGirdisi } from '~/ui/RafPaneli';
import { bosluk, renk, yaziTipi, yuvarlak } from '~/ui/tema';
import { TesisPaneli, type KurmaGirdisi } from '~/ui/TesisPaneli';
import { YukseltmePaneli } from '~/ui/YukseltmePaneli';
import { OtomatikPaneli, type KuralGirdisi } from '~/ui/OtomatikPaneli';
import { UretimPaneli } from '~/ui/UretimPaneli';
import { YoldaOzet } from '~/ui/YoldakiMal';

export default function Sirketim() {
  const { iste } = useOturum();
  const kenar = useSafeAreaInsets();
  const [tesisler, setTesisler] = useState<Tesis[] | null>(null);
  const [stoklar, setStoklar] = useState<Record<string, TesisStok>>({});
  const [yolda, setYolda] = useState<Sevkiyat[]>([]);
  const [acik, setAcik] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);

  // Lot paneli
  const [lotBaslik, setLotBaslik] = useState<{ ad: string; birim: string } | null>(null);
  const [lotlar, setLotlar] = useState<Lot[] | null>(null);

  // Raf paneli
  const [rafTesis, setRafTesis] = useState<Tesis | null>(null);
  const [raf, setRaf] = useState<Raf | null>(null);
  const [bildirim, setBildirim] = useState<string | null>(null);

  /*
   * Üretim paneli. Tesis kurulunca reçetesi kendiliğinden atanıyor (R96), yani
   * burada "ne üreteyim" diye sorulmuyor; panel ÜRETİYOR MU sorusunu
   * cevaplıyor: tur başına kaç birim, girdiler yetiyor mu, neden durdu.
   */
  const [uretimTesis, setUretimTesis] = useState<Tesis | null>(null);
  const [uretim, setUretim] = useState<Uretim | null>(null);

  /*
   * Kurma paneli. Tür ve şehir listesi TEMBEL çekilir: sekme her açıldığında
   * iki istek daha atmak, oyuncuların çoğunun kullanmadığı bir panel için
   * açılışı geciktirirdi.
   */
  const [kurmaAcik, setKurmaAcik] = useState(false);
  const [turler, setTurler] = useState<TesisTuru[]>([]);
  const [sehirler, setSehirler] = useState<SehirBilgi[]>([]);
  const [sirket, setSirket] = useState<Sirket | null>(null);
  const [kurmaYukleniyor, setKurmaYukleniyor] = useState(false);

  /*
   * Yükseltme paneli. Kasa burada da gerekli ve kurma panelininki TEMBEL
   * çekiliyor; bu yüzden şirket künyesi tesislerle BİRLİKTE alınır.
   */
  const [yukseltilecek, setYukseltilecek] = useState<Tesis | null>(null);

  /*
   * Otomatik sipariş paneli. Kurallar ve ürün listesi TEMBEL çekilir —
   * panel açılmadan ihtiyaç yok; sekme açılışını yavaşlatmasın.
   */
  const [otomatikTesis, setOtomatikTesis] = useState<Tesis | null>(null);
  const [kurallar, setKurallar] = useState<OtomatikKural[]>([]);
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [otomatikYukleniyor, setOtomatikYukleniyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      const [liste, sr] = await Promise.all([
        iste<Tesis[]>('/facilities'),
        iste<Sirket>('/company'),
      ]);
      setTesisler(liste);
      setSirket(sr);
      /*
       * Stoklar PARALEL: tesis sayısı kadar sıralı istek ekranı geciktirir.
       * Kimliği stokla birlikte taşırız — sonradan indeksle eşleştirmek
       * dizilerin aynı sırada döndüğü VARSAYIMINA dayanırdı.
       */
      const stok = await Promise.all(
        liste.map(async (t) => [t.id, await iste<TesisStok>(`/facilities/${t.id}/stock`)] as const),
      );
      setStoklar(Object.fromEntries(stok));
      setAcik((a) => a ?? liste[0]?.id ?? null);
      // Yoldaki mal tesis kartında gösterilir: "depo boş" ile "boş ama
      // geliyor" aynı şey değil.
      try {
        setYolda(await iste<Sevkiyat[]>('/market/shipments'));
      } catch {
        setYolda([]);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setTesisler([]);
      else setHata(e instanceof ApiError ? e.message : 'Sunucuya ulaşılamadı');
    }
  }, [iste]);

  useEffect(() => { void yukle(); }, [yukle]);
  // Tur düşünce ekran kendini tazeler.
  useTurDegisince(() => { void yukle(); });

  const kurmayiAc = useCallback(async () => {
    setKurmaAcik(true);
    setKurmaYukleniyor(true);
    try {
      // Şirket künyesi `yukle`de zaten alındı; burada tür ve şehir listesi yeter.
      const [t, c] = await Promise.all([
        iste<TesisTuru[]>('/facility-types'),
        iste<SehirBilgi[]>('/cities'),
      ]);
      setTurler(t);
      setSehirler(c);
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Tesis türleri alınamadı');
      setKurmaAcik(false);
    } finally {
      setKurmaYukleniyor(false);
    }
  }, [iste]);

  /*
   * Kurma isteği. Hata MESAJI döner (null = başarılı) — panel kendi hatasını
   * kendi gösterir, ekran onun yerine karar vermez (EmirPaneli ile aynı sözleşme).
   */
  const kur = useCallback(async (g: KurmaGirdisi): Promise<string | null> => {
    try {
      await iste('/facilities', { method: 'POST', body: g });
      setBildirim('Tesis kuruldu — inşaat başladı.');
      void yukle();
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Tesis kurulamadı';
    }
  }, [iste, yukle]);

  const yukselt = useCallback(async (tesisId: string): Promise<string | null> => {
    try {
      await iste(`/facilities/${tesisId}/upgrade`, { method: 'POST' });
      setBildirim('Tesis yükseltildi.');
      void yukle();
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Yükseltme yapılamadı';
    }
  }, [iste, yukle]);

  const kurallariYukle = useCallback(async () => {
    setKurallar(await iste<OtomatikKural[]>('/standing-orders'));
  }, [iste]);

  const otomatigiAc = useCallback(async (t: Tesis) => {
    setOtomatikTesis(t);
    setOtomatikYukleniyor(true);
    try {
      const [u] = await Promise.all([
        iste<Urun[]>('/products'),
        kurallariYukle(),
      ]);
      setUrunler(u);
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Kurallar alınamadı');
      setOtomatikTesis(null);
    } finally {
      setOtomatikYukleniyor(false);
    }
  }, [iste, kurallariYukle]);

  const kuralKaydet = useCallback(async (g: KuralGirdisi): Promise<string | null> => {
    try {
      await iste('/standing-orders', { method: 'PUT', body: g });
      setBildirim('Otomatik sipariş kuralı kaydedildi.');
      await kurallariYukle();
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Kural kaydedilemedi';
    }
  }, [iste, kurallariYukle]);

  const kuralSil = useCallback(async (id: string): Promise<string | null> => {
    try {
      await iste(`/standing-orders/${id}`, { method: 'DELETE' });
      await kurallariYukle();
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Kural silinemedi';
    }
  }, [iste, kurallariYukle]);

  const lotlariAc = useCallback(async (tesisId: string, urunId: number, ad: string, birim: string) => {
    setLotBaslik({ ad, birim });
    setLotlar(null);
    try {
      setLotlar(await iste<Lot[]>(`/facilities/${tesisId}/batches?productId=${urunId}`));
    } catch {
      setLotlar([]);
    }
  }, [iste]);

  const rafiAc = useCallback(async (t: Tesis) => {
    setRafTesis(t);
    setRaf(null);
    try {
      setRaf(await iste<Raf>(`/retail/${t.id}`));
    } catch {
      setRaf({ offers: [], addable: [] });
    }
  }, [iste]);

  const uretimiAc = useCallback(async (t: Tesis) => {
    setUretimTesis(t);
    setUretim(null);
    try {
      setUretim(await iste<Uretim>(`/facilities/${t.id}/production`));
    } catch (e) {
      setUretimTesis(null);
      setHata(e instanceof ApiError ? e.message : 'Üretim bilgisi alınamadı');
    }
  }, [iste]);

  /*
   * Üretimi aç/kapat. Uç reçeteyi de alır (`outputProductCode`): panel onu
   * zaten biliyor, ayrı bir "duraklat" ucu açmaya gerek yok.
   */
  const uretimiDegistir = useCallback(
    async (tesisId: string, urunKodu: string, acik: boolean): Promise<string | null> => {
      try {
        await iste(`/facilities/${tesisId}/recipe`, {
          method: 'POST', body: { outputProductCode: urunKodu, enabled: acik },
        });
        setUretim(await iste<Uretim>(`/facilities/${tesisId}/production`));
        // Rozet `productionState`e bakıyor; tesis listesi de tazelenmeli.
        setTesisler(await iste<Tesis[]>('/facilities'));
        setBildirim(acik ? 'Üretim başlatıldı.' : 'Üretim durduruldu.');
        return null;
      } catch (e) {
        return e instanceof ApiError ? e.message : 'Üretim durumu değiştirilemedi';
      }
    }, [iste]);

  const rafKaydet = useCallback(async (girdi: RafGirdisi[]): Promise<string | null> => {
    if (!rafTesis) return 'Tesis seçili değil';
    try {
      await iste(`/retail/${rafTesis.id}/prices`, { method: 'PUT', body: { prices: girdi } });
      setBildirim('Raf fiyatları güncellendi.');
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Fiyatlar kaydedilemedi';
    }
  }, [iste, rafTesis]);

  useEffect(() => {
    if (!bildirim) return;
    const t = setTimeout(() => setBildirim(null), 3000);
    return () => clearTimeout(t);
  }, [bildirim]);

  if (tesisler === null && !hata) {
    return <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>;
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={[s.icerik, { paddingTop: kenar.top + 56 }]}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor} tintColor={renk.soluk}
            onRefresh={() => { setYenileniyor(true); void yukle().finally(() => setYenileniyor(false)); }}
          />
        }
      >
        {bildirim && (
          <View style={s.bildirim}>
            <MCI name="check-circle-outline" size={16} color={renk.artı} />
            <Text style={s.bildirimYazi}>{bildirim}</Text>
          </View>
        )}

        {hata && (
          <Kart style={s.hataKart}>
            <Etiket ikon="wifi-off" yazi="HATA" ton={renk.eksi} />
            <Text style={s.hata}>{hata}</Text>
          </Kart>
        )}

        {tesisler?.length === 0 && !hata && (
          <View style={s.bosDurum}>
            <MCI name="storefront-outline" size={44} color={renk.altin} />
            <Text style={s.bosBaslik}>Henüz tesisin yok</Text>
            <Text style={s.bosAlt}>İlk dükkânını aç, mal al, rafa koy ve sat.</Text>
          </View>
        )}

        {tesisler?.map((t) => {
          const stok = stoklar[t.id];
          const acikMi = acik === t.id;
          return (
            <Kart key={t.id}>
              <Pressable onPress={() => setAcik(acikMi ? null : t.id)}>
                <View style={s.ustSatir}>
                  <View style={s.ikonKutu}>
                    <MCI name={tesisIkonu[t.type.category] ?? 'domain'} size={22} color={renk.altin} />
                  </View>
                  <View style={s.kimlik}>
                    <Text style={s.tesisAd}>{t.name}</Text>
                    <Text style={s.tesisAlt}>
                      {t.type.name} · {t.city.name} · Lv{t.level}
                    </Text>
                  </View>
                  <MCI
                    name={acikMi ? 'chevron-up' : 'chevron-down'}
                    size={22} color={renk.soluk}
                  />
                </View>

                {/*
                  Durum rozetleri: inşaat / üretim durumu tek bakışta.

                  ★ ROZET `productionState`e BAKAR, `productionEnabled`e DEĞİL.
                  O sütunun varsayılanı TRUE ve tarifi olmayan tesiste de TRUE
                  kalıyordu: hiçbir şey üretmeyen Sebze Bahçesi'ne yeşil
                  "çalışıyor" yazıyorduk (R96). Ölçüldü — kurulumdan 7 tur
                  sonra depo boş, rozet yeşil.

                  ★ Üretmeyen tesise (manav, büfe, liman) üretim rozeti
                  BASILMAZ: "durdu" demek, olmayan bir yeteneği arızalı gibi
                  göstermekti.
                */}
                <View style={s.rozetSatir}>
                  {t.isUnderConstruction
                    ? <Rozet ikon="hammer-wrench" yazi={`${t.ticksRemaining} tur inşaat`} ton={renk.uyari} />
                    : t.productionState === 'RUNNING' && t.producedProduct
                      ? <Rozet ikon="play-circle" yazi={`${t.producedProduct.name} üretiyor`} ton={renk.artı} />
                      : t.productionState === 'PAUSED'
                        ? <Rozet ikon="pause-circle" yazi="üretim durdu" ton={renk.eksi} />
                        : t.productionState === 'NO_RECIPE'
                          ? <Rozet ikon="alert-circle-outline" yazi="tarif yok" ton={renk.eksi} />
                          : null}
                  <Rozet ikon="heart-pulse" yazi={`durum %${Number(t.condition).toFixed(0)}`} />
                </View>

                {/*
                  Depo doluluk çubuğu — sayı yerine görülen bir oran.
                  ★ `storageUsedPct` ZATEN YÜZDEDİR (0–100), kesir değil:
                  `facility.service.ts` → (used × 10000 ÷ capacity) ÷ 100.
                  100 ile çarpınca çubuk "%1416" gösteriyordu.
                */}
                <View style={s.depoSatir}>
                  <Text style={s.depoEtiket}>DEPO</Text>
                  <View style={s.cubukDis}>
                    <View style={[s.cubukIc, {
                      width: `${Math.min(100, Math.max(2, t.storageUsedPct))}%`,
                      backgroundColor: t.storageUsedPct > 90 ? renk.eksi
                        : t.storageUsedPct > 70 ? renk.uyari : renk.mavi,
                    }]} />
                  </View>
                  <Text style={s.depoYuzde}>%{t.storageUsedPct.toFixed(0)}</Text>
                </View>
              </Pressable>

              {/*
                ★ Üretim düğmesi YALNIZ üreten tesiste. İNŞAAT SIRASINDA DA
                görünür (yükseltmenin aksine): "bu şey bir şey yapacak mı"
                sorusu en çok o sırada sorulur ve panel tam onu cevaplıyor.
              */}
              {acikMi && t.productionState !== 'NONE' && (
                <Pressable style={s.uretimDugme} onPress={() => void uretimiAc(t)}>
                  <MCI name="factory" size={16} color={renk.mavi} />
                  <Text style={s.uretimYazi}>
                    {t.producedProduct ? `Üretim · ${t.producedProduct.name}` : 'Üretim'}
                  </Text>
                  <MCI name="chevron-right" size={18} color={renk.mavi} />
                </Pressable>
              )}

              {/*
                ★ Raf fiyatı YALNIZ perakende tesisinde anlamlı: fabrikanın
                rafı yoktur, malını toptan piyasada satar. Düğmeyi her tesise
                koymak "neden çalışmıyor" sorusunu doğururdu.
              */}
              {acikMi && t.type.category === 'RETAIL' && (
                <Pressable style={s.rafDugme} onPress={() => void rafiAc(t)}>
                  <MCI name="tag-multiple-outline" size={16} color={renk.altin} />
                  <Text style={s.rafDugmeYazi}>Raf ve fiyatlar</Text>
                  <MCI name="chevron-right" size={18} color={renk.altin} />
                </Pressable>
              )}

              {/*
                ★ Yükseltme düğmesi HER tesiste var (rafın aksine), ama
                inşaattayken YOK: henüz kurulmamış bir tesisi yükseltmek
                oyuncuyu şaşırtır ve sunucu da reddeder.
              */}
              {acikMi && !t.isUnderConstruction && (
                <Pressable style={s.yukseltDugme} onPress={() => setYukseltilecek(t)}>
                  <MCI name="arrow-up-bold-hexagon-outline" size={16} color={renk.mor} />
                  <Text style={s.yukseltYazi}>
                    {t.upgrade.atMaxLevel
                      ? `En yüksek seviye (Lv${t.upgrade.maxLevel})`
                      : `Lv${t.upgrade.nextLevel}'ye yükselt · ${t.upgrade.costFormatted}`}
                  </Text>
                  <MCI name="chevron-right" size={18} color={renk.mor} />
                </Pressable>
              )}

              {/*
                ★ Otomatik sipariş HER tesiste anlamlı (rafın aksine): fabrika
                da girdisini otomatik alabilir, fazlasını otomatik satabilir.
                İnşaattayken gizli — henüz üretmeyen tesise kural kurmak
                oyuncuyu şaşırtır.
              */}
              {acikMi && !t.isUnderConstruction && (
                <Pressable style={s.otomatikDugme} onPress={() => void otomatigiAc(t)}>
                  <MCI name="autorenew" size={16} color={renk.artı} />
                  <Text style={s.otomatikYazi}>Otomatik sipariş</Text>
                  <MCI name="chevron-right" size={18} color={renk.artı} />
                </Pressable>
              )}

              {acikMi && <YoldaOzet sevkiyatlar={yolda.filter((v) => v.toFacilityId === t.id)} />}

              {acikMi && stok && (
                stok.products.length === 0
                  ? <Text style={s.bosStok}>Depo boş.</Text>
                  : (
                    <View style={s.stokKap}>
                      <View style={s.stokBas}>
                        <Text style={[s.bas, s.urunSutun]}>ürün</Text>
                        <Text style={[s.bas, s.saySutun]}>miktar</Text>
                        <Text style={[s.bas, s.kaliteSutun]}>kalite</Text>
                        <Text style={[s.bas, s.maliyetSutun]}>ort. maliyet</Text>
                      </View>
                      {stok.products.map((u) => (
                        <Pressable
                          key={u.productId} style={s.stokSatir}
                          onPress={() => void lotlariAc(t.id, u.productId, u.name, u.unit)}
                        >
                          <View style={s.urunSutun}>
                            <Text style={s.urunAd}>{u.name}</Text>
                            {u.batchCount > 1 && (
                              <Text style={s.lotSayisi}>{u.batchCount} lot ›</Text>
                            )}
                          </View>
                          <Text style={[s.sayi, s.saySutun]}>
                            {u.totalFormatted.replace(` ${u.unit}`, '')}
                          </Text>
                          <Text style={[s.sayi, s.kaliteSutun, kaliteRengi(u.avgQuality)]}>
                            {u.avgQuality.toFixed(0)}
                          </Text>
                          <Text style={[s.sayi, s.maliyetSutun]}>
                            {u.weightedAvgCostFormatted.replace(' ₺', '')}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )
              )}
            </Kart>
          );
        })}
      
        {/*
          ★ Düğme listenin SONUNDA. Boş durumda da, dolu listede de aynı yerde:
          "bir tane daha" eylemi listenin akışının devamıdır. Üstte dursaydı
          asıl içeriği (tesislerin durumu) aşağı iterdi.
        */}
        {tesisler !== null && !hata && (
          <Pressable style={s.kurDugme} onPress={() => void kurmayiAc()}>
            <MCI name="plus-circle-outline" size={19} color={renk.altin} />
            <Text style={s.kurYazi}>
              {tesisler.length === 0 ? 'İlk tesisini kur' : 'Yeni tesis kur'}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <OtomatikPaneli
        tesis={otomatikTesis}
        kurallar={kurallar}
        urunler={urunler}
        seviye={sirket?.level ?? 1}
        yukleniyor={otomatikYukleniyor}
        kapat={() => setOtomatikTesis(null)}
        kaydet={kuralKaydet}
        sil={kuralSil}
      />

      <YukseltmePaneli
        tesis={yukseltilecek}
        nakit={sirket?.cash ?? '0'}
        kapat={() => setYukseltilecek(null)}
        gonder={yukselt}
      />

      <TesisPaneli
        acik={kurmaAcik}
        turler={turler}
        sehirler={sehirler}
        nakit={sirket?.cash ?? '0'}
        seviye={sirket?.level ?? 1}
        yukleniyor={kurmaYukleniyor}
        kapat={() => setKurmaAcik(false)}
        gonder={kur}
      />

      <RafPaneli
        acik={rafTesis !== null}
        tesisAdi={rafTesis ? tesisEtiketi(rafTesis) : ''}
        raf={raf}
        kapat={() => { setRafTesis(null); setRaf(null); }}
        kaydet={rafKaydet}
      />

      <UretimPaneli
        tesis={uretimTesis}
        uretim={uretim}
        kapat={() => { setUretimTesis(null); setUretim(null); }}
        degistir={uretimiDegistir}
      />

      <LotPaneli
        acik={lotBaslik !== null}
        urunAdi={lotBaslik?.ad ?? ''}
        birim={lotBaslik?.birim ?? ''}
        lotlar={lotlar}
        kapat={() => { setLotBaslik(null); setLotlar(null); }}
      />
    </>
  );
}

function Rozet({ ikon, yazi, ton = renk.soluk }: {
  ikon: React.ComponentProps<typeof MCI>['name']; yazi: string; ton?: string;
}) {
  return (
    <View style={s.rozet}>
      <MCI name={ikon} size={13} color={ton} />
      <Text style={[s.rozetYazi, { color: ton }]}>{yazi}</Text>
    </View>
  );
}

function kaliteRengi(q: number) {
  if (q >= 70) return { color: renk.artı };
  if (q >= 45) return { color: renk.uyari };
  return { color: renk.eksi };
}

const s = StyleSheet.create({
  icerik: { padding: bosluk.l, paddingBottom: 110, gap: bosluk.m },
  orta: { flex: 1, justifyContent: 'center' },

  bildirim: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(61,220,151,0.12)', borderWidth: 1,
    borderColor: 'rgba(61,220,151,0.35)', borderRadius: yuvarlak.m,
    paddingHorizontal: bosluk.m, paddingVertical: 10,
  },
  bildirimYazi: { color: renk.artı, fontSize: 13, fontFamily: yaziTipi.govdeOrta },

  rafDugme: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: bosluk.m,
    paddingVertical: 10, paddingHorizontal: bosluk.m, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(255,194,75,0.10)', borderWidth: 1,
    borderColor: 'rgba(255,194,75,0.35)',
  },
  rafDugmeYazi: { color: renk.altin, fontSize: 14, fontFamily: yaziTipi.baslikOrta, flex: 1 },
  uretimDugme: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: bosluk.m,
    paddingVertical: 10, paddingHorizontal: bosluk.m, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(90,160,255,0.10)', borderWidth: 1,
    borderColor: 'rgba(90,160,255,0.35)',
  },
  uretimYazi: { color: renk.mavi, fontSize: 14, fontFamily: yaziTipi.baslikOrta, flex: 1 },

  otomatikDugme: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 10, paddingHorizontal: bosluk.m, marginTop: bosluk.s,
    borderRadius: yuvarlak.m, borderWidth: 1, borderColor: 'rgba(61,220,151,0.4)',
    backgroundColor: 'rgba(61,220,151,0.08)',
  },
  otomatikYazi: { color: renk.artı, fontSize: 14, fontFamily: yaziTipi.govdeOrta, flex: 1 },

  yukseltDugme: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 10, paddingHorizontal: bosluk.m, marginTop: bosluk.s,
    borderRadius: yuvarlak.m, borderWidth: 1, borderColor: 'rgba(139,92,246,0.4)',
    backgroundColor: 'rgba(139,92,246,0.08)',
  },
  yukseltYazi: { color: renk.mor, fontSize: 14, fontFamily: yaziTipi.govdeOrta, flex: 1 },

  kurDugme: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingVertical: bosluk.m, borderRadius: yuvarlak.m,
    borderWidth: 1, borderStyle: 'dashed', borderColor: renk.altinKoyu,
    backgroundColor: 'rgba(255,194,75,0.06)',
  },
  kurYazi: { color: renk.altin, fontSize: 15, fontFamily: yaziTipi.baslikOrta },

  hataKart: { borderColor: renk.eksi },
  hata: { color: renk.eksi, fontSize: 14, fontFamily: yaziTipi.govde },

  bosDurum: { alignItems: 'center', gap: bosluk.xs, paddingVertical: bosluk.xxl },
  bosBaslik: { color: renk.metin, fontSize: 22, fontFamily: yaziTipi.baslik },
  bosAlt: { color: renk.soluk, fontSize: 14, fontFamily: yaziTipi.govde },

  ustSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.m },
  ikonKutu: {
    width: 42, height: 42, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(255,194,75,0.12)', borderWidth: 1,
    borderColor: 'rgba(255,194,75,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  kimlik: { flex: 1 },
  tesisAd: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.baslik },
  tesisAlt: { color: renk.soluk, fontSize: 12, fontFamily: yaziTipi.govde },

  rozetSatir: { flexDirection: 'row', gap: bosluk.s, marginTop: bosluk.m, flexWrap: 'wrap' },
  rozet: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: yuvarlak.tam,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: renk.kenar,
  },
  rozetYazi: { fontSize: 11, fontFamily: yaziTipi.govdeOrta },

  depoSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginTop: bosluk.m },
  depoEtiket: { color: renk.cokSoluk, fontSize: 10, fontFamily: yaziTipi.etiket, letterSpacing: 0.8 },
  cubukDis: {
    flex: 1, height: 7, borderRadius: 4, backgroundColor: renk.zeminAlt,
    borderWidth: 1, borderColor: renk.kenar, overflow: 'hidden',
  },
  cubukIc: { height: '100%' },
  depoYuzde: { color: renk.soluk, fontSize: 12, fontFamily: yaziTipi.rakam, width: 36, textAlign: 'right' },

  stokKap: { marginTop: bosluk.m, borderTopWidth: 1, borderTopColor: renk.kenar, paddingTop: bosluk.s },
  bosStok: { color: renk.cokSoluk, fontSize: 13, fontFamily: yaziTipi.govde, marginTop: bosluk.m },
  stokBas: { flexDirection: 'row', paddingBottom: 6 },
  bas: { color: renk.cokSoluk, fontSize: 10, fontFamily: yaziTipi.etiket, letterSpacing: 0.6 },
  stokSatir: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: renk.kenar,
  },
  urunSutun: { flex: 1 },
  urunAd: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govdeOrta },
  lotSayisi: { color: renk.mavi, fontSize: 11, fontFamily: yaziTipi.govde },
  sayi: { color: renk.soluk, fontSize: 14, fontFamily: yaziTipi.rakam },
  saySutun: { width: 58, textAlign: 'right' },
  kaliteSutun: { width: 52, textAlign: 'right' },
  maliyetSutun: { width: 74, textAlign: 'right' },
});
