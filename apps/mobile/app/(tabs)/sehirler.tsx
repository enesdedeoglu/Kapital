import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { useTurDegisince } from '~/tur';
import { ApiError } from '~/api/client';
import type { Mesafe, SehirBilgi, Sirket } from '~/api/types';
import { Etiket, Kart } from '~/ui/parcalar';
import { bosluk, renk, yaziTipi, yuvarlak } from '~/ui/tema';

/**
 * Şehirler — "nereye kurayım, nerede satayım" ekranı.
 *
 * ★ Bu sekme emir defterini TEKRAR ETMEZ. Defter zaten ülke geneli ve satır
 * başına şehri gösteriyor (Piyasa sekmesi). Burada cevaplanan başka bir soru
 * var ve başka hiçbir ekran onu cevaplamıyor: şehirler birbirinden NEYLE
 * ayrılıyor ve bu benim kararlarımı nasıl değiştiriyor.
 *
 * O yüzden ham endeks dökmüyoruz — her sayı motordaki karşılığıyla veriliyor
 * (bkz. `SehirBilgi`). "populationIndex 1.60" oyuncuya bir şey söylemez;
 * "müşteri gücü ülke ortalamasının 1,8 katı" karar aldırır.
 */
export default function Sehirler() {
  const { iste } = useOturum();
  const kenar = useSafeAreaInsets();
  const [sehirler, setSehirler] = useState<SehirBilgi[]>([]);
  const [mesafeler, setMesafeler] = useState<Record<string, Mesafe>>({});
  const [evKodu, setEvKodu] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      const [sirket, liste] = await Promise.all([
        iste<Sirket>('/company'),
        iste<SehirBilgi[]>('/cities'),
      ]);
      setEvKodu(sirket.city.code);
      setSehirler(liste);
      // Mesafeler ev şehrine bağlı, o yüzden şirketten SONRA çekilir.
      const uzaklik = await iste<Mesafe[]>(`/cities/${sirket.city.code}/distances`);
      setMesafeler(Object.fromEntries(uzaklik.map((m) => [m.cityCode, m])));
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Şehirler alınamadı');
    }
  }, [iste]);

  useEffect(() => { void yukle().finally(() => setYukleniyor(false)); }, [yukle]);
  // Tur düşünce ekran kendini tazeler.
  useTurDegisince(() => { void yukle(); });

  const veri = useMemo(() => hesapla(sehirler, mesafeler, evKodu), [sehirler, mesafeler, evKodu]);
  // Nakliye notu, karşılığı olan bir satır ekranda varsa anlamlı.
  const nakliyeSapmasiVar = veri.some((c) => c.sehir.logisticsModifier !== 1);

  return (
    <ScrollView
      contentContainerStyle={[s.icerik, { paddingTop: kenar.top + 56 }]}
      refreshControl={
        <RefreshControl
          refreshing={yenileniyor} tintColor={renk.soluk}
          onRefresh={() => {
            setYenileniyor(true);
            void yukle().finally(() => setYenileniyor(false));
          }}
        />
      }
    >
      {hata && (
        <Kart style={s.hataKart}>
          <Etiket ikon="wifi-off" yazi="HATA" ton={renk.eksi} />
          <Text style={s.hata}>{hata}</Text>
        </Kart>
      )}

      {yukleniyor && veri.length === 0 && (
        <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>
      )}

      {veri.map((c) => (
        <Kart key={c.sehir.code} style={c.ev ? s.evKart : undefined}>
          <View style={s.bas}>
            <View style={s.basSol}>
              <Text style={s.ad}>{c.sehir.name}</Text>
              <Text style={s.kod}>{c.sehir.code}</Text>
            </View>
            {c.ev
              ? (
                <View style={s.evPul}>
                  <MCI name="map-marker-check" size={12} color={renk.altin} />
                  <Text style={s.evYazi}>BURADASIN</Text>
                </View>
              )
              : c.mesafe && (
                <View style={s.yol}>
                  <MCI name="truck-outline" size={13} color={renk.cokSoluk} />
                  <Text style={s.yolYazi}>
                    {c.mesafe.transitTicks === 0
                      ? 'aynı gün'
                      : `${c.mesafe.transitTicks} tur yol`}
                  </Text>
                </View>
              )}
          </View>

          {c.rozetler.length > 0 && (
            <View style={s.rozetSatir}>
              {c.rozetler.map((r) => (
                <View key={r.yazi} style={[s.rozet, { borderColor: r.ton + '66', backgroundColor: r.ton + '1A' }]}>
                  <MCI name={r.ikon} size={11} color={r.ton} />
                  <Text style={[s.rozetYazi, { color: r.ton }]}>{r.yazi}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Müşteri gücü — mağaza cirosunu belirleyen tek şey. Çubuk en güçlü
              şehre göre ölçekli, sayı ülke ortalamasına göre. */}
          <View style={s.olcu}>
            <View style={s.olcuBas}>
              <View style={s.olcuEtiket}>
                <MCI name="account-group" size={13} color={renk.soluk} />
                <Text style={s.olcuAd}>müşteri gücü</Text>
              </View>
              <Text style={[s.olcuDeger, { color: ton(c.talepOran, true) }]}>
                {carpan(c.talepOran)}
              </Text>
            </View>
            <View style={s.cubukYuva}>
              <View style={[s.cubuk, { width: `${Math.round(c.talepPay * 100)}%` }]} />
            </View>
          </View>

          <View style={s.satirlar}>
            {/* Beraberlikte HİÇBİRİ vurgulanmaz: eşitken birini seçmek
                şehre olmayan bir yetenek atfetmek olurdu (Ankara 1,00/1,00). */}
            <Ikili
              ikon="sprout" ad="tarım" deger={c.sehir.agricultureBonus}
              vurgu={c.sehir.agricultureBonus > c.sehir.industrialBonus}
            />
            <Ikili
              ikon="factory" ad="sanayi" deger={c.sehir.industrialBonus}
              vurgu={c.sehir.industrialBonus > c.sehir.agricultureBonus}
            />
            <Ikili ikon="home-city-outline" ad="arsa" deger={c.sehir.landCostIndex} dusukIyi />
            {/*
             * ★ NAKLİYE GERİ GELDİ — artık karşılığı var.
             *
             * Bu satır bir kez KALDIRILMIŞTI ve gerekçesi doğruydu:
             * `cities.logistics_modifier` dolu olmasına rağmen (Konya 1,05)
             * `shippingPerUnit`'in `cityModifier` parametresini hiçbir çağıran
             * geçmiyordu, yani ekranda hiçbir ücreti değiştirmeyen bir sayı
             * duruyordu — bu ekranın tam da kaçındığı şey.
             *
             * Parametre motorda ve API'de bağlandı, kapı da geçti (5 tohum ×
             * 700 tur, 14/14 medyan + çoğunluk). Ölçüldü: gerçekten tahsil
             * edilen 34.061 sevkiyatta çarpanı 1 olan şehirlerde türetilen
             * taban oran 3500, Konya'ya teslimde 3675 — tam ×1,05. Sayı artık
             * ödenen ücreti anlatıyor.
             *
             * Yalnız 1'den sapan şehirde çizilir; bugün sapan tek şehir Konya
             * ve her kartta "×1,00" yazmak gürültü olurdu.
             */}
            {c.sehir.logisticsModifier !== 1 && (
              <Ikili
                ikon="truck-outline" ad="nakliye"
                deger={c.sehir.logisticsModifier} dusukIyi
              />
            )}
          </View>
        </Kart>
      ))}

      {veri.length > 0 && (
        <View style={s.notKart}>
          <Text style={s.notBas}>BU SAYILAR NE YAPAR</Text>
          <Text style={s.not}>
            <Text style={s.notVurgu}>Müşteri gücü</Text> mağazanın kaç müşteri
            bulacağını belirler — nüfus ve gelirden gelir.
          </Text>
          <Text style={s.not}>
            <Text style={s.notVurgu}>Tarım / sanayi</Text> o şehirdeki tesisin
            üretim kapasitesini çarpar; tesisin kategorisine göre biri geçerlidir.
          </Text>
          <Text style={s.not}>
            <Text style={s.notVurgu}>Arsa</Text> tesis kurma maliyetini çarpar —
            düşük olması iyidir.
          </Text>
          <Text style={s.not}>
            <Text style={s.notVurgu}>Tur yol</Text> malın oraya varması için
            geçmesi gereken tur sayısı; nakliye ücretinin tabanını da mesafe
            belirler.
          </Text>
          {nakliyeSapmasiVar && (
            <Text style={s.not}>
              <Text style={s.notVurgu}>Nakliye</Text> çarpanı malın VARDIĞI
              şehre aittir: oraya taşımak o kadar pahalıdır, oradan taşımak
              değil. Yalnız 1'den sapan şehirde gösterilir.
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

/** Tek satırlık çarpan ölçüsü. `dusukIyi` olanlarda iyi yön AŞAĞIDIR. */
function Ikili({ ikon, ad, deger, vurgu = false, dusukIyi = false }: {
  ikon: keyof typeof MCI.glyphMap;
  ad: string;
  deger: number;
  vurgu?: boolean;
  dusukIyi?: boolean;
}) {
  return (
    <View style={s.ikili}>
      <MCI name={ikon} size={13} color={vurgu ? renk.metin : renk.cokSoluk} />
      <Text style={[s.ikiliAd, vurgu && s.ikiliAdVurgu]}>{ad}</Text>
      <Text style={[s.ikiliDeger, { color: ton(deger, !dusukIyi) }]}>{carpan(deger)}</Text>
    </View>
  );
}

interface SehirSatiri {
  readonly sehir: SehirBilgi;
  readonly mesafe: Mesafe | undefined;
  readonly ev: boolean;
  /** Ülke ortalamasına göre talep oranı — ekrandaki "müşteri gücü". */
  readonly talepOran: number;
  /** En güçlü şehre göre pay; çubuğun genişliği. */
  readonly talepPay: number;
  readonly rozetler: readonly { ikon: keyof typeof MCI.glyphMap; yazi: string; ton: string }[];
}

/**
 * Sıralama ve "neyin en iyisi" kararları.
 *
 * ★ Rozetler yalnız ZİRVEDEKİ şehre verilir: oyuncunun sorusu "nerede en iyi"
 * olduğu için ekran o soruyu bir bakışta cevaplamalı. Beraberlikte ikisi de
 * alır — birini keyfî seçmek yanlış bilgi olurdu.
 */
function hesapla(
  sehirler: readonly SehirBilgi[],
  mesafeler: Record<string, Mesafe>,
  evKodu: string | null,
): SehirSatiri[] {
  if (sehirler.length === 0) return [];

  const talebi = (c: SehirBilgi) =>
    c.populationIndex * c.incomeIndex * c.consumerDemandIndex;

  const talepler = sehirler.map(talebi);
  const ortalama = talepler.reduce((a, b) => a + b, 0) / talepler.length;
  const enYuksekTalep = Math.max(...talepler);
  const enYuksekTarim = Math.max(...sehirler.map((c) => c.agricultureBonus));
  const enYuksekSanayi = Math.max(...sehirler.map((c) => c.industrialBonus));
  const enUcuzArsa = Math.min(...sehirler.map((c) => c.landCostIndex));

  return sehirler
    .map((sehir) => {
      const talep = talebi(sehir);
      const rozetler: { ikon: keyof typeof MCI.glyphMap; yazi: string; ton: string }[] = [];
      if (talep === enYuksekTalep) {
        rozetler.push({ ikon: 'storefront-outline', yazi: 'en iyi pazar', ton: renk.altin });
      }
      if (sehir.agricultureBonus === enYuksekTarim) {
        rozetler.push({ ikon: 'sprout', yazi: 'tarım merkezi', ton: renk.artı });
      }
      if (sehir.industrialBonus === enYuksekSanayi) {
        rozetler.push({ ikon: 'factory', yazi: 'sanayi merkezi', ton: renk.mavi });
      }
      if (sehir.landCostIndex === enUcuzArsa) {
        rozetler.push({ ikon: 'tag-outline', yazi: 'en ucuz arsa', ton: renk.mor });
      }
      if (sehir.hasPort) {
        rozetler.push({ ikon: 'ferry', yazi: 'liman', ton: renk.turuncu });
      }
      return {
        sehir,
        mesafe: mesafeler[sehir.code],
        ev: sehir.code === evKodu,
        talepOran: ortalama > 0 ? talep / ortalama : 1,
        talepPay: enYuksekTalep > 0 ? talep / enYuksekTalep : 0,
        rozetler,
      };
    })
    /*
     * Ev şehri başta, sonrası MESAFEYE göre. Alfabetik ya da id sırası burada
     * anlamsız olurdu: oyuncunun kararı "buradan oraya mal gider mi" ve onun
     * ölçüsü mesafe. Mesafe henüz gelmediyse listenin sonuna düşer.
     */
    .sort((a, b) => {
      if (a.ev !== b.ev) return a.ev ? -1 : 1;
      return (a.mesafe?.distanceIndex ?? Infinity) - (b.mesafe?.distanceIndex ?? Infinity);
    });
}

/** 1.92 → "×1,92". Hermes'te tam ICU yok, ondalık ayracı elle konur. */
function carpan(n: number): string {
  return `×${n.toFixed(2).replace('.', ',')}`;
}

/** Ortalamadan sapmaya göre renk. `yuksekIyi` false ise iyi yön aşağıdır. */
function ton(deger: number, yuksekIyi: boolean): string {
  const iyi = yuksekIyi ? deger > 1.02 : deger < 0.98;
  const kotu = yuksekIyi ? deger < 0.98 : deger > 1.02;
  if (iyi) return renk.artı;
  if (kotu) return renk.eksi;
  return renk.soluk;
}

const s = StyleSheet.create({
  icerik: { padding: bosluk.l, paddingBottom: 110, gap: bosluk.m },
  orta: { paddingVertical: bosluk.xxl },

  evKart: { borderColor: renk.altinKoyu },
  bas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  basSol: { flexDirection: 'row', alignItems: 'baseline', gap: bosluk.s },
  ad: { color: renk.metin, fontSize: 18, fontFamily: yaziTipi.baslikOrta },
  kod: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.etiket, letterSpacing: 0.8 },

  evPul: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: yuvarlak.s,
    backgroundColor: 'rgba(255,194,75,0.12)', borderWidth: 1,
    borderColor: 'rgba(255,194,75,0.4)',
  },
  evYazi: { color: renk.altin, fontSize: 9, letterSpacing: 0.8, fontFamily: yaziTipi.etiket },
  yol: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  yolYazi: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },

  rozetSatir: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: bosluk.s },
  rozet: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: yuvarlak.tam, borderWidth: 1,
  },
  rozetYazi: { fontSize: 11, fontFamily: yaziTipi.govdeOrta },

  olcu: { marginTop: bosluk.m, gap: 5 },
  olcuBas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  olcuEtiket: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  olcuAd: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde },
  olcuDeger: { fontSize: 14, fontFamily: yaziTipi.rakam },
  cubukYuva: {
    height: 6, borderRadius: yuvarlak.tam, backgroundColor: renk.kenar, overflow: 'hidden',
  },
  cubuk: { height: 6, borderRadius: yuvarlak.tam, backgroundColor: renk.altin },

  satirlar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: bosluk.m,
    marginTop: bosluk.m, paddingTop: bosluk.m,
    borderTopWidth: 1, borderTopColor: renk.kenar,
  },
  ikili: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ikiliAd: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  ikiliAdVurgu: { color: renk.soluk },
  ikiliDeger: { fontSize: 13, fontFamily: yaziTipi.rakam },

  notKart: { paddingHorizontal: 4, gap: 7, marginTop: bosluk.s },
  notBas: {
    color: renk.cokSoluk, fontSize: 10, letterSpacing: 0.8,
    fontFamily: yaziTipi.etiket, marginBottom: 2,
  },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, fontFamily: yaziTipi.govde },
  notVurgu: { color: renk.soluk, fontFamily: yaziTipi.govdeOrta },

  hataKart: { borderColor: renk.eksi },
  hata: { color: renk.eksi, fontSize: 14, fontFamily: yaziTipi.govde },
});
