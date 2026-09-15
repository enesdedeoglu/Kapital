import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Lot } from '~/api/types';
import { bosluk, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Lot detayı — alttan açılır panel (roadmap F9).
 *
 * ★ NEDEN AYRI PANEL: stok satırı ORTALAMA gösterir (ağırlıklı ortalama
 * maliyet, ortalama kalite). Ortalama karar için yeterlidir ama YANILTABİLİR:
 * 120 kg × 18,50 ₺ ile 45 kg × 20,50 ₺ aynı ortalamayı verir ama FEFO'da
 * önce hangisinin gideceği farklıdır. Detay isteyen açar, istemeyen görmez.
 */
export function LotPaneli({ acik, urunAdi, birim, lotlar, kapat }: {
  acik: boolean;
  urunAdi: string;
  birim: string;
  lotlar: readonly Lot[] | null;
  kapat: () => void;
}) {
  const kenar = useSafeAreaInsets();
  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
        <View style={s.tutamak} />
        <View style={s.baslikSatir}>
          <MCI name="package-variant-closed" size={18} color={renk.altin} />
          <Text style={s.baslik}>{urunAdi}</Text>
          <View style={s.bosluk} />
          <Pressable onPress={kapat} hitSlop={12}>
            <MCI name="close" size={22} color={renk.soluk} />
          </Pressable>
        </View>

        {lotlar === null
          ? <Text style={s.bilgi}>Yükleniyor…</Text>
          : lotlar.length === 0
            ? <Text style={s.bilgi}>Bu üründe lot yok.</Text>
            : (
              <ScrollView style={s.liste}>
                <View style={s.basSatir}>
                  <Text style={[s.bas, s.miktarSutun]}>miktar</Text>
                  <Text style={[s.bas, s.kaliteSutun]}>kalite</Text>
                  <Text style={[s.bas, s.maliyetSutun]}>birim maliyet</Text>
                </View>
                {lotlar.map((l) => (
                  <View key={l.id} style={s.satir}>
                    <Text style={[s.deger, s.miktarSutun]}>
                      {l.quantityFormatted.replace(` ${birim}`, '')}
                      <Text style={s.birim}> {birim}</Text>
                    </Text>
                    <Text style={[s.deger, s.kaliteSutun, kaliteRengi(l.quality)]}>
                      {l.quality.toFixed(0)}
                    </Text>
                    <Text style={[s.deger, s.maliyetSutun]}>{l.unitCostFormatted}</Text>
                  </View>
                ))}
                {/* FEFO: en eski lot önce tüketilir — sıra bilgi taşır. */}
                <View style={s.notSatir}>
                  <MCI name="information-outline" size={13} color={renk.cokSoluk} />
                  <Text style={s.not}>
                    Satışta en eski lot önce gider (FEFO). Ortalama maliyet
                    bu lotların ağırlıklı ortalamasıdır.
                  </Text>
                </View>
              </ScrollView>
            )}
      </View>
    </Modal>
  );
}

/** Kalite rengi: sayıya bakmadan iyi mi kötü mü görülsün. */
function kaliteRengi(q: number) {
  if (q >= 70) return { color: renk.artı };
  if (q >= 45) return { color: renk.uyari };
  return { color: renk.eksi };
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    backgroundColor: renk.kartUst, borderTopLeftRadius: yuvarlak.xl,
    borderTopRightRadius: yuvarlak.xl, borderTopWidth: 1, borderColor: renk.kenarIsik,
    paddingHorizontal: bosluk.l, paddingTop: bosluk.s, maxHeight: '70%',
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  baslik: { color: renk.metin, fontSize: 18, fontFamily: yaziTipi.baslik },
  bosluk: { flex: 1 },
  bilgi: { color: renk.soluk, fontSize: 14, fontFamily: yaziTipi.govde, paddingVertical: bosluk.l },
  liste: { marginTop: bosluk.m },

  basSatir: {
    flexDirection: 'row', paddingBottom: 6,
    borderBottomWidth: 1, borderBottomColor: renk.kenar,
  },
  bas: { color: renk.cokSoluk, fontSize: 10, fontFamily: yaziTipi.etiket, letterSpacing: 0.6 },
  satir: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: renk.kenar,
  },
  deger: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.rakam },
  birim: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  miktarSutun: { flex: 1 },
  kaliteSutun: { width: 60, textAlign: 'center' },
  maliyetSutun: { width: 96, textAlign: 'right' },

  notSatir: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    paddingTop: bosluk.m, paddingBottom: bosluk.s,
  },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, flex: 1, fontFamily: yaziTipi.govde },
});
