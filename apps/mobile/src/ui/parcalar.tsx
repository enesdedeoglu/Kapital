import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { bosluk, golge, gradyan, renk, yaziTipi, yuvarlak } from './tema';

type IkonAdi = ComponentProps<typeof MCI>['name'];

/** Gradyanlı kart — düz yüzey yerine hafif derinlik. */
export function Kart({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <LinearGradient colors={gradyan.kart} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.kart, golge.kart, style]}>
      {children}
    </LinearGradient>
  );
}

/** Başlık satırı: ikon + küçük etiket. Her sayının bir simgesi olsun. */
export function Etiket({ ikon, yazi, ton = renk.soluk }:
{ ikon: IkonAdi; yazi: string; ton?: string }) {
  return (
    <View style={s.etiketSatir}>
      <MCI name={ikon} size={13} color={ton} />
      <Text style={[s.etiket, { color: ton }]}>{yazi}</Text>
    </View>
  );
}

/**
 * KASA — ekranın kahramanı. Altın gradyan, para ekranın en sıcak öğesi
 * olsun diye; oyuncunun baktığı ilk sayı budur.
 */
export function Kasa({ tutar, altYazi }: { tutar: string; altYazi: string }) {
  return (
    <LinearGradient colors={gradyan.altin} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.kasa, golge.altin]}>
      <View style={s.kasaUst}>
        <MCI name="cash-multiple" size={16} color="#6B4A00" />
        <Text style={s.kasaEtiket}>KASA</Text>
      </View>
      <View style={s.kasaTutarSatir}>
        <Text style={s.kasaTutar}>{tutar}</Text>
        <Text style={s.kasaBirim}>₺</Text>
      </View>
      <Text style={s.kasaAlt}>{altYazi}</Text>
    </LinearGradient>
  );
}

/** İkon + değer + etiketten oluşan küçük istatistik karesi. */
export function Kutu({ ikon, etiket, deger, alt, ton = renk.metin }:
{ ikon: IkonAdi; etiket: string; deger: string; alt?: string; ton?: string }) {
  return (
    <Kart style={s.kutu}>
      <Etiket ikon={ikon} yazi={etiket} />
      <Text style={[s.kutuDeger, { color: ton }]} numberOfLines={1} adjustsFontSizeToFit>
        {deger}
      </Text>
      {alt ? <Text style={s.kutuAlt} numberOfLines={1}>{alt}</Text> : null}
    </Kart>
  );
}

/**
 * Seviye rozeti — çevresinde deneyim halkası. Oyunlarda ilerleme GÖRÜLÜR
 * olmalı; sayı yerine dolan bir halka bunu tek bakışta anlatır.
 */
export function SeviyeRozeti({ seviye, unvan, oran }:
{ seviye: number; unvan: string; oran: number }) {
  const r = 26;
  const cevre = 2 * Math.PI * r;
  const dolu = Math.max(0, Math.min(1, oran)) * cevre;
  return (
    <View style={s.rozetSatir}>
      <View style={s.rozet}>
        <Svg width={64} height={64} style={StyleSheet.absoluteFill}>
          <Circle cx={32} cy={32} r={r} stroke={renk.kenar} strokeWidth={5} fill="none" />
          <Circle
            cx={32} cy={32} r={r} stroke={renk.mor} strokeWidth={5} fill="none"
            strokeDasharray={`${dolu} ${cevre}`} strokeLinecap="round"
            transform="rotate(-90 32 32)"
          />
        </Svg>
        <Text style={s.rozetSeviye}>{seviye}</Text>
      </View>
      <View style={s.rozetYazi}>
        <Text style={s.rozetUnvan}>{unvan}</Text>
        <Text style={s.rozetAlt}>Seviye {seviye}</Text>
      </View>
    </View>
  );
}

/** Yazılmamış sekmeler: boş ekran yerine ne geleceğini gösteren liste. */
export function Yakinda({ ikon, baslik, maddeler }:
{ ikon: IkonAdi; baslik: string; maddeler: string[] }) {
  /*
   * ★ Başlık ŞEFFAF: `headerTransparent` ile zemin gradyanı üstten kesilmiyor,
   * ama içerik de başlığın altına kayıyor — ikon dairesi "Şirketim" yazısının
   * üstüne biniyordu. Güvenli alan + başlık yüksekliği kadar itilir.
   */
  const kenar = useSafeAreaInsets();
  return (
    <View style={[s.yakindaZemin, { paddingTop: kenar.top + 56 }]}>
      <View style={s.yakindaIkon}>
        <MCI name={ikon} size={36} color={renk.mor} />
      </View>
      <Text style={s.yakindaBaslik}>{baslik}</Text>
      <Text style={s.yakindaAlt}>Yapım aşamasında</Text>
      <Kart style={s.yakindaKart}>
        {maddeler.map((m) => (
          <View key={m} style={s.yakindaMadde}>
            <MCI name="circle-small" size={18} color={renk.mor} />
            <Text style={s.yakindaMetin}>{m}</Text>
          </View>
        ))}
      </Kart>
    </View>
  );
}

const s = StyleSheet.create({
  kart: {
    borderRadius: yuvarlak.l, borderWidth: 1, borderColor: renk.kenar,
    padding: bosluk.l, gap: bosluk.xs,
  },
  etiketSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.xs },
  etiket: { fontSize: 11, letterSpacing: 1.1, fontFamily: yaziTipi.etiket },

  kasa: { borderRadius: yuvarlak.xl, padding: bosluk.xl, gap: 2 },
  kasaUst: { flexDirection: 'row', alignItems: 'center', gap: bosluk.xs },
  kasaEtiket: { color: '#6B4A00', fontSize: 11, letterSpacing: 1.4, fontFamily: yaziTipi.etiket },
  kasaTutarSatir: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  kasaTutar: { color: '#3D2A00', fontSize: 40, fontFamily: yaziTipi.rakam, letterSpacing: -0.5 },
  kasaBirim: { color: '#6B4A00', fontSize: 22, fontFamily: yaziTipi.rakam, marginBottom: 6 },
  kasaAlt: { color: '#7A5600', fontSize: 13, fontFamily: yaziTipi.govdeOrta },

  kutu: { flex: 1, gap: bosluk.xs },
  kutuDeger: { fontSize: 22, fontFamily: yaziTipi.rakam, letterSpacing: -0.3 },
  kutuAlt: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },

  rozetSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.m },
  rozet: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  rozetSeviye: { color: renk.metin, fontSize: 22, fontFamily: yaziTipi.rakam },
  rozetYazi: { flex: 1 },
  rozetUnvan: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslik },
  rozetAlt: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde },

  yakindaZemin: {
    flex: 1, alignItems: 'center', paddingHorizontal: bosluk.xl,
    paddingBottom: bosluk.xl, gap: bosluk.s,
  },
  yakindaIkon: {
    width: 76, height: 76, borderRadius: yuvarlak.tam, marginTop: bosluk.l,
    backgroundColor: 'rgba(139,92,246,0.14)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  yakindaBaslik: { color: renk.metin, fontSize: 22, fontFamily: yaziTipi.baslik, marginTop: bosluk.s },
  yakindaAlt: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde, marginBottom: bosluk.m },
  yakindaKart: { alignSelf: 'stretch', gap: bosluk.xs },
  yakindaMadde: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 },
  yakindaMetin: { color: renk.soluk, fontSize: 14, lineHeight: 22, flex: 1, fontFamily: yaziTipi.govde },
});
