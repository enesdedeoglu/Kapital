import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { bosluk, gradyan, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Parola değiştirme paneli.
 *
 * ★★★ PAROLA BİR KEZ YAZILIP BİR DAHA DEĞİŞTİRİLEMİYORDU. Parolasını
 * paylaşmış, basit seçmiş ya da sızdırmış oyuncunun tek çaresi yeni hesap
 * açmaktı — yani şirketini, seviyesini ve parasını bırakmak.
 *
 * ★ MEVCUT PAROLA SORULUR: telefonu bir süreliğine başkasının eline geçen
 * oyuncunun hesabı kalıcı olarak ele geçirilemesin.
 *
 * ★ YENİSİ İKİ KEZ: tek alanda yazılan ve görünmeyen bir parolada harf
 * hatası yapmak, kendini kilitlemenin en kolay yoludur.
 */
export function ParolaPaneli({ acik, kapat, degistir }: {
  acik: boolean;
  kapat: () => void;
  degistir: (mevcut: string, yeni: string) => Promise<void>;
}) {
  const kenar = useSafeAreaInsets();
  const [mevcut, setMevcut] = useState('');
  const [yeni, setYeni] = useState('');
  const [tekrar, setTekrar] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [tamam, setTamam] = useState(false);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    if (acik) { setMevcut(''); setYeni(''); setTekrar(''); setHata(null); setTamam(false); }
  }, [acik]);

  const uyusmuyor = tekrar.length > 0 && yeni !== tekrar;
  const gecerli = mevcut.length > 0 && yeni.length >= 8 && yeni === tekrar && !bekliyor;

  async function onayla() {
    if (!gecerli) return;
    setBekliyor(true);
    setHata(null);
    try {
      await degistir(mevcut, yeni);
      /*
       * ★ SONUÇ PANELİN İÇİNDE: önce kapatıp dışarıda bildirim göstermek
       * vardı, panel kapanınca mesaj da gidiyordu ve oyuncu parolanın
       * değişip değişmediğini bilmiyordu.
       */
      setTamam(true);
      setMevcut(''); setYeni(''); setTekrar('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Parola değiştirilemedi');
    } finally {
      setBekliyor(false);
    }
  }

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI name="lock-reset" size={19} color={renk.mavi} />
            <Text style={s.baslik}>Parolayı değiştir</Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          {tamam ? (
            <>
              <View style={s.tamamSatir}>
                <MCI name="check-circle" size={18} color={renk.artı} />
                <Text style={s.tamamYazi}>
                  Parolan değişti. Diğer cihazlardaki oturumlar kapatıldı;
                  bu telefonda açık kaldın.
                </Text>
              </View>
              <Pressable onPress={kapat}>
                <LinearGradient colors={gradyan.altin} style={s.dugme}>
                  <Text style={s.dugmeYazi}>Tamam</Text>
                </LinearGradient>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.aciklama}>
                Parolanı değiştirince bu telefon dışındaki bütün oturumlar kapanır.
              </Text>

              <Text style={s.etiket}>MEVCUT PAROLA</Text>
              <TextInput
                style={s.giris} value={mevcut} onChangeText={setMevcut}
                secureTextEntry autoCapitalize="none" autoCorrect={false}
                placeholder="••••••••" placeholderTextColor={renk.cokSoluk}
              />

              <Text style={s.etiket}>YENİ PAROLA (en az 8)</Text>
              <TextInput
                style={s.giris} value={yeni} onChangeText={setYeni}
                secureTextEntry autoCapitalize="none" autoCorrect={false}
                placeholder="••••••••" placeholderTextColor={renk.cokSoluk}
              />

              <Text style={s.etiket}>YENİ PAROLA (tekrar)</Text>
              <TextInput
                style={[s.giris, uyusmuyor && s.girisHatali]}
                value={tekrar} onChangeText={setTekrar}
                secureTextEntry autoCapitalize="none" autoCorrect={false}
                placeholder="••••••••" placeholderTextColor={renk.cokSoluk}
                onSubmitEditing={() => void onayla()}
              />
              {uyusmuyor && <Text style={s.uyari}>İki parola aynı değil.</Text>}

              {hata && (
                <View style={s.hataSatir}>
                  <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                  <Text style={s.hata}>{hata}</Text>
                </View>
              )}

              <Pressable onPress={() => void onayla()} disabled={!gecerli}>
                <LinearGradient
                  colors={gecerli ? gradyan.altin : [renk.kart, renk.kart]}
                  style={s.dugme}
                >
                  {bekliyor
                    ? <ActivityIndicator color="#3D2A00" />
                    : (
                      <Text style={[s.dugmeYazi, !gecerli && s.dugmeYaziPasif]}>
                        Parolayı değiştir
                      </Text>
                    )}
                </LinearGradient>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    backgroundColor: renk.zeminUst, borderTopLeftRadius: yuvarlak.xl,
    borderTopRightRadius: yuvarlak.xl, paddingHorizontal: bosluk.xl, paddingTop: bosluk.m,
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenar,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  baslik: { color: renk.metin, fontSize: 18, fontFamily: yaziTipi.baslik },
  bosluk: { flex: 1 },

  aciklama: {
    color: renk.soluk, fontSize: 13, lineHeight: 19,
    fontFamily: yaziTipi.govde, marginTop: bosluk.s,
  },
  etiket: {
    color: renk.cokSoluk, fontSize: 11, letterSpacing: 0.5,
    fontFamily: yaziTipi.govde, marginTop: bosluk.l,
  },
  giris: {
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 16, fontFamily: yaziTipi.govde, marginTop: 6,
  },
  girisHatali: { borderColor: renk.eksi },
  uyari: { color: renk.eksi, fontSize: 12.5, fontFamily: yaziTipi.govde, marginTop: 6 },

  hataSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.xs, marginTop: bosluk.m },
  hata: { color: renk.eksi, fontSize: 14, flex: 1, fontFamily: yaziTipi.govde },

  tamamSatir: {
    flexDirection: 'row', alignItems: 'flex-start', gap: bosluk.s, marginTop: bosluk.m,
  },
  tamamYazi: {
    color: renk.metin, fontSize: 14, lineHeight: 20, flex: 1, fontFamily: yaziTipi.govde,
  },

  dugme: {
    alignItems: 'center', justifyContent: 'center',
    borderRadius: yuvarlak.m, paddingVertical: bosluk.l, marginTop: bosluk.l,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  dugmeYaziPasif: { color: renk.cokSoluk },
});
