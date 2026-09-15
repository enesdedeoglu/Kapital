import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { ApiError } from '~/api/client';
import type { Defter, Urun } from '~/api/types';
import { Etiket, Kart } from '~/ui/parcalar';
import { bosluk, renk, yaziTipi, yuvarlak } from '~/ui/tema';

export default function Piyasa() {
  const { iste } = useOturum();
  const kenar = useSafeAreaInsets();
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [secili, setSecili] = useState<string | null>(null);
  const [defter, setDefter] = useState<Defter | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yenileniyor, setYenileniyor] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const liste = await iste<Urun[]>('/products');
        setUrunler(liste);
        setSecili((s) => s ?? liste[0]?.code ?? null);
      } catch (e) {
        setHata(e instanceof ApiError ? e.message : 'Ürünler alınamadı');
      }
    })();
  }, [iste]);

  const defteriYukle = useCallback(async (kod: string) => {
    setYukleniyor(true);
    try {
      setHata(null);
      setDefter(await iste<Defter>(`/market/book/${kod}`));
    } catch (e) {
      setDefter(null);
      setHata(e instanceof ApiError ? e.message : 'Defter alınamadı');
    } finally {
      setYukleniyor(false);
    }
  }, [iste]);

  useEffect(() => { if (secili) void defteriYukle(secili); }, [secili, defteriYukle]);

  return (
    <ScrollView
      contentContainerStyle={[s.icerik, { paddingTop: kenar.top + 56 }]}
      refreshControl={
        <RefreshControl
          refreshing={yenileniyor} tintColor={renk.soluk}
          onRefresh={() => {
            if (!secili) return;
            setYenileniyor(true);
            void defteriYukle(secili).finally(() => setYenileniyor(false));
          }}
        />
      }
    >
      {/* Ürün seçici — yatay şerit. Mobilde açılır liste bir dokunuş fazla. */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.seritIcerik} style={s.serit}
      >
        {urunler.map((u) => {
          const aktif = u.code === secili;
          return (
            <Pressable key={u.code} onPress={() => setSecili(u.code)}
              style={[s.pul, aktif && s.pulAktif]}>
              <Text style={[s.pulYazi, aktif && s.pulYaziAktif]}>{u.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {hata && (
        <Kart style={s.hataKart}>
          <Etiket ikon="wifi-off" yazi="HATA" ton={renk.eksi} />
          <Text style={s.hata}>{hata}</Text>
        </Kart>
      )}

      {yukleniyor && !defter && (
        <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>
      )}

      {defter && (
        <>
          <Kart>
            <Etiket ikon="tag-outline" yazi="SATIŞTA" />
            {defter.sell.length === 0
              ? <Text style={s.bos}>Bu üründe satış emri yok.</Text>
              : (
                <>
                  {/*
                    ★ Madde 16: mal / nakliye / TOPLAM ayrı gösterilir ve liste
                    TOPLAMA göre sıralıdır — alıcının ödediği odur, eşleştirme
                    motoru da ona bakar.
                  */}
                  <View style={s.basSatir}>
                    <Text style={[s.basYazi, s.solSutun]}>satıcı</Text>
                    <Text style={[s.basYazi, s.saySutun]}>mal</Text>
                    <Text style={[s.basYazi, s.saySutun]}>nakliye</Text>
                    <Text style={[s.basYazi, s.saySutun, s.toplamBas]}>toplam</Text>
                  </View>
                  {defter.sell.slice(0, 12).map((o, i) => (
                    <View key={o.orderId} style={[s.satir, i === 0 && s.enUcuz]}>
                      <View style={s.solSutun}>
                        <Text style={s.satici} numberOfLines={1}>{o.seller.name}</Text>
                        <View style={s.altBilgi}>
                          <Text style={s.kucuk}>{o.city.code}</Text>
                          {o.transitTicks > 0 && (
                            <Text style={s.kucuk}>· {o.transitTicks} tur yol</Text>
                          )}
                          <Text style={s.kucuk}>· kal {o.quality.toFixed(0)}</Text>
                        </View>
                      </View>
                      <Text style={[s.sayi, s.saySutun]}>{kisalt(o.goodsPriceFormatted)}</Text>
                      <Text style={[s.sayi, s.saySutun, s.nakliye]}>
                        {kisalt(o.shippingPerUnitFormatted)}
                      </Text>
                      <Text style={[s.sayi, s.saySutun, s.toplam]}>
                        {kisalt(o.totalPerUnitFormatted)}
                      </Text>
                    </View>
                  ))}
                </>
              )}
          </Kart>

          <Kart>
            <Etiket ikon="cart-outline" yazi="ALIM TALEBİ" ton={renk.mavi} />
            {defter.buy.length === 0
              ? <Text style={s.bos}>Bu üründe alış emri yok.</Text>
              : defter.buy.slice(0, 8).map((o) => (
                <View key={o.orderId} style={s.satir}>
                  <View style={s.solSutun}>
                    <Text style={s.satici} numberOfLines={1}>{o.buyer}</Text>
                    <Text style={s.kucuk}>{o.cityCode} · min kal {o.minQuality.toFixed(0)}</Text>
                  </View>
                  <Text style={[s.sayi, s.alisSutun]}>{kisalt(o.maxTotalPerUnitFormatted)}</Text>
                </View>
              ))}
          </Kart>

          <View style={s.notSatir}>
            <MCI name="information-outline" size={13} color={renk.cokSoluk} />
            <Text style={s.not}>
              Toplam = mal + nakliye. Liste toplama göre sıralı; en üstteki
              gerçekten en ucuzdur.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

/** "23,22 ₺" → "23,22" — sütun başlığı birimi zaten söylüyor, tekrar etmesin. */
function kisalt(bicimli: string): string {
  return bicimli.replace(' ₺', '');
}

const s = StyleSheet.create({
  icerik: { padding: bosluk.l, paddingBottom: 110, gap: bosluk.m },
  orta: { paddingVertical: bosluk.xxl },

  serit: { marginHorizontal: -bosluk.l },
  seritIcerik: { paddingHorizontal: bosluk.l, gap: bosluk.s },
  pul: {
    paddingHorizontal: bosluk.l, paddingVertical: 9, borderRadius: yuvarlak.tam,
    backgroundColor: renk.kart, borderWidth: 1, borderColor: renk.kenar,
  },
  pulAktif: { backgroundColor: 'rgba(255,194,75,0.16)', borderColor: renk.altin },
  pulYazi: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  pulYaziAktif: { color: renk.altin, fontFamily: yaziTipi.baslikOrta },

  hataKart: { borderColor: renk.eksi },
  hata: { color: renk.eksi, fontSize: 14, fontFamily: yaziTipi.govde },
  bos: { color: renk.cokSoluk, fontSize: 13, fontFamily: yaziTipi.govde, paddingVertical: 6 },

  basSatir: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.s,
    paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: renk.kenar,
  },
  basYazi: { color: renk.cokSoluk, fontSize: 10, fontFamily: yaziTipi.etiket, letterSpacing: 0.6 },
  toplamBas: { color: renk.altin },

  satir: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.s,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: renk.kenar,
  },
  // En ucuz satır işaretli: göz taramadan bulsun.
  enUcuz: { backgroundColor: 'rgba(255,194,75,0.06)' },
  solSutun: { flex: 1 },
  saySutun: { width: 58, textAlign: 'right' },
  alisSutun: { width: 76, textAlign: 'right' },

  satici: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govdeOrta },
  altBilgi: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  kucuk: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },
  sayi: { color: renk.soluk, fontSize: 14, fontFamily: yaziTipi.rakam },
  nakliye: { color: renk.cokSoluk },
  toplam: { color: renk.altin },

  notSatir: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingHorizontal: 4 },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, flex: 1, fontFamily: yaziTipi.govde },
});
