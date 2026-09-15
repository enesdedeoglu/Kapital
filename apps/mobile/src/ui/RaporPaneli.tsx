import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Rapor } from '~/api/types';
import { bosluk, renk, yaziTipi, yuvarlak } from './tema';

/**
 * "Sen yokken ne oldu" raporu — madde 45.
 *
 * ★ NEDEN GEREKLİ: tur 15 dakikada bir koşuyor. Uygulamayı akşam kapatıp
 * sabah açan oyuncu 30-40 turu kaçırır ve yalnız ŞU ANKİ sayıları görür.
 * Kasası artmış ama neden, üretimi durmuş ama niye — hiçbiri belli değil.
 * Pano "şu an" ekranıdır; bu "aradaki" ekranı.
 *
 * ★ SIRALAMA KASITLI: önce para (en çok merak edilen), sonra ne sattığı,
 * sonra TERS GİDENLER, en sonda dünya haberleri. Sorunlar en sona konsaydı
 * oyuncu raporu kapatıp üretiminin durduğunu fark etmezdi.
 */
export function RaporPaneli({ rapor, kapat }: {
  rapor: Rapor | null;
  kapat: () => void;
}) {
  const kenar = useSafeAreaInsets();
  if (rapor === null) return null;

  const netKurus = BigInt(rapor.kar.net);
  const kazandi = netKurus >= 0n;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={kapat}>
      <View style={s.perde}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l, marginTop: kenar.top + 40 }]}>
          <View style={s.baslikSatir}>
            <MCI name="weather-night" size={20} color={renk.mor} />
            <View style={s.baslikYazi}>
              <Text style={s.baslik}>Sen yokken</Text>
              <Text style={s.altBaslik}>
                {sureBicimle(rapor.pencere.dakika)} · {rapor.pencere.turSayisi} tur
                {rapor.pencere.kirpildi ? ' (son 7 gün)' : ''}
              </Text>
            </View>
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          <ScrollView style={s.govde} contentContainerStyle={s.govdeIc}>
            <View style={[s.netKart, kazandi ? s.netArti : s.netEksi]}>
              <Text style={s.netEtiket}>NET</Text>
              <Text style={[s.netDeger, { color: kazandi ? renk.artı : renk.eksi }]}>
                {kazandi ? '+' : '−'}{rapor.kar.netFormatted.replace('-', '')}
              </Text>
              <View style={s.netAltSatir}>
                <Text style={s.netAlt}>ciro {rapor.kar.ciroFormatted}</Text>
                <Text style={s.netAlt}>gider {rapor.kar.giderFormatted}</Text>
              </View>
            </View>

            {rapor.satislar.length > 0 && (
              <Bolum ikon="tag-outline" baslik="EN ÇOK SATANLAR">
                {rapor.satislar.map((x) => (
                  <View key={x.urunKodu} style={s.satir}>
                    <Text style={s.satirAd}>{x.urunAdi}</Text>
                    <Text style={s.satirOrta}>{x.adetFormatted}</Text>
                    <Text style={s.satirSag}>{x.ciroFormatted}</Text>
                  </View>
                ))}
              </Bolum>
            )}

            {rapor.uretim.length > 0 && (
              <Bolum ikon="factory" baslik="ÜRETİLEN">
                {rapor.uretim.map((x) => (
                  <View key={x.urunAdi} style={s.satir}>
                    <Text style={s.satirAd}>{x.urunAdi}</Text>
                    <Text style={s.satirSag}>{x.uretilenFormatted}</Text>
                  </View>
                ))}
              </Bolum>
            )}

            {rapor.sorunlar.length > 0 && (
              <Bolum ikon="alert-outline" baslik="İLGİLENMEN GEREKENLER" ton={renk.uyari}>
                {rapor.sorunlar.map((x) => (
                  <View key={`${x.tesisAdi}-${x.mesaj}`} style={s.sorunSatir}>
                    <Text style={s.sorunTesis}>{x.tesisAdi}</Text>
                    <Text style={s.sorunMesaj}>{x.mesaj}</Text>
                    <Text style={s.sorunTur}>{x.sure}</Text>
                  </View>
                ))}
              </Bolum>
            )}

            {rapor.dunya.length > 0 && (
              <Bolum ikon="earth" baslik="DÜNYADA" ton={renk.mavi}>
                {rapor.dunya.map((x) => (
                  <View key={`${x.tur}-${x.kod}`} style={s.dunyaSatir}>
                    <MCI
                      name={x.onem === 'CRITICAL' ? 'alert-circle'
                        : x.onem === 'WARNING' ? 'alert' : 'information-outline'}
                      size={14}
                      color={x.onem === 'CRITICAL' ? renk.eksi
                        : x.onem === 'WARNING' ? renk.uyari : renk.cokSoluk}
                    />
                    <View style={s.dunyaYazi}>
                      <Text style={s.dunyaBaslik}>{x.baslik}</Text>
                      <Text style={s.dunyaMetin}>{x.metin}</Text>
                    </View>
                  </View>
                ))}
              </Bolum>
            )}

            {rapor.satislar.length === 0 && rapor.uretim.length === 0
              && rapor.sorunlar.length === 0 && rapor.dunya.length === 0 && (
              <Text style={s.sessiz}>
                Sessiz geçti — kayda değer bir hareket olmadı.
              </Text>
            )}
          </ScrollView>

          <Pressable style={s.dugme} onPress={kapat}>
            <Text style={s.dugmeYazi}>Tamam</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Bolum({ ikon, baslik, ton = renk.cokSoluk, children }: {
  ikon: React.ComponentProps<typeof MCI>['name'];
  baslik: string; ton?: string; children: React.ReactNode;
}) {
  return (
    <View style={s.bolum}>
      <View style={s.bolumBas}>
        <MCI name={ikon} size={13} color={ton} />
        <Text style={[s.bolumBaslik, { color: ton }]}>{baslik}</Text>
      </View>
      {children}
    </View>
  );
}

/** 315 → "5 sa 15 dk". Hermes'te Intl yok; elle biçimlenir. */
function sureBicimle(dakika: number): string {
  const saat = Math.floor(dakika / 60);
  const dk = dakika % 60;
  if (saat === 0) return `${dk} dk`;
  if (saat >= 24) {
    const gun = Math.floor(saat / 24);
    const kalanSaat = saat % 24;
    return kalanSaat === 0 ? `${gun} gün` : `${gun} gün ${kalanSaat} sa`;
  }
  return dk === 0 ? `${saat} sa` : `${saat} sa ${dk} dk`;
}

const s = StyleSheet.create({
  perde: {
    flex: 1, backgroundColor: 'rgba(5,8,18,0.8)',
    paddingHorizontal: bosluk.l, justifyContent: 'center',
  },
  panel: {
    backgroundColor: renk.kart, borderRadius: yuvarlak.l, borderWidth: 1,
    borderColor: renk.kenarIsik, paddingHorizontal: bosluk.l, paddingTop: bosluk.l,
    maxHeight: '82%', marginBottom: bosluk.xl,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  baslikYazi: { flex: 1 },
  baslik: { color: renk.metin, fontSize: 19, fontFamily: yaziTipi.baslikOrta },
  altBaslik: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },

  govde: { marginTop: bosluk.m },
  govdeIc: { gap: bosluk.l, paddingBottom: bosluk.s },

  netKart: { borderRadius: yuvarlak.m, borderWidth: 1, padding: bosluk.m, gap: 2 },
  netArti: { borderColor: 'rgba(61,220,151,0.35)', backgroundColor: 'rgba(61,220,151,0.08)' },
  netEksi: { borderColor: 'rgba(255,107,107,0.35)', backgroundColor: 'rgba(255,107,107,0.08)' },
  netEtiket: { color: renk.soluk, fontSize: 10, letterSpacing: 1, fontFamily: yaziTipi.etiket },
  netDeger: { fontSize: 30, fontFamily: yaziTipi.rakam },
  netAltSatir: { flexDirection: 'row', gap: bosluk.m, marginTop: 2 },
  netAlt: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },

  bolum: { gap: 6 },
  bolumBas: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bolumBaslik: { fontSize: 10, letterSpacing: 0.9, fontFamily: yaziTipi.etiket },

  satir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  satirAd: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govde, flex: 1 },
  satirOrta: { color: renk.cokSoluk, fontSize: 13, fontFamily: yaziTipi.rakam },
  satirSag: { color: renk.altin, fontSize: 14, fontFamily: yaziTipi.rakam, minWidth: 80, textAlign: 'right' },

  sorunSatir: {
    borderLeftWidth: 2, borderLeftColor: renk.uyari, paddingLeft: bosluk.s, paddingVertical: 3,
  },
  sorunTesis: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govdeOrta },
  sorunMesaj: { color: renk.uyari, fontSize: 13, fontFamily: yaziTipi.govde },
  sorunTur: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },

  dunyaSatir: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  dunyaYazi: { flex: 1 },
  dunyaBaslik: { color: renk.metin, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  dunyaMetin: { color: renk.cokSoluk, fontSize: 12, lineHeight: 17, fontFamily: yaziTipi.govde },

  sessiz: { color: renk.cokSoluk, fontSize: 13, fontFamily: yaziTipi.govde, textAlign: 'center', paddingVertical: bosluk.l },

  dugme: {
    marginTop: bosluk.m, paddingVertical: 14, borderRadius: yuvarlak.m,
    backgroundColor: renk.mor, alignItems: 'center',
  },
  dugmeYazi: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.baslikOrta },
});
