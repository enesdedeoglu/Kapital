import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { useTurDegisince } from '~/tur';
import { ApiError } from '~/api/client';
import type { AcikEmir, Defter, Sevkiyat, Sirket, Tesis, Urun } from '~/api/types';
import { Etiket, Kart } from '~/ui/parcalar';
import { EmirPaneli, type EmirGirdisi } from '~/ui/EmirPaneli';
import { YoldakiMal } from '~/ui/YoldakiMal';
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
  const [tesisler, setTesisler] = useState<Tesis[]>([]);
  const [emirTarafi, setEmirTarafi] = useState<'BUY' | 'SELL' | null>(null);
  const [bildirim, setBildirim] = useState<string | null>(null);
  const [seviye, setSeviye] = useState(1);
  const [emirler, setEmirler] = useState<AcikEmir[]>([]);
  const [yolda, setYolda] = useState<Sevkiyat[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const liste = await iste<Urun[]>('/products');
        setUrunler(liste);
        setSecili((s) => s ?? liste[0]?.code ?? null);
      } catch (e) {
        setHata(e instanceof ApiError ? e.message : 'Ürünler alınamadı');
      }
      // Emir verirken tesis seçilecek; şimdiden alınır ki panel anında açılsın.
      try {
        const [t, sirket] = await Promise.all([
          iste<Tesis[]>('/facilities'),
          iste<Sirket>('/company'),
        ]);
        setTesisler(t);
        setSeviye(sirket.level);
      } catch {
        setTesisler([]);
      }
    })();
  }, [iste]);

  /*
   * Açık emirler AYRI çekilir çünkü defterden bağımsızdır: oyuncunun başka
   * ürünlerdeki emirleri de burada görünmeli. Emir verildikten sonra
   * yenilenir — yoksa oyuncu emrini verip kaybediyor, var mı yok mu bilemiyor.
   */
  const emirleriYukle = useCallback(async () => {
    try {
      setEmirler(await iste<AcikEmir[]>('/market/orders'));
    } catch {
      setEmirler([]);
    }
    /*
     * ★ YOLDAKİ MAL EMİRLERLE BİRLİKTE ÇEKİLİR, ayrı değil. İkisi aynı
     * hikâyenin iki hâli: emir dolunca listeden düşer ve mal yola çıkar.
     * Ayrı tazelenselerdi emrin kaybolduğu an ile malın göründüğü an
     * arasında yine boşluk kalırdı — kapatmaya çalıştığımız boşluğun aynısı.
     */
    try {
      setYolda(await iste<Sevkiyat[]>('/market/shipments'));
    } catch {
      setYolda([]);
    }
  }, [iste]);

  useEffect(() => { void emirleriYukle(); }, [emirleriYukle]);

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

  /*
   * Tur düşünce defter DE açık emirler DE tazelenir: turda eşleşme olur,
   * oyuncunun emri dolmuş olabilir. Yalnız defteri tazelemek "emrim hâlâ
   * duruyor" yanılgısı bırakırdı.
   */
  useTurDegisince(() => {
    void emirleriYukle();
    if (secili) void defteriYukle(secili);
  });
  const emirIptal = useCallback(async (id: string) => {
    try {
      await iste(`/market/orders/${id}`, { method: 'DELETE' });
      setBildirim('Emir iptal edildi.');
      void emirleriYukle();
      if (secili) void defteriYukle(secili);
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Emir iptal edilemedi');
    }
  }, [iste, emirleriYukle, secili, defteriYukle]);


  /*
   * Emri gönderir. Hata MESAJI döner (null = başarılı) — panel kendi
   * hatasını kendi gösterir, ekran onun yerine karar vermez.
   */
  const emirGonder = useCallback(async (g: EmirGirdisi): Promise<string | null> => {
    try {
      await iste('/market/orders', { method: 'POST', body: g });
      setBildirim(g.side === 'BUY' ? 'Alış emri verildi.' : 'Satış emri verildi.');
      void emirleriYukle();
      if (secili) void defteriYukle(secili);
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Emir verilemedi';
    }
  }, [iste, secili, defteriYukle, emirleriYukle]);

  // Bildirim kendiliğinden söner: kapatma düğmesi bir dokunuş fazla olurdu.
  useEffect(() => {
    if (!bildirim) return;
    const t = setTimeout(() => setBildirim(null), 3000);
    return () => clearTimeout(t);
  }, [bildirim]);

  return (
    <>
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
          /*
           * ★ Kilitli ürün GÖRÜNÜR olmalı, tıklanabilir de.
           * Defteri görmek serbest — piyasayı izlemek oyunun bir parçası.
           * Kilitli olan yalnız EMİR VERMEK; o yüzden ürün gizlenmez, kilit
           * simgesiyle işaretlenir. Aksi hâlde oyuncu formu doldurup
           * "seviye 5 gerekli" hatasına çarpıyordu.
           */
          const kilitli = (u.unlockLevel ?? 1) > seviye;
          return (
            <Pressable key={u.code} onPress={() => setSecili(u.code)}
              style={[s.pul, aktif && s.pulAktif, kilitli && s.pulKilitli]}>
              {kilitli && <MCI name="lock" size={12} color={renk.cokSoluk} />}
              <Text style={[s.pulYazi, aktif && s.pulYaziAktif, kilitli && s.pulYaziKilitli]}>
                {u.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

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

      {defter && tesisler.length > 0 && kilitliMi(urunler, secili, seviye) && (
        <View style={s.kilitKart}>
          <MCI name="lock-outline" size={16} color={renk.uyari} />
          <Text style={s.kilitYazi}>
            Bu ürünün ticareti için seviye {gerekenSeviye(urunler, secili)} gerekli.
            Defteri izleyebilirsin ama emir veremezsin.
          </Text>
        </View>
      )}

      {defter && tesisler.length > 0 && !kilitliMi(urunler, secili, seviye) && (
        <View style={s.eylemSatir}>
          <Pressable style={[s.eylem, s.alisEylem]} onPress={() => setEmirTarafi('BUY')}>
            <MCI name="cart-arrow-down" size={17} color={renk.mavi} />
            <Text style={[s.eylemYazi, { color: renk.mavi }]}>Al</Text>
          </Pressable>
          <Pressable style={[s.eylem, s.satisEylem]} onPress={() => setEmirTarafi('SELL')}>
            <MCI name="cart-arrow-up" size={17} color={renk.altin} />
            <Text style={[s.eylemYazi, { color: renk.altin }]}>Sat</Text>
          </Pressable>
        </View>
      )}

      {emirler.length > 0 && (
        <Kart>
          <Etiket ikon="clipboard-list-outline" yazi="AÇIK EMİRLERİM" ton={renk.artı} />
          {emirler.map((e) => (
            <View key={e.id} style={s.emirSatir}>
              <View style={[s.yonPul, e.side === 'BUY' ? s.alisPul : s.satisPul]}>
                <Text style={[s.yonYazi, { color: e.side === 'BUY' ? renk.mavi : renk.altin }]}>
                  {e.side === 'BUY' ? 'AL' : 'SAT'}
                </Text>
              </View>
              <View style={s.emirOrta}>
                <Text style={s.emirUrun}>{e.product.name}</Text>
                <Text style={s.emirAlt}>
                  {e.remainingFormatted} · {e.pricePerUnitFormatted} · {e.city.code}
                </Text>
              </View>
              <Pressable onPress={() => void emirIptal(e.id)} hitSlop={10} style={s.iptal}>
                <MCI name="close-circle-outline" size={20} color={renk.eksi} />
              </Pressable>
            </View>
          ))}
        </Kart>
      )}

      <YoldakiMal sevkiyatlar={yolda} />

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
              : (
                <>
                  {/*
                    ★ Sütun "tavan" değil "MALA KALAN": alıcının verdiği fiyat
                    nakliye dahil tavandır, satıcının eline geçen ondan nakliye
                    düşülmüş hâlidir. Tavanı göstermek satıcıya olmayan bir
                    gelir vaat ediyordu.
                  */}
                  <View style={s.basSatir}>
                    <Text style={[s.basYazi, s.solSutun]}>alıcı</Text>
                    <Text style={[s.basYazi, s.saySutun]}>nakliye</Text>
                    <Text style={[s.basYazi, s.alisSutun, s.toplamBas]}>mala kalan</Text>
                  </View>
                  {defter.buy.slice(0, 8).map((o, i) => (
                    <View
                      key={o.orderId}
                      style={[s.satir, i === 0 && o.reachable && s.enIyi, !o.reachable && s.ulasilmaz]}
                    >
                      <View style={s.solSutun}>
                        <Text style={s.satici} numberOfLines={1}>{o.buyer}</Text>
                        <View style={s.altBilgi}>
                          <Text style={s.kucuk}>{o.cityCode}</Text>
                          {o.transitTicks > 0 && (
                            <Text style={s.kucuk}>· {o.transitTicks} tur yol</Text>
                          )}
                          <Text style={s.kucuk}>· min kal {o.minQuality.toFixed(0)}</Text>
                        </View>
                      </View>
                      <Text style={[s.sayi, s.saySutun, s.nakliye]}>
                        {kisalt(o.shippingPerUnitFormatted)}
                      </Text>
                      {o.reachable
                        ? (
                          <Text style={[s.sayi, s.alisSutun, s.toplam]}>
                            {kisalt(o.goodsCeilingPerUnitFormatted)}
                          </Text>
                        )
                        : (
                          <Text style={[s.sayi, s.alisSutun, s.ulasilmazYazi]}>
                            ulaşılmaz
                          </Text>
                        )}
                    </View>
                  ))}
                </>
              )}
          </Kart>

          <View style={s.notSatir}>
            <MCI name="information-outline" size={13} color={renk.cokSoluk} />
            <Text style={s.not}>
              Alırken toplam = mal + nakliye; liste toplama göre sıralı.
              Satarken alıcının fiyatı nakliye dahil tavandır — sana kalan
              ondan nakliye düşülmüş hâlidir, liste de ona göre sıralı.
              Eşleşince fiyat senin verdiğin fiyatla bu tavanın ortasında
              oluşur, yani yüksek istemek işine yarar.
            </Text>
          </View>
        </>
      )}
      </ScrollView>

      <EmirPaneli
        acik={emirTarafi !== null}
        taraf={emirTarafi ?? 'BUY'}
        urunKodu={defter?.product.code ?? ''}
        urunAdi={defter?.product.name ?? ''}
        birim={defter?.product.unit ?? ''}
        tesisler={tesisler}
        /*
         * İpucu: ALIŞTA en ucuz TOPLAM (nakliye dahil tavan o mantıkla girilir),
         * SATIŞTA en iyi alıcının MALA KALANI.
         *
         * ★ Satış ipucu tavanı gösteriyordu ve bu fiyatla emir vermek
         * eşleşmezdi: uygunluk kuralı `satış + nakliye <= tavan`, yani tavanın
         * kendisi nakliye kadar YÜKSEK kalıyordu. Oyuncu ipucunu olduğu gibi
         * girip emrinin neden hiç eşleşmediğini anlamıyordu.
         */
        ipucuFiyat={emirTarafi === 'BUY'
          ? kurusaVirgul(defter?.sell[0]?.totalPerUnit)
          : kurusaVirgul(defter?.buy.find((o) => o.reachable)?.goodsCeilingPerUnit)}
        kapat={() => setEmirTarafi(null)}
        gonder={emirGonder}
      />
    </>
  );
}

/** Seçili ürün oyuncunun seviyesine kilitli mi? */
function kilitliMi(urunler: Urun[], kod: string | null, seviye: number): boolean {
  const u = urunler.find((x) => x.code === kod);
  return (u?.unlockLevel ?? 1) > seviye;
}

function gerekenSeviye(urunler: Urun[], kod: string | null): number {
  return urunler.find((x) => x.code === kod)?.unlockLevel ?? 1;
}

/** "23,22 ₺" → "23,22" — sütun başlığı birimi zaten söylüyor, tekrar etmesin. */
function kisalt(bicimli: string): string {
  return bicimli.replace(' ₺', '');
}

/**
 * Kuruşu forma girilebilir metne çevirir: 187500 → "18,75".
 * ★ VİRGÜL, nokta değil: alan Türkçe ondalık bekliyor ve `toFixed` nokta
 * üretiyor. Ön-dolgu noktayla gelince oyuncu silip virgülle yazmak zorunda
 * kalıyordu — ya da noktayı bırakıp tuhaf bir sayı gönderiyordu.
 */
function kurusaVirgul(kurus: string | undefined): string | null {
  if (kurus === undefined) return null;
  return (Number(kurus) / 10_000).toFixed(2).replace('.', ',');
}

const s = StyleSheet.create({
  icerik: { padding: bosluk.l, paddingBottom: 110, gap: bosluk.m },
  orta: { paddingVertical: bosluk.xxl },

  serit: { marginHorizontal: -bosluk.l },
  seritIcerik: { paddingHorizontal: bosluk.l, gap: bosluk.s },
  pul: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: bosluk.l, paddingVertical: 9, borderRadius: yuvarlak.tam,
    backgroundColor: renk.kart, borderWidth: 1, borderColor: renk.kenar,
  },
  pulKilitli: { opacity: 0.55 },
  pulYaziKilitli: { color: renk.cokSoluk },

  kilitKart: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: 'rgba(255,180,84,0.10)', borderWidth: 1,
    borderColor: 'rgba(255,180,84,0.35)', borderRadius: yuvarlak.m,
    paddingHorizontal: bosluk.m, paddingVertical: bosluk.m,
  },
  kilitYazi: { color: renk.uyari, fontSize: 13, lineHeight: 19, flex: 1, fontFamily: yaziTipi.govde },
  pulAktif: { backgroundColor: 'rgba(255,194,75,0.16)', borderColor: renk.altin },
  pulYazi: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  pulYaziAktif: { color: renk.altin, fontFamily: yaziTipi.baslikOrta },

  bildirim: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(61,220,151,0.12)', borderWidth: 1,
    borderColor: 'rgba(61,220,151,0.35)', borderRadius: yuvarlak.m,
    paddingHorizontal: bosluk.m, paddingVertical: 10,
  },
  bildirimYazi: { color: renk.artı, fontSize: 13, fontFamily: yaziTipi.govdeOrta },

  emirSatir: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.m,
    paddingVertical: 9, borderTopWidth: 1, borderTopColor: renk.kenar,
  },
  yonPul: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: yuvarlak.s, borderWidth: 1,
  },
  alisPul: { backgroundColor: 'rgba(78,161,255,0.12)', borderColor: 'rgba(78,161,255,0.4)' },
  satisPul: { backgroundColor: 'rgba(255,194,75,0.12)', borderColor: 'rgba(255,194,75,0.4)' },
  yonYazi: { fontSize: 10, letterSpacing: 0.8, fontFamily: yaziTipi.etiket },
  emirOrta: { flex: 1 },
  emirUrun: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govdeOrta },
  emirAlt: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  iptal: { padding: 2 },

  eylemSatir: { flexDirection: 'row', gap: bosluk.m },
  eylem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: bosluk.m, borderRadius: yuvarlak.m, borderWidth: 1,
  },
  alisEylem: { backgroundColor: 'rgba(78,161,255,0.10)', borderColor: 'rgba(78,161,255,0.4)' },
  satisEylem: { backgroundColor: 'rgba(255,194,75,0.10)', borderColor: 'rgba(255,194,75,0.4)' },
  eylemYazi: { fontSize: 15, fontFamily: yaziTipi.baslikOrta },

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
  enIyi: { backgroundColor: 'rgba(78,161,255,0.07)' },
  ulasilmaz: { opacity: 0.5 },
  ulasilmazYazi: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
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
