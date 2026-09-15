import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { bosluk, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Sıradaki tura geri sayım — oyunun kalp atışı.
 *
 * ★ Sunucu ZAMAN gönderir, KALAN SÜRE değil. Kalan süre gönderilseydi ağ
 * gecikmesi ve ekranın açık kaldığı süre kadar yanlış olurdu. Hedef zamanı
 * alıp farkı istemcide saymak, sekmeler arasında gezinirken bile doğru kalır.
 */
export function GeriSayim({ hedef }: { hedef: string | null }) {
  const [kalanMs, setKalanMs] = useState(() => fark(hedef));

  useEffect(() => {
    setKalanMs(fark(hedef));
    if (!hedef) return;
    const t = setInterval(() => setKalanMs(fark(hedef)), 1000);
    return () => clearInterval(t);
  }, [hedef]);

  const yazi = hedef === null
    ? 'bekleniyor'
    : kalanMs <= 0
      ? 'işleniyor…'
      : sureBicimle(kalanMs);

  return (
    <View style={s.kap}>
      <MCI name="timer-sand" size={15} color={renk.turuncu} />
      <Text style={s.etiket}>SIRADAKİ TUR</Text>
      <Text style={s.sure}>{yazi}</Text>
    </View>
  );
}

function fark(hedef: string | null): number {
  return hedef === null ? 0 : new Date(hedef).getTime() - Date.now();
}

function sureBicimle(ms: number): string {
  const toplam = Math.floor(ms / 1000);
  const dk = Math.floor(toplam / 60);
  const sn = toplam % 60;
  return `${dk}:${sn.toString().padStart(2, '0')}`;
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
