import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Tesis, TesisStok } from '~/api/types';
import { sayiOku } from './sayiOku';
import { bosluk, gradyan, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Taşımanın sonucu — panel AÇIK kalırken gösterilir.
 *
 * ★ Ekrandaki bildirim şeridi panelin ARKASINDA kalıyor: oyuncu düğmeye
 * basıyor, sunucu malı taşıyor ve hiçbir onay görmüyordu. Sonuç sunucudan
 * gelen metindir; kısmi taşımayı da ("yalnız 40 kg") oradan söyler.
 */
export type TasimaSonucu = { tamam: true; mesaj: string } | { tamam: false; hata: string };

export interface TasimaGirdisi {
  fromFacilityId: string;
  toFacilityId: string;
  productCode: string;
  quantity: number;
}

/**
 * Kendi tesisleri arasında mal taşıma.
 *
 * ★★★★ UCU VARDI, KAPISI YOKTU. `POST /inventory/transfer` çalışıyordu ama
 * mobilde onu çağıran hiçbir ekran yoktu. Sonucu şuydu: fabrikasında ekmek
 * üreten oyuncu, kendi dükkânının rafına o ekmeği koyamıyordu. Mal ancak
 * SATIN ALIRKEN seçilen tesise gidiyordu; kendi ürettiğini satmak için
 * piyasada satıp kendinden geri alması gerekiyordu. "Üret ve kendi
 * dükkânında sat" oyunun en temel dikey kurgusu; kapısı kapalıydı.
 *
 * ★ AYNI ŞEHİR SINIRI BURADA DA SÖYLENİR (sunucu da uygular): şehirler arası
 * taşıma nakliye ister, o yüzden hedef listesinde yalnız aynı şehirdeki
 * tesisler görünür. Listeye koyup sunucuya reddettirmek, oyuncuya kuralı
 * hata mesajıyla öğretmek olurdu.
 *
 * ★ GÖSTERİLEN MİKTAR `available`, `total` DEĞİL. Satılığa çıkardığı mal
 * rezervedir ve taşınamaz; toplamı gösterip "yetmedi" demek yanıltırdı.
 */
export function TasimaPaneli({
  acik, kaynak, stok, hedefler, kapat, tasi,
}: {
  acik: boolean;
  /** Panelin açıldığı tesis — kaynak sabittir. */
  kaynak: Tesis | null;
  /** Kaynağın stoğu; null = yükleniyor. */
  stok: TesisStok | null;
  /** Aynı şehirdeki diğer tesisler (kaynak hariç). */
  hedefler: Tesis[];
  kapat: () => void;
  tasi: (g: TasimaGirdisi) => Promise<TasimaSonucu>;
}) {
  const kenar = useSafeAreaInsets();
  const [urunKodu, setUrunKodu] = useState<string | null>(null);
  const [hedefId, setHedefId] = useState<string | null>(null);
  const [miktar, setMiktar] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    if (acik) return;
    setUrunKodu(null); setHedefId(null); setMiktar(''); setHata(null); setSonuc(null);
  }, [acik]);

  // Tek hedef varsa seçtirmeye gerek yok: oyuncunun elinde zaten tek seçenek.
  useEffect(() => {
    const tek = hedefler.length === 1 ? hedefler[0] : undefined;
    if (acik && hedefId === null && tek) setHedefId(tek.id);
  }, [acik, hedefId, hedefler]);

  const tasinabilir = (stok?.products ?? []).filter((u) => BigInt(u.available) > 0n);
  const secili = tasinabilir.find((u) => u.code === urunKodu) ?? null;
  const eldeki = secili ? Number(BigInt(secili.available)) / 1000 : 0;
  const hedef = hedefler.find((t) => t.id === hedefId) ?? null;

  const miktarSayi = sayiOku(miktar);
  const miktarGecerli = Number.isFinite(miktarSayi) && miktarSayi > 0;
  const fazla = miktarGecerli && secili !== null && miktarSayi > eldeki;
  const olur = secili !== null && hedef !== null && miktarGecerli && !fazla && !bekliyor;

  async function tasimayiYap() {
    if (!olur || kaynak === null || secili === null || hedef === null) return;
    setBekliyor(true); setHata(null); setSonuc(null);
    const cevap = await tasi({
      fromFacilityId: kaynak.id, toFacilityId: hedef.id,
      productCode: secili.code, quantity: miktarSayi,
    });
    setBekliyor(false);
    if (cevap.tamam) {
      setSonuc(cevap.mesaj);
      setMiktar(''); setUrunKodu(null);
    } else setHata(cevap.hata);
  }

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI name="truck-fast-outline" size={19} color={renk.mavi} />
            <Text style={s.baslik}>Mal taşı</Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          {stok === null
            ? <View style={s.orta}><ActivityIndicator color={renk.mavi} /></View>
            : hedefler.length === 0
              ? (
                <View style={s.engel}>
                  <MCI name="map-marker-off-outline" size={16} color={renk.uyari} />
                  <Text style={s.engelYazi}>
                    Bu şehirde başka tesisin yok. Şehirler arası taşıma nakliye ister;
                    malı piyasada satıp öteki şehirde almak gerekir.
                  </Text>
                </View>
              )
              : tasinabilir.length === 0
                ? (
                  <View style={s.engel}>
                    <MCI name="package-variant" size={16} color={renk.uyari} />
                    <Text style={s.engelYazi}>
                      Taşınabilir mal yok. Satışa çıkardığın mal rezervedir; taşımadan önce
                      emri iptal et.
                    </Text>
                  </View>
                )
                : (
                  <ScrollView keyboardShouldPersistTaps="handled">
                    <Text style={s.etiket}>NE TAŞINACAK</Text>
                    {tasinabilir.map((u) => {
                      const rezerv = BigInt(u.reserved) > 0n;
                      return (
                        <Pressable
                          key={u.productId} onPress={() => setUrunKodu(u.code)}
                          style={[s.satir, u.code === urunKodu && s.satirSecili]}
                        >
                          <View style={s.bosluk}>
                            <Text style={s.satirAd}>{u.name}</Text>
                            {rezerv && (
                              <Text style={s.satirAlt}>
                                bir kısmı satışta, o kısım taşınamaz
                              </Text>
                            )}
                          </View>
                          <Text style={s.satirSayi}>
                            {(Number(BigInt(u.available)) / 1000).toLocaleString('tr-TR', {
                              maximumFractionDigits: 2,
                            })} {u.unit}
                          </Text>
                        </Pressable>
                      );
                    })}

                    <Text style={s.etiket}>NEREYE</Text>
                    {hedefler.map((t) => (
                      <Pressable
                        key={t.id} onPress={() => setHedefId(t.id)}
                        style={[s.satir, t.id === hedefId && s.satirSecili]}
                      >
                        <View style={s.bosluk}>
                          <Text style={s.satirAd}>{t.name}</Text>
                          <Text style={s.satirAlt}>{t.type.name}</Text>
                        </View>
                        {/* Depo doluluğu BURADA: dolu depoya taşıma sunucuda reddedilir. */}
                        <Text style={[
                          s.satirSayi,
                          t.storageUsedPct > 90 && { color: renk.eksi },
                        ]}>
                          depo %{t.storageUsedPct.toFixed(0)}
                        </Text>
                      </Pressable>
                    ))}

                    <Text style={s.etiket}>NE KADAR</Text>
                    <View style={s.miktarSatir}>
                      <TextInput
                        style={s.giris} value={miktar} onChangeText={setMiktar}
                        keyboardType="decimal-pad" placeholder="0"
                        placeholderTextColor={renk.cokSoluk}
                      />
                      <Pressable
                        style={s.tumuDugme}
                        onPress={() => secili && setMiktar(String(eldeki))}
                      >
                        <Text style={s.tumuYazi}>tümü</Text>
                      </Pressable>
                    </View>
                    {secili && (
                      <Text style={s.ipucu}>
                        {secili.name} · taşınabilir {eldeki.toLocaleString('tr-TR', {
                          maximumFractionDigits: 2,
                        })} {secili.unit}
                      </Text>
                    )}
                    {fazla && (
                      <View style={s.uyariSatir}>
                        <MCI name="alert-circle-outline" size={14} color={renk.eksi} />
                        <Text style={s.uyari}>Elindekinden fazla taşıyamazsın.</Text>
                      </View>
                    )}
                    {hata && (
                      <View style={s.uyariSatir}>
                        <MCI name="alert-circle-outline" size={14} color={renk.eksi} />
                        <Text style={s.uyari}>{hata}</Text>
                      </View>
                    )}
                    {sonuc && (
                      <View style={s.uyariSatir}>
                        <MCI name="check-circle-outline" size={14} color={renk.artı} />
                        <Text style={s.olduYazi}>{sonuc}</Text>
                      </View>
                    )}

                    <Pressable onPress={() => void tasimayiYap()} disabled={!olur}>
                      <LinearGradient
                        colors={olur ? gradyan.altin : [renk.kart, renk.kart]}
                        style={s.dugme}
                      >
                        {bekliyor
                          ? <ActivityIndicator color="#3D2A00" />
                          : (
                            <Text style={[s.dugmeYazi, !olur && s.pasifYazi]}>
                              {secili === null ? 'Ürün seç'
                                : hedef === null ? 'Hedef seç'
                                  : `${hedef.name} deposuna taşı`}
                            </Text>
                          )}
                      </LinearGradient>
                    </Pressable>

                    <Text style={s.not}>
                      Taşıma aynı şehirde anında olur; lot kalitesi ve maliyeti korunur.
                    </Text>
                  </ScrollView>
                )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    backgroundColor: renk.kartUst, borderTopLeftRadius: yuvarlak.xl,
    borderTopRightRadius: yuvarlak.xl, borderTopWidth: 1, borderColor: renk.kenarIsik,
    paddingHorizontal: bosluk.l, paddingTop: bosluk.s, maxHeight: '88%',
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginBottom: bosluk.m },
  baslik: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslik },
  bosluk: { flex: 1 },
  orta: { paddingVertical: bosluk.xxl },

  engel: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.s,
    padding: bosluk.m, borderRadius: yuvarlak.m, marginBottom: bosluk.m,
    backgroundColor: 'rgba(255,159,69,0.10)', borderWidth: 1,
    borderColor: 'rgba(255,159,69,0.35)',
  },
  engelYazi: { color: renk.uyari, fontSize: 13.5, flex: 1, fontFamily: yaziTipi.govde },

  etiket: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.m, marginBottom: 6,
  },
  satir: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.s,
    paddingVertical: bosluk.s, paddingHorizontal: bosluk.m, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: 'transparent',
  },
  satirSecili: {
    backgroundColor: 'rgba(255,194,75,0.10)', borderColor: 'rgba(255,194,75,0.35)',
  },
  satirAd: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govdeOrta },
  satirAlt: { color: renk.cokSoluk, fontSize: 11.5, fontFamily: yaziTipi.govde, marginTop: 1 },
  satirSayi: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.rakam },

  miktarSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  giris: {
    flex: 1, backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 18, fontFamily: yaziTipi.rakam,
  },
  tumuDugme: {
    paddingHorizontal: bosluk.l, paddingVertical: bosluk.m, borderRadius: yuvarlak.m,
    backgroundColor: renk.kart, borderWidth: 1, borderColor: renk.kenar,
  },
  tumuYazi: { color: renk.mavi, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  ipucu: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde, marginTop: 6 },

  uyariSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  uyari: { color: renk.eksi, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },
  olduYazi: { color: renk.artı, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    alignItems: 'center', justifyContent: 'center', borderRadius: yuvarlak.m,
    paddingVertical: bosluk.l, marginTop: bosluk.m,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  pasifYazi: { color: renk.cokSoluk },
  not: {
    color: renk.cokSoluk, fontSize: 12, lineHeight: 18,
    marginTop: bosluk.m, fontFamily: yaziTipi.govde,
  },
});
