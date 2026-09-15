import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { apiBaseUrl } from '~/api/client';
import { Etiket, Kart } from '~/ui/parcalar';
import { bosluk, renk, yuvarlak } from '~/ui/tema';

export default function Menu() {
  const { cikisYap } = useOturum();
  const kenar = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={[s.icerik, { paddingTop: kenar.top + 56 }]}>
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

const s = StyleSheet.create({
  icerik: { padding: bosluk.l, gap: bosluk.m },
  deger: { color: renk.metin, fontSize: 15 },
  cikis: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: bosluk.s,
    borderColor: 'rgba(255,107,107,0.4)', borderWidth: 1, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(255,107,107,0.08)', padding: bosluk.l, marginTop: bosluk.s,
  },
  cikisYazi: { color: renk.eksi, fontSize: 16, fontWeight: '700' },
});
