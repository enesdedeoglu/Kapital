import { StyleSheet, Text, View } from 'react-native';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Ilerleme } from '~/api/types';
import { Etiket, Kart } from './parcalar';
import { bosluk, renk, yaziTipi } from './tema';

/**
 * Seviye merdiveni — "neden atlayamıyorum"un cevabı.
 *
 * ★★★★ BU SORU EKRANDA CEVAPSIZDI (R98). Seviye atlamak yalnız XP'ye bakmıyor:
 * şirket değeri, ticaret hacmi, üretilen miktar ve farklı ürün sayısı da şart
 * (`company_levels`). Oyuncu bunların hiçbirini göremiyordu — 9.000 XP'ye
 * ulaşıp hâlâ Lv4'te kalan biri neyin bağladığını bilmiyordu.
 *
 * ★ BAĞLAYAN ŞART ÖNCE GELİR. Liste sabit sırada olsaydı oyuncu beş satırı
 * okuyup hangisinin eksik olduğunu kendisi aramak zorunda kalırdı; asıl bilgi
 * "en geride ne kaldı" ve o yukarıda durmalı.
 */
export function SeviyeMerdiveni({ ilerleme, seviye }: {
  ilerleme: Ilerleme;
  seviye: number;
}) {
  if (ilerleme.atMaxLevel) {
    return (
      <Kart>
        <Etiket ikon="trophy-outline" yazi="SEVİYE" ton={renk.altin} />
        <View style={s.tavan}>
          <MCI name="trophy" size={26} color={renk.altin} />
          <Text style={s.tavanYazi}>En yüksek seviyedesin (Lv{seviye}).</Text>
        </View>
      </Kart>
    );
  }

  // Eksikler önce, kendi içlerinde en geride olan en üstte.
  const sirali = [...ilerleme.requirements].sort((a, b) =>
    a.met === b.met ? a.ratio - b.ratio : Number(a.met) - Number(b.met));
  const kalan = sirali.filter((r) => !r.met).length;

  return (
    <Kart>
      <Etiket ikon="stairs-up" yazi="SIRADAKİ SEVİYE" ton={renk.mor} />
      <View style={s.baslikSatir}>
        <Text style={s.hedef}>
          Lv{ilerleme.nextLevel} · {ilerleme.nextTitle}
        </Text>
        <View style={s.bosluk} />
        <Text style={[s.kalanYazi, kalan === 0 && s.hazirYazi]}>
          {kalan === 0 ? 'şartlar tamam' : `${kalan} şart kaldı`}
        </Text>
      </View>

      {sirali.map((r) => (
        <View key={r.key} style={s.satir}>
          <View style={s.satirUst}>
            <MCI
              name={r.met ? 'check-circle' : 'circle-outline'}
              size={15} color={r.met ? renk.artı : renk.soluk}
            />
            <Text style={[s.ad, r.met && s.adTamam]}>{r.label}</Text>
            <View style={s.bosluk} />
            <Text style={s.deger}>
              {r.currentFormatted} <Text style={s.hedefDeger}>/ {r.requiredFormatted}</Text>
            </Text>
          </View>
          <View style={s.cubukDis}>
            <View style={[s.cubukIc, {
              width: `${Math.max(2, Math.round(r.ratio * 100))}%`,
              backgroundColor: r.met ? renk.artı : renk.mor,
            }]} />
          </View>
        </View>
      ))}

      <Text style={s.not}>
        Şartların hepsi sağlanınca seviye tur sonunda kendiliğinden atlar.
      </Text>
    </Kart>
  );
}

const s = StyleSheet.create({
  baslikSatir: { flexDirection: 'row', alignItems: 'baseline', marginBottom: bosluk.s },
  hedef: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.baslikOrta },
  bosluk: { flex: 1 },
  kalanYazi: { color: renk.uyari, fontSize: 12.5, fontFamily: yaziTipi.govde },
  hazirYazi: { color: renk.artı },

  satir: { marginTop: bosluk.m },
  satirUst: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ad: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govde },
  adTamam: { color: renk.soluk },
  deger: { color: renk.metin, fontSize: 12.5, fontFamily: yaziTipi.rakam },
  hedefDeger: { color: renk.cokSoluk },

  cubukDis: {
    height: 5, borderRadius: 3, backgroundColor: renk.kenar,
    overflow: 'hidden', marginTop: 6,
  },
  cubukIc: { height: '100%', borderRadius: 3 },

  tavan: { flexDirection: 'row', alignItems: 'center', gap: bosluk.m, paddingVertical: bosluk.s },
  tavanYazi: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govde, flex: 1 },

  not: {
    color: renk.cokSoluk, fontSize: 12, lineHeight: 18,
    marginTop: bosluk.l, fontFamily: yaziTipi.govde,
  },
});
