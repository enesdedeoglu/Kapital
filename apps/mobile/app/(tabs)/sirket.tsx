import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { ApiError } from '~/api/client';
import type { Lot, Tesis, TesisStok } from '~/api/types';
import { Etiket, Kart } from '~/ui/parcalar';
import { LotPaneli } from '~/ui/LotPaneli';
import { bosluk, renk, yaziTipi, yuvarlak } from '~/ui/tema';

/** Tesis türüne göre ikon — kart tek bakışta ne olduğunu söylesin. */
const tesisIkonu: Record<string, React.ComponentProps<typeof MCI>['name']> = {
  RETAIL: 'storefront',
  FARM: 'sprout',
  MINE: 'pickaxe',
  FACTORY: 'factory',
  WAREHOUSE: 'warehouse',
};

export default function Sirketim() {
  const { iste } = useOturum();
  const kenar = useSafeAreaInsets();
  const [tesisler, setTesisler] = useState<Tesis[] | null>(null);
  const [stoklar, setStoklar] = useState<Record<string, TesisStok>>({});
  const [acik, setAcik] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);

  // Lot paneli
  const [lotBaslik, setLotBaslik] = useState<{ ad: string; birim: string } | null>(null);
  const [lotlar, setLotlar] = useState<Lot[] | null>(null);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      const liste = await iste<Tesis[]>('/facilities');
      setTesisler(liste);
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
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setTesisler([]);
      else setHata(e instanceof ApiError ? e.message : 'Sunucuya ulaşılamadı');
    }
  }, [iste]);

  useEffect(() => { void yukle(); }, [yukle]);

  const lotlariAc = useCallback(async (tesisId: string, urunId: number, ad: string, birim: string) => {
    setLotBaslik({ ad, birim });
    setLotlar(null);
    try {
      setLotlar(await iste<Lot[]>(`/facilities/${tesisId}/batches?productId=${urunId}`));
    } catch {
      setLotlar([]);
    }
  }, [iste]);

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
            <Text style={s.bosAlt}>İlk dükkânını açınca burada görünecek.</Text>
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

                {/* Durum rozetleri: inşaat / üretim durumu tek bakışta. */}
                <View style={s.rozetSatir}>
                  {t.isUnderConstruction
                    ? <Rozet ikon="hammer-wrench" yazi={`${t.ticksRemaining} tur inşaat`} ton={renk.uyari} />
                    : t.productionEnabled
                      ? <Rozet ikon="play-circle" yazi="çalışıyor" ton={renk.artı} />
                      : <Rozet ikon="pause-circle" yazi="durdu" ton={renk.eksi} />}
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
      </ScrollView>

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
