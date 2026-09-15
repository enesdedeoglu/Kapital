import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOturum } from '~/oturum';
import { apiBaseUrl } from '~/api/client';
import { tema } from '~/ui/tema';

export default function Menu() {
  const { cikisYap } = useOturum();
  return (
    <View style={s.zemin}>
      <View style={s.kart}>
        <Text style={s.etiket}>SUNUCU</Text>
        <Text style={s.deger}>{apiBaseUrl()}</Text>
      </View>
      <Pressable
        style={s.cikis}
        onPress={() => Alert.alert('Çıkış', 'Oturumu kapat?', [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Çıkış yap', style: 'destructive', onPress: () => void cikisYap() },
        ])}
      >
        <Text style={s.cikisYazi}>Çıkış yap</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  zemin: { flex: 1, backgroundColor: tema.renk.zemin, padding: tema.bosluk.l, gap: tema.bosluk.m },
  kart: {
    backgroundColor: tema.renk.kart, borderColor: tema.renk.kartKenar, borderWidth: 1,
    borderRadius: tema.yuvarlak.l, padding: tema.bosluk.l, gap: tema.bosluk.xs,
  },
  etiket: { color: tema.renk.soluk, fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  deger: { color: tema.renk.metin, fontSize: 15 },
  cikis: {
    borderColor: tema.renk.eksi, borderWidth: 1, borderRadius: tema.yuvarlak.m,
    padding: tema.bosluk.l, alignItems: 'center',
  },
  cikisYazi: { color: tema.renk.eksi, fontSize: 16, fontWeight: '600' },
});
