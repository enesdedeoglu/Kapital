import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Raf } from '~/api/types';
import { sayiOku } from './sayiOku';
import { bosluk, golge, gradyan, renk, yaziTipi, yuvarlak } from './tema';

export interface RafGirdisi {
  productCode: string;
  sellingPrice: number;
  enabled: boolean;
}

/** Rafta olan ve olabilecek ürünler AYNI satır biçimiyle çizilir. */
interface Satir {
  kod: string;
  ad: string;
  birim: string;
  stok: string;
  piyasa: string;
  tavanFormatli: string;
  tavan: number;
  /** Bu oturumda rafa eklendi — kaydedilmeden önce işaretli durur. */
  yeni: boolean;
}


const gosterim = (kurus: string) => (Number(kurus) / 10_000).toFixed(2).replace('.', ',');

/**
 * Raf paneli — dükkânda ne, kaça satılıyor ve rafa ne konabilir.
 *
 * ★ İKİ SAYI FİYATIN ANLAMINI VERİR, tek başına fiyat vermez:
 *   PİYASA  → referans fiyat; rakiplerin civarı.
 *   TAVAN   → müşterinin rezervasyon fiyatı. ÜSTÜNDE HİÇ KİMSE ALMAZ.
 * Tavanı göstermezsek oyuncu "yüksek fiyat = çok kâr" sanıp rafı hiç
 * satmayan bir fiyata koyar ve neden satmadığını anlayamaz.
 *
 * ★★★★ EKLEME BÖLÜMÜ BİR ÇIKMAZI KAPATIYOR (R96). Panel eskiden yalnız
 * MEVCUT teklifleri düzenleyebiliyordu ve raf boşken şunu yazıyordu:
 * "piyasadan perakende ürün alınca burada fiyat belirleyebilirsin". Oysa
 * satın almak rafa teklif EKLEMİYOR — ölçüldü: manava 100 kg domates vardı,
 * `GET /retail/:id` yine boş döndü. Yani oyuncu tarif edilen şeyi yapıyor,
 * hiçbir şey değişmiyordu. Rafa ürün koyan tek yol `PUT .../prices` idi ve
 * onu yeni ürünle çağıran hiçbir ekran yoktu: al → gelir → satamazsın.
 */
export function RafPaneli({ acik, tesisAdi, raf, kapat, kaydet }: {
  acik: boolean;
  tesisAdi: string;
  /** null = yükleniyor. */
  raf: Raf | null;
  kapat: () => void;
  kaydet: (g: RafGirdisi[]) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [taslak, setTaslak] = useState<Record<string, { fiyat: string; acik: boolean }>>({});
  const [eklenen, setEklenen] = useState<readonly string[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    if (!acik || !raf) return;
    setHata(null);
    setEklenen([]);
    setTaslak(Object.fromEntries(raf.offers.map((t) => [t.productCode, {
      fiyat: gosterim(t.sellingPrice), acik: t.enabled,
    }])));
  }, [acik, raf]);

  const satirlar = useMemo<Satir[]>(() => {
    if (!raf) return [];
    const rafta: Satir[] = raf.offers.map((t) => ({
      kod: t.productCode, ad: t.productName, birim: t.unit,
      stok: t.availableStock, piyasa: t.referencePriceFormatted,
      tavanFormatli: t.reservationCeilingFormatted,
      tavan: Number(t.reservationCeiling) / 10_000, yeni: false,
    }));
    const yeniler: Satir[] = raf.addable
      .filter((a) => eklenen.includes(a.productCode))
      .map((a) => ({
        kod: a.productCode, ad: a.productName, birim: a.unit,
        stok: a.availableStock, piyasa: a.referencePriceFormatted,
        tavanFormatli: a.reservationCeilingFormatted,
        tavan: Number(a.reservationCeiling) / 10_000, yeni: true,
      }));
    return [...yeniler, ...rafta];
  }, [raf, eklenen]);

  const kalanEklenebilir = (raf?.addable ?? []).filter((a) => !eklenen.includes(a.productCode));

  function rafaEkle(kod: string, onerilenKurus: string) {
    setEklenen((p) => [...p, kod]);
    // Fiyat ÖNERİYLE dolu gelir: boş alan, oyuncuyu rastgele sayıya iter.
    setTaslak((p) => ({ ...p, [kod]: { fiyat: gosterim(onerilenKurus), acik: true } }));
  }

  async function gonder() {
    const girdi: RafGirdisi[] = [];
    for (const satir of satirlar) {
      const d = taslak[satir.kod];
      if (!d) continue;
      const f = sayiOku(d.fiyat);
      if (!Number.isFinite(f) || f <= 0) {
        setHata(`${satir.ad} için geçerli bir fiyat gir.`);
        return;
      }
      girdi.push({ productCode: satir.kod, sellingPrice: f, enabled: d.acik });
    }
    if (girdi.length === 0) return;
    setBekliyor(true);
    const sonuc = await kaydet(girdi);
    setBekliyor(false);
    if (sonuc === null) kapat(); else setHata(sonuc);
  }

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI name="tag-multiple-outline" size={19} color={renk.altin} />
            <Text style={s.baslik}>Raf · {tesisAdi}</Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          {raf === null
            ? <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>
            : (
              <>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {satirlar.length === 0 && kalanEklenebilir.length === 0 && (
                    <Text style={s.bos}>
                      Bu dükkâna konabilecek perakende ürünü yok.
                    </Text>
                  )}

                  {satirlar.map((t) => {
                    const d = taslak[t.kod] ?? { fiyat: '', acik: true };
                    const f = sayiOku(d.fiyat);
                    const tavanUstu = Number.isFinite(f) && f > t.tavan;
                    return (
                      <View key={t.kod} style={s.urun}>
                        <View style={s.urunUst}>
                          <Text style={s.urunAd}>{t.ad}</Text>
                          {t.yeni && <Text style={s.yeniPul}>yeni</Text>}
                          <Text style={s.stok}>
                            {(Number(t.stok) / 1000).toFixed(0)} {t.birim} depoda
                          </Text>
                          <View style={s.bosluk} />
                          <Switch
                            value={d.acik}
                            onValueChange={(v) => setTaslak((p) => ({
                              ...p, [t.kod]: { ...d, acik: v },
                            }))}
                            trackColor={{ false: renk.kenar, true: 'rgba(61,220,151,0.5)' }}
                            thumbColor={d.acik ? renk.artı : renk.soluk}
                          />
                        </View>

                        <View style={s.fiyatSatir}>
                          <TextInput
                            style={[s.giris, tavanUstu && s.girisUyari]}
                            value={d.fiyat} keyboardType="decimal-pad"
                            onChangeText={(v) => setTaslak((p) => ({
                              ...p, [t.kod]: { ...d, fiyat: v },
                            }))}
                            placeholder="0,00" placeholderTextColor={renk.cokSoluk}
                          />
                          <Text style={s.birim}>₺ / {t.birim}</Text>
                        </View>

                        <View style={s.ipucuSatir}>
                          <Ipucu etiket="piyasa" deger={t.piyasa} />
                          <Ipucu etiket="tavan" deger={t.tavanFormatli} ton={renk.uyari} />
                        </View>

                        {tavanUstu && (
                          <View style={s.uyariSatir}>
                            <MCI name="alert-outline" size={14} color={renk.eksi} />
                            <Text style={s.uyari}>
                              Tavanın üstünde — bu fiyattan kimse almaz.
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {kalanEklenebilir.length > 0 && (
                    <>
                      <Text style={s.altBaslik}>RAFA EKLE</Text>
                      <View style={s.ekleSerit}>
                        {kalanEklenebilir.map((a) => (
                          <Pressable
                            key={a.productCode} style={s.eklePul}
                            onPress={() => rafaEkle(a.productCode, a.suggestedPrice)}
                          >
                            <MCI name="plus" size={14} color={renk.altin} />
                            <Text style={s.ekleAd}>{a.productName}</Text>
                            {/* Stok sayısı seçimi yönlendirir: elindeki mal önce. */}
                            {Number(a.availableStock) > 0 && (
                              <Text style={s.ekleStok}>{a.availableStockFormatted}</Text>
                            )}
                          </Pressable>
                        ))}
                      </View>
                    </>
                  )}

                  {hata && (
                    <View style={s.uyariSatir}>
                      <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                      <Text style={s.uyari}>{hata}</Text>
                    </View>
                  )}

                  <Text style={s.not}>
                    Satış her turda müşteri talebine göre olur. Kapalı ürün rafta
                    durur ama satılmaz.
                  </Text>
                </ScrollView>

                {/*
                  ★ KAYDET DÜĞMESİ KAYDIRMA ALANININ DIŞINDA. İçeride olduğunda
                  ürün sayısı arttıkça ekranın altına kayıyor ve oyuncu
                  fiyatları girip kaydedemiyordu — aynı hatayı TesisPaneli ve
                  OtomatikPaneli'nde de yapmıştım.
                */}
                {satirlar.length > 0 && (
                  <Pressable disabled={bekliyor} onPress={() => void gonder()}>
                    <LinearGradient
                      colors={bekliyor ? [renk.kenar, renk.kenar] : gradyan.altin}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={[s.dugme, !bekliyor && golge.altin]}
                    >
                      {bekliyor
                        ? <ActivityIndicator color="#3D2A00" />
                        : <Text style={s.dugmeYazi}>Fiyatları kaydet</Text>}
                    </LinearGradient>
                  </Pressable>
                )}
              </>
            )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Ipucu({ etiket, deger, ton = renk.soluk }:
{ etiket: string; deger: string; ton?: string }) {
  return (
    <View style={s.ipucu}>
      <Text style={s.ipucuEtiket}>{etiket}</Text>
      <Text style={[s.ipucuDeger, { color: ton }]}>{deger}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    backgroundColor: renk.kartUst, borderTopLeftRadius: yuvarlak.xl,
    borderTopRightRadius: yuvarlak.xl, borderTopWidth: 1, borderColor: renk.kenarIsik,
    paddingHorizontal: bosluk.l, paddingTop: bosluk.s, maxHeight: '86%',
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginBottom: bosluk.s },
  baslik: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslik, flexShrink: 1 },
  bosluk: { flex: 1 },
  orta: { paddingVertical: bosluk.xxl },
  bos: { color: renk.soluk, fontSize: 14, lineHeight: 21, fontFamily: yaziTipi.govde, paddingVertical: bosluk.l },

  urun: { paddingVertical: bosluk.m, borderTopWidth: 1, borderTopColor: renk.kenar },
  urunUst: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  urunAd: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.baslikOrta },
  yeniPul: {
    color: renk.altin, fontSize: 10.5, fontFamily: yaziTipi.baslikOrta,
    backgroundColor: 'rgba(212,175,55,0.14)', borderRadius: yuvarlak.s,
    paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
  },
  stok: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },

  fiyatSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginTop: bosluk.s },
  giris: {
    flex: 1, backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 18, fontFamily: yaziTipi.rakam,
  },
  girisUyari: { borderColor: renk.eksi },
  birim: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde, width: 58 },

  ipucuSatir: { flexDirection: 'row', gap: bosluk.xl, marginTop: 8 },
  ipucu: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ipucuEtiket: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },
  ipucuDeger: { fontSize: 13, fontFamily: yaziTipi.rakam },

  altBaslik: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.l, marginBottom: bosluk.s,
  },
  ekleSerit: { flexDirection: 'row', flexWrap: 'wrap', gap: bosluk.s },
  eklePul: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)', borderRadius: yuvarlak.tam,
    backgroundColor: 'rgba(212,175,55,0.08)',
    paddingHorizontal: bosluk.m, paddingVertical: bosluk.s,
  },
  ekleAd: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govde },
  ekleStok: { color: renk.cokSoluk, fontSize: 11.5, fontFamily: yaziTipi.rakam },

  uyariSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  uyari: { color: renk.eksi, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    alignItems: 'center', justifyContent: 'center', borderRadius: yuvarlak.m,
    paddingVertical: bosluk.l, marginTop: bosluk.m,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, marginTop: bosluk.m, fontFamily: yaziTipi.govde },
});
