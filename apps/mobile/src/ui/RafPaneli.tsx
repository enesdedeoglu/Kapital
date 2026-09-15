import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { RafTeklifi } from '~/api/types';
import { bosluk, golge, gradyan, renk, yaziTipi, yuvarlak } from './tema';

export interface RafGirdisi {
  productCode: string;
  sellingPrice: number;
  enabled: boolean;
}

/**
 * Raf fiyatı paneli — dükkânda ne, kaça satılıyor.
 *
 * ★ İKİ SAYI FİYATIN ANLAMINI VERİR, tek başına fiyat vermez:
 *   PİYASA  → referans fiyat; rakiplerin civarı.
 *   TAVAN   → müşterinin rezervasyon fiyatı. ÜSTÜNDE HİÇ KİMSE ALMAZ.
 * Tavanı göstermezsek oyuncu "yüksek fiyat = çok kâr" sanıp rafı hiç
 * satmayan bir fiyata koyar ve neden satmadığını anlayamaz.
 */
export function RafPaneli({ acik, tesisAdi, teklifler, kapat, kaydet }: {
  acik: boolean;
  tesisAdi: string;
  teklifler: readonly RafTeklifi[] | null;
  kapat: () => void;
  kaydet: (g: RafGirdisi[]) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [taslak, setTaslak] = useState<Record<string, { fiyat: string; acik: boolean }>>({});
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    if (!acik || !teklifler) return;
    setHata(null);
    setTaslak(Object.fromEntries(teklifler.map((t) => [t.productCode, {
      fiyat: (Number(t.sellingPrice) / 10_000).toFixed(2).replace('.', ','),
      acik: t.enabled,
    }])));
  }, [acik, teklifler]);

  async function gonder() {
    if (!teklifler) return;
    const girdi: RafGirdisi[] = [];
    for (const t of teklifler) {
      const d = taslak[t.productCode];
      if (!d) continue;
      const f = Number(d.fiyat.replace(',', '.'));
      if (!Number.isFinite(f) || f <= 0) {
        setHata(`${t.productName} için geçerli bir fiyat gir.`);
        return;
      }
      girdi.push({ productCode: t.productCode, sellingPrice: f, enabled: d.acik });
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
            <Text style={s.baslik}>Raf fiyatları · {tesisAdi}</Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          {teklifler === null
            ? <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>
            : teklifler.length === 0
              ? (
                <Text style={s.bos}>
                  Bu dükkânda henüz raf ürünü yok. Piyasadan perakende ürün alınca
                  burada fiyat belirleyebilirsin.
                </Text>
              )
              : (
                <ScrollView keyboardShouldPersistTaps="handled">
                  {teklifler.map((t) => {
                    const d = taslak[t.productCode] ?? { fiyat: '', acik: t.enabled };
                    const f = Number(d.fiyat.replace(',', '.'));
                    const tavan = Number(t.reservationCeiling) / 10_000;
                    const tavanUstu = Number.isFinite(f) && f > tavan;
                    return (
                      <View key={t.productCode} style={s.urun}>
                        <View style={s.urunUst}>
                          <Text style={s.urunAd}>{t.productName}</Text>
                          <Text style={s.stok}>
                            {(Number(t.availableStock) / 1000).toFixed(0)} {t.unit} rafta
                          </Text>
                          <View style={s.bosluk} />
                          <Switch
                            value={d.acik}
                            onValueChange={(v) => setTaslak((p) => ({
                              ...p, [t.productCode]: { ...d, acik: v },
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
                              ...p, [t.productCode]: { ...d, fiyat: v },
                            }))}
                            placeholder="0,00" placeholderTextColor={renk.cokSoluk}
                          />
                          <Text style={s.birim}>₺ / {t.unit}</Text>
                        </View>

                        <View style={s.ipucuSatir}>
                          <Ipucu etiket="piyasa" deger={t.referencePriceFormatted} />
                          <Ipucu etiket="tavan" deger={t.reservationCeilingFormatted}
                            ton={renk.uyari} />
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

                  {hata && (
                    <View style={s.uyariSatir}>
                      <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                      <Text style={s.uyari}>{hata}</Text>
                    </View>
                  )}

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

                  <Text style={s.not}>
                    Satış her turda müşteri talebine göre olur. Kapalı ürün rafta
                    durur ama satılmaz.
                  </Text>
                </ScrollView>
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

  uyariSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  uyari: { color: renk.eksi, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    alignItems: 'center', justifyContent: 'center', borderRadius: yuvarlak.m,
    paddingVertical: bosluk.l, marginTop: bosluk.l,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, marginTop: bosluk.m, fontFamily: yaziTipi.govde },
});
