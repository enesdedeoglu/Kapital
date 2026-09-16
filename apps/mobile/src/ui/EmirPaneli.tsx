import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Tesis } from '~/api/types';
import { tesisEtiketi } from './tesisEtiketi';
import { bosluk, golge, gradyan, paraBicimle, renk, yaziTipi, yuvarlak } from './tema';

export interface EmirGirdisi {
  side: 'BUY' | 'SELL';
  facilityId: string;
  productCode: string;
  quantity: number;
  pricePerUnit: number;
}

/**
 * Alış/satış emri paneli.
 *
 * ★ FİYAT ALANININ ANLAMI TARAFA GÖRE DEĞİŞİR (madde 16, C2):
 *   ALIŞTA  → NAKLİYE DAHİL tavan birim fiyat. Oyuncu "en fazla şu kadar
 *             ödersin" der; nakliye ondan düşülür, kalanı mala gider.
 *   SATIŞTA → satıcının istediği birim fiyat. Nakliyeyi ALICI öder.
 * Bu fark ekranda yazılmazsa oyuncu alışta nakliyeyi unutup teklifini düşük
 * verir ve hiç eşleşmez. O yüzden etiket ve ipucu tarafa göre değişir.
 */
export function EmirPaneli({
  acik, taraf, urunKodu, urunAdi, birim, tesisler, ipucuFiyat, kapat, gonder,
}: {
  acik: boolean;
  taraf: 'BUY' | 'SELL';
  urunKodu: string;
  urunAdi: string;
  birim: string;
  tesisler: readonly Tesis[];
  /** Defterdeki en iyi fiyat — oyuncu neyin makul olduğunu bilsin. */
  ipucuFiyat: string | null;
  kapat: () => void;
  gonder: (g: EmirGirdisi) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [tesisId, setTesisId] = useState<string | null>(null);
  const [adet, setAdet] = useState('');
  const [fiyat, setFiyat] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setTesisId((t) => t ?? tesisler[0]?.id ?? null);
    setHata(null);
    // İpucu fiyatı ön-doldurur: boş alan yerine makul bir başlangıç.
    setFiyat((f) => (f === '' && ipucuFiyat ? ipucuFiyat : f));
  }, [acik, tesisler, ipucuFiyat]);

  const [tekTesis] = tesisler;
  const adetSayi = Number(adet.replace(',', '.'));
  const fiyatSayi = Number(fiyat.replace(',', '.'));
  const gecerli = tesisId !== null
    && Number.isFinite(adetSayi) && adetSayi > 0
    && Number.isFinite(fiyatSayi) && fiyatSayi > 0;

  async function onayla() {
    if (!gecerli || !tesisId) return;
    setBekliyor(true);
    setHata(null);
    const sonuc = await gonder({
      side: taraf, facilityId: tesisId, productCode: urunKodu,
      quantity: adetSayi, pricePerUnit: fiyatSayi,
    });
    setBekliyor(false);
    if (sonuc === null) { setAdet(''); kapat(); } else setHata(sonuc);
  }

  const alis = taraf === 'BUY';
  const toplam = gecerli ? adetSayi * fiyatSayi : 0;

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI
              name={alis ? 'cart-arrow-down' : 'cart-arrow-up'}
              size={19} color={alis ? renk.mavi : renk.altin}
            />
            <Text style={s.baslik}>{alis ? 'Alış emri' : 'Satış emri'} · {urunAdi}</Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {/*
              ★ ŞEHİR YAZILIR — pul üstünde yalnız ad vardı ve tesise isim
              verilemediği için iki manavı olan oyuncu iki özdeş "Manav" pulu
              görüyordu. Hangisini seçtiğini bilmeden ALIŞTA malı yanlış şehre
              getirtir (nakliye ve transit süresi teslim şehrine bağlıdır),
              SATIŞTA da stoğu olmayan dükkândan satmaya çalışır.
            */}
            {tesisler.length > 0 && (
              <Text style={s.etiket}>{alis ? 'TESLİM TESİSİ' : 'ÇIKIŞ TESİSİ'}</Text>
            )}
            {tesisler.length === 1 && tekTesis !== undefined
              ? (
                /*
                  ★ TEK TESİSTE DE YAZILIR. Eskiden seçici `length > 1` şartına
                  bağlıydı; tek tesisi olan oyuncu malın nereye geldiğini hiçbir
                  yerde göremiyordu. Seçecek bir şey yok ama BİLİNECEK bir şey var.
                */
                <Text style={s.tekTesis}>{tesisEtiketi(tekTesis)}</Text>
              )
              : (
                <View style={s.tesisSerit}>
                  {tesisler.map((t) => {
                    const secili = tesisId === t.id;
                    return (
                      <Pressable key={t.id} onPress={() => setTesisId(t.id)}
                        style={[s.tesisPul, secili && s.tesisPulAktif]}>
                        <Text style={[s.tesisYazi, secili && s.tesisYaziAktif]}>
                          {t.name}
                        </Text>
                        <Text style={[s.tesisSehir, secili && s.tesisSehirAktif]}>
                          {t.city.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

            <Text style={s.etiket}>MİKTAR ({birim})</Text>
            <TextInput
              style={s.giris} value={adet} onChangeText={setAdet}
              keyboardType="decimal-pad" placeholder="0"
              placeholderTextColor={renk.cokSoluk}
            />

            <Text style={s.etiket}>
              {alis ? 'TAVAN BİRİM FİYAT (NAKLİYE DAHİL)' : 'BİRİM FİYAT'}
            </Text>
            <TextInput
              style={s.giris} value={fiyat} onChangeText={setFiyat}
              keyboardType="decimal-pad" placeholder="0,00"
              placeholderTextColor={renk.cokSoluk}
            />
            <Text style={s.ipucu}>
              {alis
                ? 'Nakliye bu tutardan düşülür; kalanı mala gider. Düşük verirsen hiç eşleşmezsin.'
                : 'Nakliyeyi alıcı öder; bu senin mal fiyatındır.'}
            </Text>

            {gecerli && (
              <View style={s.toplamKart}>
                <Text style={s.toplamEtiket}>
                  {alis ? 'EN FAZLA ÖDERSİN' : 'EN AZ ALIRSIN'}
                </Text>
                {/*
                  ★ `toLocaleString('tr-TR')` DEĞİL: Hermes tam ICU ile gelmez
                  ve binlik ayırıcıyı yok sayar — "6000" yazardı, "6.000"
                  değil (aynı hata tema.ts'te de vardı, orada düzeltilmişti;
                  burası gözden kaçmış). `paraBicimle` kuruş bekler.
                */}
                <Text style={s.toplamDeger}>
                  {paraBicimle(BigInt(Math.round(toplam * 10_000)), 2)} ₺
                </Text>
              </View>
            )}

            {hata && (
              <View style={s.hataSatir}>
                <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                <Text style={s.hata}>{hata}</Text>
              </View>
            )}

            <Pressable disabled={!gecerli || bekliyor} onPress={() => void onayla()}>
              <LinearGradient
                colors={gecerli && !bekliyor ? gradyan.altin : [renk.kenar, renk.kenar]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[s.dugme, gecerli && !bekliyor && golge.altin]}
              >
                {bekliyor
                  ? <ActivityIndicator color="#3D2A00" />
                  : (
                    <Text style={[s.dugmeYazi, !gecerli && s.dugmeYaziPasif]}>
                      Emri ver
                    </Text>
                  )}
              </LinearGradient>
            </Pressable>

            <Text style={s.not}>
              Emir bu turda değil, SIRADAKİ TURDA eşleşir. Motor en ucuz toplam
              maliyetten başlayarak eşleştirir.
            </Text>
          </ScrollView>
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
    paddingHorizontal: bosluk.l, paddingTop: bosluk.s, maxHeight: '86%',
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginBottom: bosluk.s },
  baslik: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslik },
  bosluk: { flex: 1 },

  etiket: {
    color: renk.cokSoluk, fontSize: 10, letterSpacing: 0.9,
    fontFamily: yaziTipi.etiket, marginTop: bosluk.m, marginBottom: 6,
  },
  giris: {
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 18, fontFamily: yaziTipi.rakam,
  },
  ipucu: { color: renk.cokSoluk, fontSize: 12, lineHeight: 17, marginTop: 6, fontFamily: yaziTipi.govde },

  tesisSerit: { flexDirection: 'row', gap: bosluk.s, flexWrap: 'wrap' },
  tesisPul: {
    paddingHorizontal: bosluk.m, paddingVertical: 8, borderRadius: yuvarlak.tam,
    backgroundColor: renk.kart, borderWidth: 1, borderColor: renk.kenar,
  },
  tesisPulAktif: { backgroundColor: 'rgba(255,194,75,0.16)', borderColor: renk.altin },
  tesisYazi: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  tesisYaziAktif: { color: renk.altin },
  tesisSehir: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde, marginTop: 1 },
  tesisSehirAktif: { color: 'rgba(255,194,75,0.75)' },
  tekTesis: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govdeOrta },

  toplamKart: {
    marginTop: bosluk.l, padding: bosluk.m, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(255,194,75,0.08)', borderWidth: 1,
    borderColor: 'rgba(255,194,75,0.28)',
  },
  toplamEtiket: { color: renk.altin, fontSize: 10, letterSpacing: 0.9, fontFamily: yaziTipi.etiket },
  toplamDeger: { color: renk.metin, fontSize: 22, fontFamily: yaziTipi.rakam, marginTop: 2 },

  hataSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: bosluk.m },
  hata: { color: renk.eksi, fontSize: 13, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    alignItems: 'center', justifyContent: 'center', borderRadius: yuvarlak.m,
    paddingVertical: bosluk.l, marginTop: bosluk.l,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  dugmeYaziPasif: { color: renk.cokSoluk },

  not: {
    color: renk.cokSoluk, fontSize: 12, lineHeight: 18,
    marginTop: bosluk.m, fontFamily: yaziTipi.govde,
  },
});
