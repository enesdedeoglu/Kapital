import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { adresiDuzelt, ozelSunucu, sunucuyuYaz } from '~/api/sunucu';
import { apiBaseUrl } from '~/api/client';
import { bosluk, gradyan, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Sunucu adresi paneli.
 *
 * ★ GİRİŞ EKRANINDAN ULAŞILIR. Yanlış sunucuya bakan bir uygulamada oyuncu
 * giriş bile yapamaz; ayarı oturumun arkasına koymak, onu tam ihtiyaç
 * duyulduğu anda erişilemez yapardı.
 *
 * ★ ADRES DEĞİŞİNCE OTURUM KAPANIR: jeton onu veren sunucuya aittir, başka
 * sunucuda geçersizdir. Kapatmasaydık oyuncu "girişliyim ama her istek
 * hata veriyor" durumunda kalırdı.
 */
export function SunucuPaneli({ acik, kapat, adresDegisti }: {
  acik: boolean;
  kapat: () => void;
  /** Kayıt sonrası: oturumu kapatmak çağıranın işi. */
  adresDegisti: () => Promise<void> | void;
}) {
  const kenar = useSafeAreaInsets();
  const [metin, setMetin] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setMetin(ozelSunucu() ?? '');
    setHata(null);
  }, [acik]);

  async function kaydet(yeni: string | null) {
    setBekliyor(true);
    setHata(null);
    try {
      await sunucuyuYaz(yeni);
      await adresDegisti();
      kapat();
    } catch {
      setHata('Adres kaydedilemedi.');
    } finally {
      setBekliyor(false);
    }
  }

  function onayla() {
    const duzgun = adresiDuzelt(metin);
    if (duzgun === null) {
      setHata('Adres anlaşılmadı. Örnek: kapital.trycloudflare.com');
      return;
    }
    void kaydet(duzgun);
  }

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI name="server-network" size={19} color={renk.mavi} />
            <Text style={s.baslik}>Sunucu adresi</Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          <Text style={s.aciklama}>
            Oyunun bağlandığı sunucu. Adres değişirse buradan güncelle;
            uygulamayı yeniden kurman gerekmez.
          </Text>

          <Text style={s.etiket}>ŞU AN KULLANILAN</Text>
          <Text style={s.mevcut} numberOfLines={2}>{apiBaseUrl()}</Text>

          <Text style={s.etiket}>YENİ ADRES</Text>
          <TextInput
            style={s.giris}
            value={metin}
            onChangeText={setMetin}
            placeholder="kapital.trycloudflare.com"
            placeholderTextColor={renk.cokSoluk}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={onayla}
          />

          {hata && (
            <View style={s.uyariSatir}>
              <MCI name="alert-circle-outline" size={14} color={renk.eksi} />
              <Text style={s.uyari}>{hata}</Text>
            </View>
          )}

          <Pressable onPress={onayla} disabled={bekliyor}>
            <LinearGradient colors={bekliyor ? [renk.kart, renk.kart] : gradyan.altin} style={s.dugme}>
              {bekliyor
                ? <ActivityIndicator color="#3D2A00" />
                : <Text style={s.dugmeYazi}>Kaydet ve çıkış yap</Text>}
            </LinearGradient>
          </Pressable>

          {ozelSunucu() !== null && (
            <Pressable style={s.ikincilDugme} onPress={() => void kaydet(null)} disabled={bekliyor}>
              <Text style={s.ikincilYazi}>Varsayılan adrese dön</Text>
            </Pressable>
          )}

          <Text style={s.not}>
            Adres değişince oturum kapanır: giriş bilgilerin sunucuya aittir.
          </Text>
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
    paddingHorizontal: bosluk.l, paddingTop: bosluk.s,
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginBottom: bosluk.s },
  baslik: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslik },
  bosluk: { flex: 1 },
  aciklama: { color: renk.soluk, fontSize: 13.5, lineHeight: 20, fontFamily: yaziTipi.govde },

  etiket: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.l, marginBottom: 6,
  },
  mevcut: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.rakam },
  giris: {
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 16, fontFamily: yaziTipi.govde,
  },

  uyariSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  uyari: { color: renk.eksi, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    alignItems: 'center', justifyContent: 'center', borderRadius: yuvarlak.m,
    paddingVertical: bosluk.l, marginTop: bosluk.m,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  ikincilDugme: { alignItems: 'center', paddingVertical: bosluk.m },
  ikincilYazi: { color: renk.mavi, fontSize: 14, fontFamily: yaziTipi.govdeOrta },
  not: {
    color: renk.cokSoluk, fontSize: 12, lineHeight: 18,
    marginTop: bosluk.xs, fontFamily: yaziTipi.govde,
  },
});
