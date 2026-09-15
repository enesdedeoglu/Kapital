import { StyleSheet, Text, View } from 'react-native';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { sayacBicimle, useKalan } from './kalanSure';
import { bosluk, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Sıradaki tura geri sayım — oyunun kalp atışı.
 *
 * Sayma işi `useKalan`da: yoldaki malın varış saati de aynı sayacı kullanır,
 * iki ayrı `setInterval` birbirinden kayardı. Biçim burada kalıyor, çünkü
 * farklı: bir tur 15 dakika, o yüzden saniye gösterilir.
 */
export function GeriSayim({ hedef }: { hedef: string | null }) {
  const kalanMs = useKalan(hedef);

  const yazi = hedef === null
    ? 'bekleniyor'
    : kalanMs <= 0
      ? 'işleniyor…'
      : sayacBicimle(kalanMs);

  return (
    <View style={s.kap}>
      <MCI name="timer-sand" size={15} color={renk.turuncu} />
      <Text style={s.etiket}>SIRADAKİ TUR</Text>
      <Text style={s.sure}>{yazi}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  kap: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.xs,
    alignSelf: 'flex-start', paddingHorizontal: bosluk.m, paddingVertical: 7,
    borderRadius: yuvarlak.tam, backgroundColor: 'rgba(255,159,69,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,159,69,0.35)',
  },
  etiket: {
    color: renk.turuncu, fontSize: 10, letterSpacing: 1,
    fontFamily: yaziTipi.etiket, marginRight: 2,
  },
  sure: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.rakam },
});
