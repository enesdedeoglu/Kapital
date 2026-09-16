import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { useTurDegisince } from '~/tur';
import { apiBaseUrl, ApiError } from '~/api/client';
import type { Hesap, Sirket } from '~/api/types';
import { Etiket, Kart } from '~/ui/parcalar';
import { SeviyeMerdiveni } from '~/ui/SeviyeMerdiveni';
import { bosluk, paraBicimle, renk, yaziTipi, yuvarlak } from '~/ui/tema';

/**
 * Profil — oyuncunun kim olduğu, şirketinin künyesi ve seviye merdiveni.
 *
 * ★★★★ BU SEKME ÜÇ SATIRDAN İBARETTİ (R98): sunucu adresi, sürüm, çıkış.
 * Oyuncunun adı, e-postası, ne zaman başladığı — hiçbiri yoktu. Daha önemlisi,
 * SEVİYE MERDİVENİ hiçbir yerde yoktu: ana sayfadaki halka "bir sonraki
 * seviyeye ne kadar kaldı" diyormuş gibi duruyor ama yanlış hesaplıyordu ve
 * XP dışındaki dört şart hiç görünmüyordu.
 */
export default function Menu() {
  const { iste, cikisYap } = useOturum();
  const kenar = useSafeAreaInsets();
  const [hesap, setHesap] = useState<Hesap | null>(null);
  const [sirket, setSirket] = useState<Sirket | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      setHesap(await iste<Hesap>('/auth/me'));
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Hesap bilgisi alınamadı');
    }
    /*
     * Şirket AYRI denenir: şirketi olmayan oyuncu (kayıt olup henüz kurmamış)
     * 404 alır ve bu bir hata değildir — künyesi yine görünmeli.
     */
    try {
      setSirket(await iste<Sirket>('/company'));
    } catch {
      setSirket(null);
    }
  }, [iste]);

  useEffect(() => { void yukle(); }, [yukle]);
  // Seviye tur sonunda atlanır; tur düşünce merdiven tazelensin.
  useTurDegisince(() => { void yukle(); });

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
      {hesap === null && hata === null && (
        <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>
      )}

      {hesap && (
        <Kart>
          <Etiket ikon="account-circle-outline" yazi="HESAP" />
          <Text style={s.ad}>{hesap.displayName}</Text>
          <Text style={s.eposta}>{hesap.email}</Text>
          <Text style={s.tarih}>
            {new Date(hesap.createdAt).toLocaleDateString('tr-TR')} tarihinde katıldı
          </Text>
        </Kart>
      )}

      {sirket && (
        <Kart>
          <Etiket ikon="office-building-outline" yazi="ŞİRKET" />
          <Text style={s.ad}>{sirket.name}</Text>
          <View style={s.satir}>
            <Kutucuk etiket="seviye" deger={`Lv${sirket.level}`} alt={sirket.levelTitle} />
            <Kutucuk etiket="itibar" deger={Number(sirket.reputation).toFixed(0)} alt="0 – 100" />
          </View>
          <View style={s.satir}>
            <Kutucuk etiket="merkez" deger={sirket.city.name} alt="şehir" />
            <Kutucuk
              etiket="şirket değeri"
              deger={paraBicimle(sirket.companyValue)}
              alt="₺ toplam varlık"
            />
          </View>
        </Kart>
      )}

      {sirket && <SeviyeMerdiveni ilerleme={sirket.progress} seviye={sirket.level} />}

      {hata && (
        <Kart style={s.hataKart}>
          <Etiket ikon="wifi-off" yazi="HATA" ton={renk.eksi} />
          <Text style={s.hataYazi}>{hata}</Text>
        </Kart>
      )}

      <Kart>
        <Etiket ikon="server-network" yazi="SUNUCU" />
        <Text style={s.deger}>{apiBaseUrl()}</Text>
      </Kart>

      <Kart>
        <Etiket ikon="information-outline" yazi="SÜRÜM" />
        <Text style={s.deger}>Kapital 0.0.1 · geliştirme</Text>
      </Kart>

      <Pressable
        style={({ pressed }) => [s.cikis, pressed && { opacity: 0.7 }]}
        onPress={() => Alert.alert('Çıkış', 'Oturumu kapat?', [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Çıkış yap', style: 'destructive', onPress: () => void cikisYap() },
        ])}
      >
        <MCI name="logout" size={18} color={renk.eksi} />
        <Text style={s.cikisYazi}>Çıkış yap</Text>
      </Pressable>
      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

function Kutucuk({ etiket, deger, alt }: { etiket: string; deger: string; alt: string }) {
  return (
    <View style={s.kutu}>
      <Text style={s.kutuEtiket}>{etiket}</Text>
      <Text style={s.kutuDeger} numberOfLines={1}>{deger}</Text>
      <Text style={s.kutuAlt} numberOfLines={1}>{alt}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  icerik: { padding: bosluk.l, gap: bosluk.m },
  orta: { paddingVertical: bosluk.xxl },
  deger: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govde },

  ad: { color: renk.metin, fontSize: 19, fontFamily: yaziTipi.baslik },
  eposta: { color: renk.soluk, fontSize: 14, fontFamily: yaziTipi.govde, marginTop: 2 },
  tarih: { color: renk.cokSoluk, fontSize: 12.5, fontFamily: yaziTipi.govde, marginTop: 6 },

  satir: { flexDirection: 'row', gap: bosluk.s, marginTop: bosluk.m },
  kutu: {
    flex: 1, backgroundColor: renk.kart, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: renk.kenar, padding: bosluk.m,
  },
  kutuEtiket: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },
  kutuDeger: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.rakam, marginTop: 3 },
  kutuAlt: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde, marginTop: 1 },

  hataKart: { borderColor: 'rgba(255,107,107,0.4)' },
  hataYazi: { color: renk.eksi, fontSize: 14, fontFamily: yaziTipi.govde },

  cikis: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: bosluk.s,
    borderColor: 'rgba(255,107,107,0.4)', borderWidth: 1, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(255,107,107,0.08)', padding: bosluk.l, marginTop: bosluk.s,
  },
  cikisYazi: { color: renk.eksi, fontSize: 16, fontFamily: yaziTipi.baslikOrta },
});
