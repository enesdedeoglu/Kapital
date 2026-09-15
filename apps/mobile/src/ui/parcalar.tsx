import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { bosluk, golge, gradyan, kisaPara, renk, yaziTipi, yuvarlak } from './tema';

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

/** Kâr/zarar rozeti: işaret ve renk anlamı taşır, sayı tek başına değil. */
export function KarRozeti({ net, oran }: { net: string; oran: number | null }) {
  const v = BigInt(net);
  const artı = v > 0n;
  const notr = v === 0n;
  const ton = notr ? renk.soluk : artı ? renk.artı : renk.eksi;
  return (
    <Kart style={s.kutu}>
      <Etiket ikon="chart-timeline-variant" yazi="SON 24 SAAT" />
      <View style={s.karSatir}>
        <MCI
          name={notr ? 'minus' : artı ? 'trending-up' : 'trending-down'}
          size={20} color={ton}
        />
        <Text style={[s.kutuDeger, { color: ton }]} numberOfLines={1} adjustsFontSizeToFit>
          {notr ? '0' : `${artı ? '+' : ''}${kisaPara(v)}`}
        </Text>
      </View>
      <Text style={s.kutuAlt}>
        {oran === null ? '₺ kâr / zarar' : `₺ · ${(oran * 100).toFixed(1)}%`}
      </Text>
    </Kart>
  );
}

/** Rafı bitmek üzere olan ürünler — "kaç tur dayanır" ölçütüyle. */
export function KritikStok({ satirlar }: {
  satirlar: readonly {
    facilityId: string; facilityName: string; productCode: string;
    productName: string; kalan: number; kalanTur: number;
  }[];
}) {
  if (satirlar.length === 0) return null;
  return (
    <Kart>
      <Etiket ikon="alert-outline" yazi="RAF BİTİYOR" ton={renk.uyari} />
      {satirlar.map((r) => (
        <View key={`${r.facilityId}:${r.productCode}`} style={s.stokSatir}>
          <View style={s.stokSol}>
            <Text style={s.stokUrun}>{r.productName}</Text>
            <Text style={s.stokTesis} numberOfLines={1}>{r.facilityName}</Text>
          </View>
          <View style={s.stokSag}>
            <Text style={[s.stokTur, r.kalanTur <= 4 && { color: renk.eksi }]}>
              {r.kalanTur === 0 ? 'bitti' : `${r.kalanTur} tur`}
            </Text>
            <Text style={s.stokKalan}>{r.kalan.toFixed(0)} adet</Text>
          </View>
        </View>
      ))}
    </Kart>
  );
}

/** Etkin dünya olayları — oyuncu piyasayı neyin bastırdığını görsün. */
export function Olaylar({ satirlar }: {
  satirlar: readonly {
    kod: string; ad: string; aciklama: string; urunKodu: string | null;
    kalanTur: number; talep: number; arz: number; maliyet: number;
  }[];
}) {
  if (satirlar.length === 0) return null;
  return (
    <Kart>
      <Etiket ikon="flash-outline" yazi="PİYASADA NE OLUYOR" ton={renk.mavi} />
      {satirlar.map((o, i) => (
        <View key={`${o.kod}:${o.urunKodu ?? i}`} style={s.olaySatir}>
          <View style={s.olayUst}>
            <Text style={s.olayAd}>{o.ad}</Text>
            {o.urunKodu && <Text style={s.olayUrun}>{o.urunKodu}</Text>}
            <View style={s.bosluk} />
            <Text style={s.olayTur}>{o.kalanTur} tur</Text>
          </View>
          <Text style={s.olayAciklama}>{o.aciklama}</Text>
          <View style={s.carpanSatir}>
            <Carpan ad="talep" v={o.talep} />
            <Carpan ad="arz" v={o.arz} />
            <Carpan ad="maliyet" v={o.maliyet} tersRenk />
          </View>
        </View>
      ))}
    </Kart>
  );
}

/**
 * Çarpan etiketi. 1,00 gösterilmez: değişmeyen şey haber değildir.
 * `tersRenk` maliyet içindir — maliyetin artması oyuncu için KÖTÜdür.
 */
function Carpan({ ad, v, tersRenk = false }: { ad: string; v: number; tersRenk?: boolean }) {
  if (Math.abs(v - 1) < 0.005) return null;
  const artı = v > 1;
  const iyi = tersRenk ? !artı : artı;
  return (
    <View style={s.carpan}>
      <Text style={s.carpanAd}>{ad}</Text>
      <Text style={[s.carpanDeger, { color: iyi ? renk.artı : renk.eksi }]}>
        ×{v.toFixed(2).replace('.', ',')}
      </Text>
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

  karSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.xs },

  stokSatir: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.m,
    paddingVertical: 7, borderTopWidth: 1, borderTopColor: renk.kenar,
  },
  stokSol: { flex: 1 },
  stokUrun: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govdeOrta },
  stokTesis: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  stokSag: { alignItems: 'flex-end' },
  stokTur: { color: renk.uyari, fontSize: 15, fontFamily: yaziTipi.rakam },
  stokKalan: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },

  olaySatir: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: renk.kenar, gap: 3 },
  olayUst: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  olayAd: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.baslikOrta },
  olayUrun: {
    color: renk.mavi, fontSize: 10, fontFamily: yaziTipi.etiket, letterSpacing: 0.6,
    backgroundColor: 'rgba(78,161,255,0.14)', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: yuvarlak.s, overflow: 'hidden',
  },
  bosluk: { flex: 1 },
  olayTur: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.rakam },
  olayAciklama: { color: renk.soluk, fontSize: 13, lineHeight: 19, fontFamily: yaziTipi.govde },
  carpanSatir: { flexDirection: 'row', gap: bosluk.l, marginTop: 2 },
  carpan: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  carpanAd: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },
  carpanDeger: { fontSize: 13, fontFamily: yaziTipi.rakam },

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
