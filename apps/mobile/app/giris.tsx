import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { girisYap, kayitOl } from '~/api/session';
import { ApiError, apiBaseUrl } from '~/api/client';
import { useOturum } from '~/oturum';
import { SunucuPaneli } from '~/ui/SunucuPaneli';
import { bosluk, golge, gradyan, renk, yaziTipi, yuvarlak } from '~/ui/tema';

/*
 * ★ Geliştirmede kimlik ön-doldurma.
 *
 * Simülatörde metin enjeksiyonu ANA MAKİNENİN klavye düzeninden geçiyor:
 * Türkçe-Q'da `@` → `'`, `.` → `ç`, `i` → `ı` oluyor ve e-posta yazılamıyor.
 * Düzeni değiştirmek kullanıcının makinesine dokunmak olurdu.
 *
 * `EXPO_PUBLIC_DEV_EMAIL` / `EXPO_PUBLIC_DEV_PASSWORD` tanımlıysa ve yalnız
 * __DEV__ altındaysa alanlar dolu gelir; üretim paketinde bu dal çalışmaz.
 */
const devEmail = __DEV__ ? (process.env.EXPO_PUBLIC_DEV_EMAIL ?? '') : '';
const devParola = __DEV__ ? (process.env.EXPO_PUBLIC_DEV_PASSWORD ?? '') : '';

export default function Giris() {
  const { girisOldu, cikisYap } = useOturum();
  const [kayit, setKayit] = useState(false);
  const [email, setEmail] = useState(devEmail);
  const [parola, setParola] = useState(devParola);
  const [isim, setIsim] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  const [sunucuAcik, setSunucuAcik] = useState(false);
  /*
   * ★ Adres DURUMDA tutulur: `apiBaseUrl()` bir modül değişkeni okuyor, React
   * onun değiştiğini bilemez. Kayıttan sonra yeniden okunur.
   */
  const [adres, setAdres] = useState(apiBaseUrl);

  async function gonder() {
    setHata(null);
    setBekliyor(true);
    try {
      const yanit = kayit
        ? await kayitOl(email.trim(), parola, isim.trim())
        : await girisYap(email.trim(), parola);
      await girisOldu(yanit.accessToken, yanit.refreshToken);
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  const gecerli = email.includes('@') && parola.length >= 8 && (!kayit || isim.trim().length >= 2);

  return (
    <KeyboardAvoidingView style={s.zemin} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
        <View style={s.marka}>
          <LinearGradient colors={gradyan.altin} style={[s.rozet, golge.altin]}>
            <MCI name="chart-timeline-variant-shimmer" size={34} color="#3D2A00" />
          </LinearGradient>
          <Text style={s.baslik}>KAPİTAL</Text>
          <Text style={s.slogan}>
            {kayit ? 'Bir şehir. Bir dükkân. Bir imparatorluk.' : 'Piyasa seni bekliyor.'}
          </Text>
        </View>

        <View style={s.form}>
          {kayit && (
            <Alan ikon="account-outline" placeholder="Görünen isim"
              value={isim} onChangeText={setIsim} autoCapitalize="words" />
          )}
          <Alan ikon="email-outline" placeholder="E-posta"
            value={email} onChangeText={setEmail}
            autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Alan ikon="lock-outline" placeholder="Parola (en az 8)"
            value={parola} onChangeText={setParola} secureTextEntry />

          {hata && (
            <View style={s.hataSatir}>
              <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
              <Text style={s.hata}>{hata}</Text>
            </View>
          )}

          <Pressable
            disabled={!gecerli || bekliyor}
            onPress={() => void gonder()}
            style={({ pressed }) => [pressed && s.basili]}
          >
            <LinearGradient
              colors={gecerli && !bekliyor ? gradyan.altin : [renk.kenar, renk.kenar]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[s.dugme, gecerli && !bekliyor && golge.altin]}
            >
              {bekliyor
                ? <ActivityIndicator color="#3D2A00" />
                : (
                  <>
                    <Text style={[s.dugmeYazi, !gecerli && s.dugmeYaziPasif]}>
                      {kayit ? 'Şirketi kur' : 'Giriş yap'}
                    </Text>
                    <MCI name="arrow-right" size={19}
                      color={gecerli ? '#3D2A00' : renk.cokSoluk} />
                  </>
                )}
            </LinearGradient>
          </Pressable>

          <Pressable onPress={() => { setKayit(!kayit); setHata(null); }} style={s.gecisAlan}>
            <Text style={s.gecis}>
              {kayit ? 'Zaten hesabım var' : 'Hesabım yok, kayıt olayım'}
            </Text>
          </Pressable>

          {/*
            ★ Sunucu adresi GİRİŞ EKRANINDA. Yanlış sunucuya bakan uygulamada
            oyuncu giriş bile yapamaz; ayarı oturumun arkasına koymak onu tam
            gerektiği anda erişilmez yapardı.
          */}
          <Pressable style={s.sunucuSatir} onPress={() => setSunucuAcik(true)}>
            <MCI name="server-network" size={14} color={renk.cokSoluk} />
            <Text style={s.sunucuYazi} numberOfLines={1}>{adres}</Text>
            <Text style={s.sunucuDegistir}>değiştir</Text>
          </Pressable>
        </View>
      </ScrollView>

      <SunucuPaneli
        acik={sunucuAcik}
        kapat={() => setSunucuAcik(false)}
        adresDegisti={async () => {
          await cikisYap();
          setHata(null);
          setAdres(apiBaseUrl());
        }}
      />
    </KeyboardAvoidingView>
  );
}

function Alan({ ikon, ...props }:
{ ikon: React.ComponentProps<typeof MCI>['name'] } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={s.alan}>
      <MCI name={ikon} size={19} color={renk.cokSoluk} />
      <TextInput {...props} style={s.giris} placeholderTextColor={renk.cokSoluk} />
    </View>
  );
}

const s = StyleSheet.create({
  zemin: { flex: 1 },
  govde: { flexGrow: 1, justifyContent: 'center', padding: bosluk.xl, gap: bosluk.xxl },

  marka: { alignItems: 'center', gap: bosluk.s },
  rozet: {
    width: 76, height: 76, borderRadius: yuvarlak.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: bosluk.s,
  },
  baslik: { color: renk.metin, fontSize: 36, fontFamily: yaziTipi.baslik, letterSpacing: 5 },
  slogan: { color: renk.soluk, fontSize: 14, textAlign: 'center', fontFamily: yaziTipi.govde },

  form: { gap: bosluk.m },
  alan: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.m,
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l,
  },
  giris: { flex: 1, paddingVertical: bosluk.l, color: renk.metin, fontSize: 16, fontFamily: yaziTipi.govde },

  hataSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.xs },
  hata: { color: renk.eksi, fontSize: 14, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: bosluk.s,
    borderRadius: yuvarlak.m, paddingVertical: bosluk.l, marginTop: bosluk.xs,
  },
  basili: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  dugmeYaziPasif: { color: renk.cokSoluk },

  sunucuSatir: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: bosluk.s,
  },
  sunucuYazi: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.rakam, flexShrink: 1 },
  sunucuDegistir: { color: renk.mavi, fontSize: 12, fontFamily: yaziTipi.govdeOrta },
  gecisAlan: { paddingVertical: bosluk.s },
  gecis: { color: renk.mavi, textAlign: 'center', fontSize: 14, fontFamily: yaziTipi.govdeOrta },
});
