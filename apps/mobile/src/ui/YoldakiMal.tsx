import { StyleSheet, Text, View } from 'react-native';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Sevkiyat } from '~/api/types';
import { sureBicimle, useKalan } from './kalanSure';
import { Etiket, Kart } from './parcalar';
import { bosluk, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Yoldaki mal kartı — alış emri ile depo arasındaki boşluğu doldurur.
 *
 * ★★★★ BU BOŞLUK GERÇEKTİ VE ÖLÇÜLDÜ (R97). Oyuncu alış emri veriyor; tur
 * düşünce emir doluyor, para kasadan çıkıyor, emir "AÇIK EMİRLERİM"den
 * kayboluyor — ama mal transit süresi boyunca depoya girmiyor. O aralıkta
 * ekranda hiçbir iz yoktu: para gitti, mal yok. `GET /market/shipments`
 * sunucuda bunu zaten anlatıyordu ("Gediz Endüstri 51 → Manav · İstanbul,
 * 3 tur"), uygulamada o ucu çağıran tek bir ekran bile yoktu.
 *
 * ★ TUR DEĞİL SAAT: "3 tur kaldı" oyuncunun sorusunun cevabı değil. Soru
 * "ne zaman gelecek" ve cevabı saattir. Sunucu varış SAATİNİ gönderiyor,
 * geri sayımı `useKalan` sayıyor — sıradaki tur rozetiyle aynı sayaç.
 */
export function YoldakiMal({ sevkiyatlar }: { sevkiyatlar: readonly Sevkiyat[] }) {
  if (sevkiyatlar.length === 0) return null;
  return (
    <Kart>
      <Etiket ikon="truck-fast-outline" yazi="YOLDAKİ MAL" ton={renk.mavi} />
      {sevkiyatlar.map((s) => <Satir key={s.id} s={s} />)}
    </Kart>
  );
}

function Satir({ s }: { s: Sevkiyat }) {
  const kalanMs = useKalan(s.arrivesAt);
  /*
   * Saat bilinmiyorsa (hiç tur işlememiş dünya) tur sayısına düşülür —
   * uydurma bir saat yazmaktansa elde olan doğru bilgiyi vermek.
   */
  const varis = s.arrivesAt === null
    ? `${s.ticksRemaining} tur`
    : sureBicimle(kalanMs);

  return (
    <View style={st.satir}>
      <View style={st.sol}>
        <View style={st.ustSatir}>
          <Text style={st.urun}>{s.product.name}</Text>
          <Text style={st.miktar}>{s.quantityFormatted}</Text>
        </View>
        <Text style={st.yon} numberOfLines={1}>
          {s.seller} → {s.destination}
        </Text>
        <Text style={st.bedel}>
          {s.unitCostFormatted}/{s.product.unit} + {s.shippingCostFormatted} nakliye
        </Text>
      </View>
      <View style={st.sayacKap}>
        <MCI name="timer-sand" size={13} color={renk.mavi} />
        <Text style={st.sayac}>{varis}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  satir: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.s,
    paddingVertical: bosluk.s, borderTopWidth: 1, borderTopColor: renk.kenar,
  },
  sol: { flex: 1 },
  ustSatir: { flexDirection: 'row', alignItems: 'baseline', gap: bosluk.s },
  urun: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.baslikOrta },
  miktar: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.rakam },
  yon: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde, marginTop: 2 },
  bedel: { color: renk.cokSoluk, fontSize: 11.5, fontFamily: yaziTipi.rakam, marginTop: 1 },
  sayacKap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: bosluk.m, paddingVertical: 6, borderRadius: yuvarlak.tam,
    backgroundColor: 'rgba(90,160,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(90,160,255,0.35)',
  },
  sayac: { color: renk.mavi, fontSize: 13, fontFamily: yaziTipi.rakam },

  ozetKap: { marginTop: bosluk.s, gap: 4 },
  ozetSatir: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ozetYazi: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde },
  esnek: { flex: 1 },
  ozetSayac: { color: renk.mavi, fontSize: 12.5, fontFamily: yaziTipi.rakam },
});

/**
 * Tesis kartındaki kompakt hâl — "bu dükkâna ne geliyor".
 *
 * ★ EN ÇOK BOŞ DEPODA GEREKLİ. Depo boşken kart yalnız "Depo boş." diyordu;
 * oysa oyuncu malı almış, yolda olabilir. "Boş" ile "boş ama geliyor"
 * arasındaki farkı göstermeyen ekran, satın almanın işe yarayıp yaramadığını
 * söylemiyor demektir.
 */
export function YoldaOzet({ sevkiyatlar }: { sevkiyatlar: readonly Sevkiyat[] }) {
  if (sevkiyatlar.length === 0) return null;
  return (
    <View style={st.ozetKap}>
      {sevkiyatlar.map((s) => <OzetSatiri key={s.id} s={s} />)}
    </View>
  );
}

function OzetSatiri({ s }: { s: Sevkiyat }) {
  const kalanMs = useKalan(s.arrivesAt);
  const varis = s.arrivesAt === null ? `${s.ticksRemaining} tur` : sureBicimle(kalanMs);
  return (
    <View style={st.ozetSatir}>
      <MCI name="truck-fast-outline" size={14} color={renk.mavi} />
      <Text style={st.ozetYazi}>
        yolda · {s.quantityFormatted} {s.product.name}
      </Text>
      <View style={st.esnek} />
      <Text style={st.ozetSayac}>{varis}</Text>
    </View>
  );
}
