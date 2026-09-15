import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { girisYap, kayitOl } from '~/api/session';
import { ApiError } from '~/api/client';
import { useOturum } from '~/oturum';
import { tema } from '~/ui/tema';

/*
 * ★ Geliştirmede kimlik ön-doldurma.
 *
 * Simülatörde metin enjeksiyonu ANA MAKİNENİN klavye düzeninden geçiyor:
 * Türkçe-Q düzeninde `@` → `'`, `.` → `ç`, `i` → `ı` oluyor ve e-posta
 * yazılamıyor. Düzeni değiştirmek kullanıcının makinesine dokunmak olurdu.
 *
 * `EXPO_PUBLIC_DEV_EMAIL` / `EXPO_PUBLIC_DEV_PASSWORD` tanımlıysa ve yalnız
 * __DEV__ altındaysa alanlar dolu gelir. Üretim paketinde `__DEV__` false
 * olduğu için bu dal hiç çalışmaz.
 */
const devEmail = __DEV__ ? (process.env.EXPO_PUBLIC_DEV_EMAIL ?? '') : '';
const devParola = __DEV__ ? (process.env.EXPO_PUBLIC_DEV_PASSWORD ?? '') : '';

export default function Giris() {
  const { girisOldu } = useOturum();
  const [kayit, setKayit] = useState(false);
  const [email, setEmail] = useState(devEmail);
  const [parola, setParola] = useState(devParola);
  const [isim, setIsim] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

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
    <KeyboardAvoidingView
      style={s.zemin}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.govde}>
        <Text style={s.baslik}>Kapital</Text>
        <Text style={s.altBaslik}>
          {kayit ? 'Şirketini kur, piyasaya gir.' : 'Tekrar hoş geldin.'}
        </Text>

        {kayit && (
          <TextInput
            style={s.giris} placeholder="Görünen isim" placeholderTextColor={tema.renk.soluk}
            value={isim} onChangeText={setIsim} autoCapitalize="words"
          />
        )}
        <TextInput
          style={s.giris} placeholder="E-posta" placeholderTextColor={tema.renk.soluk}
          value={email} onChangeText={setEmail}
          autoCapitalize="none" keyboardType="email-address" autoComplete="email"
        />
        <TextInput
          style={s.giris} placeholder="Parola (en az 8)" placeholderTextColor={tema.renk.soluk}
          value={parola} onChangeText={setParola} secureTextEntry
        />

        {hata && <Text style={s.hata}>{hata}</Text>}

        <Pressable
          style={[s.dugme, (!gecerli || bekliyor) && s.dugmePasif]}
          disabled={!gecerli || bekliyor}
          onPress={() => void gonder()}
        >
          {bekliyor
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.dugmeYazi}>{kayit ? 'Şirketi kur' : 'Giriş yap'}</Text>}
        </Pressable>

        <Pressable onPress={() => { setKayit(!kayit); setHata(null); }}>
          <Text style={s.gecis}>
            {kayit ? 'Zaten hesabım var' : 'Hesabım yok, kayıt olayım'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  zemin: { flex: 1, backgroundColor: tema.renk.zemin },
  govde: { flex: 1, justifyContent: 'center', padding: tema.bosluk.xl, gap: tema.bosluk.m },
  baslik: { color: tema.renk.metin, fontSize: 34, fontWeight: '700' },
  altBaslik: { color: tema.renk.soluk, fontSize: 15, marginBottom: tema.bosluk.l },
  giris: {
    backgroundColor: tema.renk.kart, borderColor: tema.renk.kartKenar, borderWidth: 1,
    borderRadius: tema.yuvarlak.m, padding: tema.bosluk.l, color: tema.renk.metin, fontSize: 16,
  },
  hata: { color: tema.renk.eksi, fontSize: 14 },
  dugme: {
    backgroundColor: tema.renk.vurgu, borderRadius: tema.yuvarlak.m,
    padding: tema.bosluk.l, alignItems: 'center', marginTop: tema.bosluk.s,
  },
  dugmePasif: { opacity: 0.4 },
  dugmeYazi: { color: '#fff', fontSize: 16, fontWeight: '600' },
  gecis: { color: tema.renk.vurgu, textAlign: 'center', marginTop: tema.bosluk.m, fontSize: 14 },
});
