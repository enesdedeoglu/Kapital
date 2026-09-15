import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { SehirBilgi, TesisTuru } from '~/api/types';
import { tesisIkonu } from './parcalar';
import { bosluk, paraBicimle, renk, yaziTipi, yuvarlak } from './tema';

export interface KurmaGirdisi {
  facilityTypeCode: string;
  cityCode: string;
}

/**
 * Yeni tesis kurma paneli.
 *
 * ★ MALİYET ŞEHRE GÖRE DEĞİŞİR VE BU BİR KARARDIR. Kurulum bedeli
 * `taban × şehrin arsa endeksi` (`facility.service.ts`); Manav Konya'da
 * 2.800 ₺, İstanbul'da 6.000 ₺ — 2,1 kat. Şehir seçiciyi rakamsız göstermek
 * oyuncuya körlemesine seçtirirdi, o yüzden her şehir pulu KENDİ tutarını
 * taşıyor. Tutarlar sunucudan gelir; para çarpımı burada yapılmaz (ADR-0001).
 *
 * ★ KİLİTLİ TÜRLER GİZLENMEZ. Piyasa'daki ürün şeridiyle aynı ilke: oyuncu
 * neyin geleceğini görsün, ama neden kuramadığını da okusun. Gizlemek "oyunda
 * yok" hissi verir; kilidi göstermek hedef verir.
 */
export function TesisPaneli({
  acik, turler, sehirler, nakit, seviye, yukleniyor, kapat, gonder,
}: {
  acik: boolean;
  turler: readonly TesisTuru[];
  sehirler: readonly SehirBilgi[];
  /** Şirketin kasası, kuruş. Karşılayamayacağı tesisi baştan söyleriz. */
  nakit: string;
  seviye: number;
  yukleniyor: boolean;
  kapat: () => void;
  gonder: (g: KurmaGirdisi) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [turKodu, setTurKodu] = useState<string | null>(null);
  const [sehirKodu, setSehirKodu] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  /*
   * ★ Kilitli türler KATLI başlar. 14 tür var ve seviye 1'de 11'i kilitli;
   * hepsini açık göstermek şehir seçiciyi ve "Kur" düğmesini ekranın çok
   * altına itiyordu — oyuncu asıl eylemi görmeden kaydırmak zorunda kalıyordu.
   * Gizlemiyoruz (neyin geleceğini görmek hedef verir), sadece katlıyoruz.
   */
  const [kilitliAcik, setKilitliAcik] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setHata(null);
    setTurKodu((t) => t ?? turler.find((x) => x.unlockLevel <= seviye)?.code ?? turler[0]?.code ?? null);
    setSehirKodu((c) => c ?? sehirler[0]?.code ?? null);
  }, [acik, turler, sehirler, seviye]);

  const tur = useMemo(() => turler.find((t) => t.code === turKodu) ?? null, [turler, turKodu]);
  const acikTurler = useMemo(() => turler.filter((t) => t.unlockLevel <= seviye), [turler, seviye]);
  const kilitliTurler = useMemo(() => turler.filter((t) => t.unlockLevel > seviye), [turler, seviye]);
  /*
   * Katlı başlıktaki eşik MİNİMUMDAN hesaplanır, listenin ilk öğesinden değil:
   * sıranın `unlock_level`e göre geldiği sunucunun bugünkü davranışı, sözleşme
   * değil. Sıra değişirse başlık sessizce yanlış seviye yazardı.
   */
  const kilitliEsik = useMemo(
    () => (kilitliTurler.length > 0 ? Math.min(...kilitliTurler.map((t) => t.unlockLevel)) : 0),
    [kilitliTurler],
  );
  const sehirMaliyet = tur && sehirKodu ? tur.cityCosts[sehirKodu] : undefined;

  const kilitli = tur !== null && tur.unlockLevel > seviye;
  const limanYok = sehirMaliyet !== undefined && !sehirMaliyet.buildable;
  const parasiYetmiyor = sehirMaliyet !== undefined
    && BigInt(sehirMaliyet.cost) > BigInt(nakit);
  const kurulabilir = tur !== null && sehirKodu !== null && sehirMaliyet !== undefined
    && !kilitli && !limanYok && !parasiYetmiyor;

  /** Tek bir engel mesajı — oyuncu hangi düğmeye basamadığını okumalı. */
  const engel = kilitli
    ? `${tur?.name} için seviye ${tur?.unlockLevel} gerekli. Şu an seviye ${seviye}sin.`
    : limanYok
      ? `${tur?.name} yalnız limanı olan şehirlerde kurulabilir.`
      : parasiYetmiyor && sehirMaliyet
        ? `Kasanda ${paraBicimle(nakit)} ₺ var, gereken ${sehirMaliyet.costFormatted}.`
        : null;

  async function onayla() {
    if (!kurulabilir || !tur || !sehirKodu) return;
    setBekliyor(true);
    setHata(null);
    const sonuc = await gonder({ facilityTypeCode: tur.code, cityCode: sehirKodu });
    setBekliyor(false);
    if (sonuc === null) kapat(); else setHata(sonuc);
  }

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
        <View style={s.tutamak} />
        <View style={s.baslikSatir}>
          <MCI name="hammer-wrench" size={19} color={renk.altin} />
          <Text style={s.baslik}>Yeni tesis kur</Text>
          <View style={s.bosluk} />
          <Pressable onPress={kapat} hitSlop={12}>
            <MCI name="close" size={22} color={renk.soluk} />
          </Pressable>
        </View>

        {yukleniyor
          ? <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>
          : (
            <ScrollView style={s.govde}>
              <Text style={s.etiket}>NE KURACAKSIN</Text>
              {acikTurler.map((t) => (
                <TurSatiri
                  key={t.code} tur={t} secili={t.code === turKodu} kilit={false}
                  sehirKodu={sehirKodu}
                  bas={() => { setTurKodu(t.code); setHata(null); }}
                />
              ))}

              {kilitliTurler.length > 0 && (
                <>
                  <Pressable style={s.katSatir} onPress={() => setKilitliAcik((a) => !a)}>
                    <MCI
                      name={kilitliAcik ? 'chevron-down' : 'chevron-right'}
                      size={18} color={renk.cokSoluk}
                    />
                    <Text style={s.katYazi}>
                      {kilitliAcik
                        ? 'kilitli tesisleri gizle'
                        : `${kilitliTurler.length} tesis daha — seviye ${kilitliEsik} ve üstü`}
                    </Text>
                  </Pressable>
                  {kilitliAcik && kilitliTurler.map((t) => (
                    <TurSatiri
                      key={t.code} tur={t} secili={t.code === turKodu} kilit
                      sehirKodu={sehirKodu}
                      bas={() => { setTurKodu(t.code); setHata(null); }}
                    />
                  ))}
                </>
              )}

              <Text style={[s.etiket, s.etiketAra]}>NEREDE</Text>
              <View style={s.sehirSerit}>
                {sehirler.map((c) => {
                  const bu = tur?.cityCosts[c.code];
                  const secili = c.code === sehirKodu;
                  const olmaz = bu !== undefined && !bu.buildable;
                  return (
                    <Pressable
                      key={c.code} onPress={() => { setSehirKodu(c.code); setHata(null); }}
                      style={[s.sehir, secili && s.sehirSecili, olmaz && s.sehirOlmaz]}
                    >
                      <Text style={[s.sehirAd, secili && s.sehirAdSecili]}>{c.name}</Text>
                      <Text style={[s.sehirFiyat, secili && s.sehirFiyatSecili]}>
                        {olmaz ? 'liman yok' : bu?.costFormatted.replace(' ₺', '') ?? '—'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.ipucu}>
                Kurulum bedeli şehrin arsa maliyetiyle çarpılır — aynı tesis
                Konya'da ucuz, İstanbul'da pahalıdır. Müşteri gücü ise tersine
                işler; Şehirler sekmesi ikisini birlikte gösterir.
              </Text>

            </ScrollView>
          )}

        {/*
          ★ Özet ve düğme KAYDIRMA DIŞINDA. Tür listesi uzun; içeride kalsalar
          oyuncu maliyeti ve "Kur"u görmek için her seferinde sona kaydırırdı.
          Sabit durunca tür değiştirdikçe tutarın nasıl değiştiği de görünür.
        */}
        {!yukleniyor && tur && sehirMaliyet && (
          <View style={s.altBolum}>
            <View style={[s.ozet, kurulabilir ? s.ozetTamam : s.ozetEngel]}>
              <View style={s.ozetSatir}>
                <Text style={s.ozetEtiket}>MALİYET</Text>
                <Text style={s.ozetDeger}>{sehirMaliyet.costFormatted}</Text>
              </View>
              <View style={s.ozetSatir}>
                <Text style={s.ozetAlt}>kasanda</Text>
                <Text style={[s.ozetAlt, parasiYetmiyor && s.kirmizi]}>
                  {paraBicimle(nakit)} ₺
                </Text>
              </View>
              <View style={s.ozetSatir}>
                <Text style={s.ozetAlt}>hazır olma</Text>
                <Text style={s.ozetAlt}>{tur.constructionTicks} tur sonra</Text>
              </View>
            </View>

            {(engel ?? hata) && (
              <View style={s.hataSatir}>
                <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                <Text style={s.hata}>{hata ?? engel}</Text>
              </View>
            )}

            <Pressable
              onPress={() => void onayla()}
              disabled={!kurulabilir || bekliyor}
              style={[s.dugme, (!kurulabilir || bekliyor) && s.dugmePasif]}
            >
              {bekliyor
                ? <ActivityIndicator color={renk.zemin} />
                : <Text style={s.dugmeYazi}>Kur</Text>}
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

/** Tek tür satırı — açık ve kilitli listelerde aynı görünüm kullanılsın. */
function TurSatiri({ tur, secili, kilit, sehirKodu, bas }: {
  tur: TesisTuru; secili: boolean; kilit: boolean;
  sehirKodu: string | null; bas: () => void;
}) {
  const bu = sehirKodu ? tur.cityCosts[sehirKodu] : undefined;
  return (
    <Pressable onPress={bas} style={[s.tur, secili && s.turSecili, kilit && s.turKilitli]}>
      <View style={s.turIkon}>
        <MCI
          name={kilit ? 'lock' : (tesisIkonu[tur.category] ?? 'domain')}
          size={20} color={kilit ? renk.cokSoluk : renk.altin}
        />
      </View>
      <View style={s.turOrta}>
        <Text style={[s.turAd, kilit && s.solukYazi]}>{tur.name}</Text>
        <Text style={s.turAlt}>
          {kilit
            ? `seviye ${tur.unlockLevel} gerekli`
            : `${tur.constructionTicks} tur inşaat · bakım ${tur.maintenanceCostFormatted}/tur`}
        </Text>
      </View>
      <Text style={[s.turFiyat, kilit && s.solukYazi]}>
        {(bu?.costFormatted ?? tur.baseCostFormatted).replace(' ₺', '')}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(5,8,18,0.65)' },
  panel: {
    backgroundColor: renk.kart, borderTopLeftRadius: yuvarlak.l,
    borderTopRightRadius: yuvarlak.l, paddingHorizontal: bosluk.l,
    paddingTop: bosluk.s, borderTopWidth: 1, borderColor: renk.kenarIsik,
    maxHeight: '88%',
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  baslik: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslikOrta },
  bosluk: { flex: 1 },
  govde: { marginTop: bosluk.m },
  altBolum: { borderTopWidth: 1, borderTopColor: renk.kenar, paddingTop: bosluk.m },
  katSatir: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 10, paddingHorizontal: bosluk.xs,
  },
  katYazi: { color: renk.cokSoluk, fontSize: 13, fontFamily: yaziTipi.govde },
  orta: { paddingVertical: bosluk.xxl },

  etiket: {
    color: renk.cokSoluk, fontSize: 10, letterSpacing: 1,
    fontFamily: yaziTipi.etiket, marginBottom: bosluk.s,
  },
  etiketAra: { marginTop: bosluk.l },

  tur: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.m,
    paddingVertical: 10, paddingHorizontal: bosluk.m, marginBottom: 6,
    borderRadius: yuvarlak.m, borderWidth: 1, borderColor: renk.kenar,
    backgroundColor: renk.kartUst,
  },
  turSecili: { borderColor: renk.altin, backgroundColor: 'rgba(255,194,75,0.10)' },
  turKilitli: { opacity: 0.55 },
  turIkon: {
    width: 34, height: 34, borderRadius: yuvarlak.s, alignItems: 'center',
    justifyContent: 'center', backgroundColor: 'rgba(255,194,75,0.10)',
  },
  turOrta: { flex: 1 },
  turAd: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govdeOrta },
  turAlt: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  turFiyat: { color: renk.altin, fontSize: 15, fontFamily: yaziTipi.rakam },
  solukYazi: { color: renk.cokSoluk },

  sehirSerit: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sehir: {
    paddingHorizontal: bosluk.m, paddingVertical: 8, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: renk.kenar, backgroundColor: renk.kartUst,
    alignItems: 'center', minWidth: 84,
  },
  sehirSecili: { borderColor: renk.altin, backgroundColor: 'rgba(255,194,75,0.12)' },
  sehirOlmaz: { opacity: 0.45 },
  sehirAd: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  sehirAdSecili: { color: renk.altin },
  sehirFiyat: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.rakam },
  sehirFiyatSecili: { color: renk.metin },

  ipucu: {
    color: renk.cokSoluk, fontSize: 12, lineHeight: 18,
    fontFamily: yaziTipi.govde, marginTop: bosluk.s,
  },

  ozet: {
    marginTop: bosluk.l, padding: bosluk.m, borderRadius: yuvarlak.m,
    borderWidth: 1, gap: 4,
  },
  ozetTamam: { borderColor: 'rgba(61,220,151,0.35)', backgroundColor: 'rgba(61,220,151,0.08)' },
  ozetEngel: { borderColor: renk.kenar, backgroundColor: renk.kartUst },
  ozetSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ozetEtiket: { color: renk.soluk, fontSize: 11, letterSpacing: 0.8, fontFamily: yaziTipi.etiket },
  ozetDeger: { color: renk.metin, fontSize: 18, fontFamily: yaziTipi.rakam },
  ozetAlt: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  kirmizi: { color: renk.eksi },

  hataSatir: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: bosluk.m,
  },
  hata: { color: renk.eksi, fontSize: 13, lineHeight: 19, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    marginTop: bosluk.l, marginBottom: bosluk.m, paddingVertical: 15,
    borderRadius: yuvarlak.m, backgroundColor: renk.altin, alignItems: 'center',
  },
  dugmePasif: { backgroundColor: renk.kenar },
  dugmeYazi: { color: '#1A1205', fontSize: 16, fontFamily: yaziTipi.baslikOrta },
});
