import { StyleSheet, Text, View } from 'react-native';
import { tema } from './tema';

/**
 * Henüz yazılmamış sekmeler için yer tutucu. Boş ekran yerine NE gelecek
 * yazar: sekme yapısı bugün gezilebilir olsun, içerik sırayla dolsun.
 */
export function Yerdurak({ baslik, maddeler }: { baslik: string; maddeler: string[] }) {
  return (
    <View style={s.zemin}>
      <View style={s.kart}>
        <Text style={s.baslik}>{baslik}</Text>
        {maddeler.map((m) => <Text key={m} style={s.madde}>· {m}</Text>)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  zemin: { flex: 1, backgroundColor: tema.renk.zemin, padding: tema.bosluk.l },
  kart: {
    backgroundColor: tema.renk.kart, borderColor: tema.renk.kartKenar, borderWidth: 1,
    borderStyle: 'dashed', borderRadius: tema.yuvarlak.l, padding: tema.bosluk.l,
    gap: tema.bosluk.s,
  },
  baslik: { color: tema.renk.metin, fontSize: 16, fontWeight: '600' },
  madde: { color: tema.renk.soluk, fontSize: 14, lineHeight: 20 },
});
