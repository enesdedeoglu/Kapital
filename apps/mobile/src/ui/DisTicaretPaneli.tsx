import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { DisTicaret, DisUrun, DovizOnizleme } from '~/api/types';
import { sayiOku } from './sayiOku';
import { bosluk, golge, gradyan, renk, yaziTipi, yuvarlak } from './tema';

type Yon = 'IMPORT' | 'EXPORT';

export interface DisTicaretGirdisi {
  yon: Yon;
  facilityId: string;
  productCode: string;
  quantity: number;
}

/**
 * Dış ticaret paneli — dünya pazarı, döviz ve liman.
 *
 * ★★★★ ALTYAPI VARDI, KAPISI YOKTU (R101). `/foreign` uçları çalışıyor ve
 * `foreign-capacity` fazı her tur kapasiteyi tazeliyor; ama mobilde onları
 * çağıran hiçbir ekran yoktu. Liman 200.000 ₺ ve 20 tur inşaat — oyuncu o
 * yatırımı yapıp karşılığında hiçbir şey göremiyordu.
 *
 * ★ ÜÇ ŞART AYRI AYRI SÖYLENİR: seviye kilidi, hazır liman, döviz. Hepsini
 * tek bir "yapamazsın"a indirmek, oyuncuya NEYİ eksik olduğunu söylememek
 * olurdu — üçünün çaresi de birbirinden farklı.
 *
 * ★ İTHALAT DÖVİZLE ÖDENİR. Bu, dış ticareti kur riskine bağlar: ithalatçı
 * yalnız mal fiyatını değil kuru da üstlenir. O yüzden döviz bölümü ürün
 * listesinin ÜSTÜNDE — sıra böyle.
 */
export function DisTicaretPaneli({
  acik, durum, tesisId, onizleDoviz, kapat, bozdur, ticaret,
}: {
  acik: boolean;
  /** null = yükleniyor. */
  durum: DisTicaret | null;
  /** Panelin açıldığı liman. */
  tesisId: string | null;
  onizleDoviz: (yon: 'BUY_USD' | 'SELL_USD', usd: number) => Promise<DovizOnizleme | null>;
  kapat: () => void;
  bozdur: (yon: 'BUY_USD' | 'SELL_USD', usd: number) => Promise<string | null>;
  ticaret: (g: DisTicaretGirdisi) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [dovizYon, setDovizYon] = useState<'BUY_USD' | 'SELL_USD'>('BUY_USD');
  const [dovizTutar, setDovizTutar] = useState('');
  const [onizleme, setOnizleme] = useState<DovizOnizleme | null>(null);
  const [yon, setYon] = useState<Yon>('IMPORT');
  const [secili, setSecili] = useState<string | null>(null);
  const [miktar, setMiktar] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    if (acik) return;
    setDovizTutar(''); setOnizleme(null); setSecili(null); setMiktar(''); setHata(null);
  }, [acik]);

  // Döviz önizlemesi gecikmeli: her tuşta istek atmak sunucuyu da ekranı da döver.
  const dovizSayi = sayiOku(dovizTutar);
  useEffect(() => {
    if (!acik || !Number.isFinite(dovizSayi) || dovizSayi <= 0) { setOnizleme(null); return; }
    let iptal = false;
    const t = setTimeout(() => {
      void onizleDoviz(dovizYon, dovizSayi).then((o) => { if (!iptal) setOnizleme(o); });
    }, 400);
    return () => { iptal = true; clearTimeout(t); };
  }, [acik, dovizSayi, dovizYon, onizleDoviz]);

  async function bozdurmaYap() {
    if (onizleme === null || !onizleme.affordable || bekliyor) return;
    setBekliyor(true); setHata(null);
    const sonuc = await bozdur(dovizYon, dovizSayi);
    setBekliyor(false);
    if (sonuc === null) { setDovizTutar(''); setOnizleme(null); } else setHata(sonuc);
  }

  const miktarSayi = sayiOku(miktar);
  const urunler = (durum?.products ?? []).filter(
    (u) => (yon === 'IMPORT' ? u.importable : u.exportable));
  const seciliUrun = urunler.find((u) => u.code === secili) ?? null;
  const ticaretOlur = tesisId !== null && seciliUrun !== null
    && Number.isFinite(miktarSayi) && miktarSayi > 0 && !bekliyor;

  async function ticaretYap() {
    if (!ticaretOlur || tesisId === null || seciliUrun === null) return;
    setBekliyor(true); setHata(null);
    const sonuc = await ticaret({
      yon, facilityId: tesisId, productCode: seciliUrun.code, quantity: miktarSayi,
    });
    setBekliyor(false);
    if (sonuc === null) { setMiktar(''); setSecili(null); } else setHata(sonuc);
  }

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI name="ferry" size={19} color={renk.mavi} />
            <Text style={s.baslik}>Dış ticaret</Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>

          {durum === null
            ? <View style={s.orta}><ActivityIndicator color={renk.mavi} /></View>
            : (
              <>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {/* ★ Engel varsa SEBEBİ söylenir; üçünün çaresi farklı. */}
                  {durum.levelLocked && (
                    <Engel ikon="lock-outline" yazi={
                      `Dış ticaret için seviye ${durum.unlockLevel} gerekli — şu an ${durum.level}.`} />
                  )}
                  {!durum.levelLocked && durum.ports.length === 0 && (
                    <Engel ikon="ferry" yazi="Dış ticaret yalnız Liman üzerinden yapılır." />
                  )}
                  {!durum.levelLocked && durum.ports.length > 0 && !durum.canTrade && (
                    <Engel ikon="hammer-wrench" yazi="Liman inşaatı henüz bitmedi." />
                  )}

                  <View style={s.ustSatir}>
                    <Kutu etiket="döviz kasası" deger={`$ ${durum.usdBalanceFormatted}`} vurgu />
                    <Kutu etiket="kur" deger={`${durum.fxRateFormatted} / $`} />
                  </View>

                  <Text style={s.altBaslik}>DÖVİZ</Text>
                  <View style={s.yonSerit}>
                    <YonPul secili={dovizYon === 'BUY_USD'} yazi="₺ ver, $ al"
                      bas={() => setDovizYon('BUY_USD')} />
                    <YonPul secili={dovizYon === 'SELL_USD'} yazi="$ ver, ₺ al"
                      bas={() => setDovizYon('SELL_USD')} />
                  </View>
                  <TextInput
                    style={s.giris} value={dovizTutar} onChangeText={setDovizTutar}
                    keyboardType="decimal-pad" placeholder="0 $"
                    placeholderTextColor={renk.cokSoluk}
                  />
                  {onizleme && (
                    <View style={s.onizlemeKart}>
                      <View style={s.onizlemeSatir}>
                        <Text style={s.onizlemeEtiket}>
                          {dovizYon === 'BUY_USD' ? 'ödeyeceğin' : 'alacağın'}
                        </Text>
                        <Text style={s.onizlemeDeger}>{onizleme.tryAmountFormatted}</Text>
                      </View>
                      {/* ★ Spread iki yönde de maliyet: gidip gelmek bedava değil. */}
                      <View style={s.onizlemeSatir}>
                        <Text style={s.onizlemeEtiket}>bunun komisyonu</Text>
                        <Text style={[s.onizlemeDeger, { color: renk.uyari }]}>
                          {onizleme.spreadFormatted}
                        </Text>
                      </View>
                      <Pressable
                        disabled={!onizleme.affordable || bekliyor}
                        onPress={() => void bozdurmaYap()}
                        style={[s.kucukDugme, !onizleme.affordable && s.kucukDugmePasif]}
                      >
                        <Text style={[s.kucukYazi, !onizleme.affordable && s.pasifYazi]}>
                          {onizleme.affordable ? 'Bozdur' : 'Bakiye yetmiyor'}
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  <Text style={s.altBaslik}>DÜNYA PAZARI</Text>
                  <View style={s.yonSerit}>
                    <YonPul secili={yon === 'IMPORT'} yazi="İthalat"
                      bas={() => { setYon('IMPORT'); setSecili(null); }} />
                    <YonPul secili={yon === 'EXPORT'} yazi="İhracat"
                      bas={() => { setYon('EXPORT'); setSecili(null); }} />
                  </View>

                  {urunler.length === 0
                    ? <Text style={s.bos}>Bu yönde işlem gören ürün yok.</Text>
                    : urunler.map((u) => (
                      <UrunSatiri
                        key={u.code} u={u} yon={yon} secili={secili === u.code}
                        bas={() => setSecili(secili === u.code ? null : u.code)}
                      />
                    ))}

                  {seciliUrun && (
                    <>
                      <Text style={s.etiket}>MİKTAR ({seciliUrun.unit})</Text>
                      <TextInput
                        style={s.giris} value={miktar} onChangeText={setMiktar}
                        keyboardType="decimal-pad" placeholder="0"
                        placeholderTextColor={renk.cokSoluk}
                      />
                      <Text style={s.ipucu}>
                        {yon === 'IMPORT'
                          ? `birim ${seciliUrun.importPriceUsdFormatted} $ · bu turda kalan ${seciliUrun.importRemainingFormatted}`
                          : `birim ${seciliUrun.exportPriceUsdFormatted} $ · bu turda kalan ${seciliUrun.exportRemainingFormatted}`}
                      </Text>
                    </>
                  )}

                  {hata && (
                    <View style={s.uyariSatir}>
                      <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                      <Text style={s.uyari}>{hata}</Text>
                    </View>
                  )}

                  <Text style={s.not}>
                    Fiyatı dünya belirler, sen değil. Her turda sınırlı miktar
                    işlem görür; kapasite dolunca tur sonunu beklersin.
                  </Text>
                </ScrollView>

                {/* Düğme kaydırma alanının DIŞINDA: liste uzayınca kaybolmasın. */}
                <Pressable disabled={!ticaretOlur} onPress={() => void ticaretYap()}>
                  <LinearGradient
                    colors={ticaretOlur ? gradyan.altin : [renk.kenar, renk.kenar]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[s.dugme, ticaretOlur && golge.altin]}
                  >
                    {bekliyor
                      ? <ActivityIndicator color="#3D2A00" />
                      : (
                        <Text style={[s.dugmeYazi, !ticaretOlur && s.pasifYazi]}>
                          {seciliUrun
                            ? `${seciliUrun.name} ${yon === 'IMPORT' ? 'ithal et' : 'ihraç et'}`
                            : 'Ürün seç'}
                        </Text>
                      )}
                  </LinearGradient>
                </Pressable>
              </>
            )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function UrunSatiri({ u, yon, secili, bas }: {
  u: DisUrun; yon: Yon; secili: boolean; bas: () => void;
}) {
  const usd = yon === 'IMPORT' ? u.importPriceUsdFormatted : u.exportPriceUsdFormatted;
  const tl = yon === 'IMPORT' ? u.importPriceTryFormatted : u.exportPriceTryFormatted;
  const kalan = yon === 'IMPORT' ? u.importRemainingFormatted : u.exportRemainingFormatted;
  const tukendi = BigInt(yon === 'IMPORT' ? u.importRemaining : u.exportRemaining) <= 0n;
  return (
    <Pressable onPress={bas} style={[s.urun, secili && s.urunSecili]}>
      <View style={s.bosluk}>
        <Text style={s.urunAd}>{u.name}</Text>
        <Text style={s.urunAlt}>
          {tukendi ? 'bu turda kapasite doldu' : `kalan ${kalan}`}
        </Text>
      </View>
      <View style={s.urunFiyat}>
        <Text style={s.usd}>{usd} $</Text>
        {/* ₺ karşılığı sunucuda hesaplanır: oyuncu kasasını ₺ tutuyor. */}
        <Text style={s.tl}>≈ {tl}</Text>
      </View>
    </Pressable>
  );
}

function YonPul({ secili, yazi, bas }: { secili: boolean; yazi: string; bas: () => void }) {
  return (
    <Pressable onPress={bas} style={[s.yonPul, secili && s.yonPulAktif]}>
      <Text style={[s.yonYazi, secili && s.yonYaziAktif]}>{yazi}</Text>
    </Pressable>
  );
}

function Engel({ ikon, yazi }: { ikon: 'lock-outline' | 'ferry' | 'hammer-wrench'; yazi: string }) {
  return (
    <View style={s.engel}>
      <MCI name={ikon} size={16} color={renk.uyari} />
      <Text style={s.engelYazi}>{yazi}</Text>
    </View>
  );
}

function Kutu({ etiket, deger, vurgu = false }:
{ etiket: string; deger: string; vurgu?: boolean }) {
  return (
    <View style={[s.kutu, vurgu && s.kutuVurgu]}>
      <Text style={s.kutuEtiket}>{etiket}</Text>
      <Text style={[s.kutuDeger, vurgu && { color: renk.mavi }]} numberOfLines={1}>{deger}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    backgroundColor: renk.kartUst, borderTopLeftRadius: yuvarlak.xl,
    borderTopRightRadius: yuvarlak.xl, borderTopWidth: 1, borderColor: renk.kenarIsik,
    paddingHorizontal: bosluk.l, paddingTop: bosluk.s, maxHeight: '88%',
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginBottom: bosluk.m },
  baslik: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslik },
  bosluk: { flex: 1 },
  orta: { paddingVertical: bosluk.xxl },

  engel: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.s,
    padding: bosluk.m, borderRadius: yuvarlak.m, marginBottom: bosluk.m,
    backgroundColor: 'rgba(255,159,69,0.10)', borderWidth: 1,
    borderColor: 'rgba(255,159,69,0.35)',
  },
  engelYazi: { color: renk.uyari, fontSize: 13.5, flex: 1, fontFamily: yaziTipi.govde },

  ustSatir: { flexDirection: 'row', gap: bosluk.s },
  kutu: {
    flex: 1, backgroundColor: renk.kart, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: renk.kenar, padding: bosluk.m,
  },
  kutuVurgu: { borderColor: 'rgba(90,160,255,0.35)', backgroundColor: 'rgba(90,160,255,0.08)' },
  kutuEtiket: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },
  kutuDeger: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.rakam, marginTop: 3 },

  altBaslik: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.l, marginBottom: bosluk.s,
  },
  etiket: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.m, marginBottom: 6,
  },

  yonSerit: { flexDirection: 'row', gap: bosluk.s, marginBottom: bosluk.s },
  yonPul: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: yuvarlak.tam,
    backgroundColor: renk.kart, borderWidth: 1, borderColor: renk.kenar,
  },
  yonPulAktif: { backgroundColor: 'rgba(90,160,255,0.16)', borderColor: renk.mavi },
  yonYazi: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  yonYaziAktif: { color: renk.mavi },

  giris: {
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 18, fontFamily: yaziTipi.rakam,
  },
  ipucu: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde, marginTop: 6 },

  onizlemeKart: {
    marginTop: bosluk.m, padding: bosluk.m, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(90,160,255,0.08)', borderWidth: 1,
    borderColor: 'rgba(90,160,255,0.28)',
  },
  onizlemeSatir: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 },
  onizlemeEtiket: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde, flex: 1 },
  onizlemeDeger: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.rakam },
  kucukDugme: {
    alignItems: 'center', paddingVertical: 9, borderRadius: yuvarlak.m, marginTop: bosluk.s,
    backgroundColor: 'rgba(90,160,255,0.18)', borderWidth: 1, borderColor: renk.mavi,
  },
  kucukDugmePasif: { backgroundColor: renk.kart, borderColor: renk.kenar },
  kucukYazi: { color: renk.mavi, fontSize: 14, fontFamily: yaziTipi.baslikOrta },
  pasifYazi: { color: renk.cokSoluk },

  urun: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.s,
    paddingVertical: bosluk.s, paddingHorizontal: bosluk.m, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: 'transparent',
  },
  urunSecili: {
    backgroundColor: 'rgba(255,194,75,0.10)', borderColor: 'rgba(255,194,75,0.35)',
  },
  urunAd: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govdeOrta },
  urunAlt: { color: renk.cokSoluk, fontSize: 11.5, fontFamily: yaziTipi.govde, marginTop: 1 },
  urunFiyat: { alignItems: 'flex-end' },
  usd: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.rakam },
  tl: { color: renk.cokSoluk, fontSize: 11.5, fontFamily: yaziTipi.rakam, marginTop: 1 },
  bos: { color: renk.soluk, fontSize: 13.5, fontFamily: yaziTipi.govde, paddingVertical: bosluk.m },

  uyariSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  uyari: { color: renk.eksi, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    alignItems: 'center', justifyContent: 'center', borderRadius: yuvarlak.m,
    paddingVertical: bosluk.l, marginTop: bosluk.m,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, marginTop: bosluk.m, fontFamily: yaziTipi.govde },
});
