import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Kredi, KrediDurumu, KrediOnizleme } from '~/api/types';
import { sayiOku } from './sayiOku';
import { bosluk, golge, gradyan, renk, yaziTipi, yuvarlak } from './tema';

/** Bir tur 15 dakika; vade turla tutulur ama oyuncuya GÜN olarak gösterilir. */
const TUR_GUN = 96;

/**
 * ★ UYARI EŞİKLERİ BİR ARAYÜZ KARARI — spec'ten gelmiyor.
 *
 * `paymentBurden` taksidin tur gelirine oranıdır ve sunucu yalnız oranı verir
 * (R16); "ne kadarı fazla" sorusunun cevabı ekranda verilir. Gelirinin yarısı
 * taksite gidiyorsa oyuncu uyarılmalı, beşte dördü gidiyorsa bu artık bir
 * uyarı değil bir tehlike.
 */
const YUK_UYARI = 0.5;
const YUK_TEHLIKE = 0.8;

/**
 * Kredi paneli — limit, faiz, açık borçlar ve "alırsam ne öderim".
 *
 * ★★★★ KREDİ SİSTEMİ TAMAMEN GÖRÜNMEZDİ (R100). `/loans` uçları vardı —
 * limit, faiz, taksit, erken kapatma — ama mobil uygulamada onları çağıran
 * tek bir ekran yoktu. Nakdi biten oyuncunun elinde tesis satmaktan başka
 * yol yoktu; oysa sistem kurulu ve turda taksitleri tahsil ediyordu.
 *
 * ★ TAKSİT TAAHHÜTTEN ÖNCE GÖSTERİLİR. Oyuncu 2.688 tura kadar sürecek bir
 * ödemeye giriyor; "ne kadar alıyorum"u bilip "ne kadar ödeyeceğim"i
 * bilmemek karar değil kumar olurdu. Rakam sunucudan gelir ve çekilen
 * kredininkiyle birebir aynıdır (testi var).
 */
export function KrediPaneli({ acik, durum, onizle, kapat, cek, kapatKredi }: {
  acik: boolean;
  /** null = yükleniyor. */
  durum: KrediDurumu | null;
  onizle: (tutar: number, vade: number) => Promise<KrediOnizleme | null>;
  kapat: () => void;
  cek: (tutar: number, vade: number) => Promise<string | null>;
  kapatKredi: (id: string) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [tutar, setTutar] = useState('');
  const [vade, setVade] = useState<number | null>(null);
  const [onizleme, setOnizleme] = useState<KrediOnizleme | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  const azamiVade = durum?.maxTermTicks ?? 0;
  const secilenVade = vade ?? azamiVade;

  // Vade seçenekleri: kısa vade = yüksek taksit, az faiz. Gerçek bir tercih.
  const vadeler = useMemo(
    () => (azamiVade === 0 ? [] : [Math.round(azamiVade / 4), Math.round(azamiVade / 2), azamiVade]
      .filter((v, i, a) => v > 0 && a.indexOf(v) === i)),
    [azamiVade],
  );

  useEffect(() => { if (!acik) { setTutar(''); setOnizleme(null); setHata(null); setVade(null); } }, [acik]);

  /*
   * ★ ÖNİZLEME GECİKMELİ: her tuşta istek atmak hem sunucuyu hem de ekranı
   * döverdi. 400 ms yazmayı bitirmeye yetiyor, karar vermeyi bekletmiyor.
   */
  const tutarSayi = sayiOku(tutar);
  useEffect(() => {
    if (!acik || !Number.isFinite(tutarSayi) || tutarSayi <= 0 || secilenVade <= 0) {
      setOnizleme(null);
      return;
    }
    let iptal = false;
    const t = setTimeout(() => {
      void onizle(tutarSayi, secilenVade).then((o) => { if (!iptal) setOnizleme(o); });
    }, 400);
    return () => { iptal = true; clearTimeout(t); };
  }, [acik, tutarSayi, secilenVade, onizle]);

  const alinabilir = onizleme !== null && !onizleme.exceedsLimit && !bekliyor;

  async function al() {
    if (!alinabilir) return;
    setBekliyor(true);
    setHata(null);
    const sonuc = await cek(tutarSayi, secilenVade);
    setBekliyor(false);
    if (sonuc === null) { setTutar(''); setOnizleme(null); } else setHata(sonuc);
  }

  async function erkenKapat(id: string) {
    setBekliyor(true);
    setHata(null);
    const sonuc = await kapatKredi(id);
    setBekliyor(false);
    if (sonuc !== null) setHata(sonuc);
  }

  const acikKrediler = (durum?.loans ?? []).filter((k) => k.status === 'ACTIVE');

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI name="bank-outline" size={19} color={renk.mavi} />
            <Text style={s.baslik}>Kredi</Text>
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
                  <View style={s.ustSatir}>
                    <Kutu etiket="kullanılabilir limit" deger={durum.availableCreditFormatted} vurgu />
                    <Kutu etiket="toplam borç" deger={durum.totalDebtFormatted} />
                  </View>
                  <Text style={s.faiz}>
                    yıllık faiz ≈ %{durum.interestRateAnnualPct.toFixed(1)} · azami vade{' '}
                    {Math.round(durum.maxTermTicks / TUR_GUN)} gün
                  </Text>

                  {acikKrediler.length > 0 && (
                    <>
                      <Text style={s.altBaslik}>AÇIK KREDİLER</Text>
                      {acikKrediler.map((k) => (
                        <KrediSatiri key={k.id} k={k} kapat={() => void erkenKapat(k.id)}
                          kilitli={bekliyor} />
                      ))}
                    </>
                  )}

                  <Text style={s.altBaslik}>YENİ KREDİ</Text>
                  <Text style={s.etiket}>TUTAR (₺)</Text>
                  <TextInput
                    style={[s.giris, onizleme?.exceedsLimit && s.girisUyari]}
                    value={tutar} onChangeText={setTutar}
                    keyboardType="decimal-pad" placeholder="0"
                    placeholderTextColor={renk.cokSoluk}
                  />

                  {vadeler.length > 0 && (
                    <>
                      <Text style={s.etiket}>VADE</Text>
                      <View style={s.vadeSerit}>
                        {vadeler.map((v) => {
                          const secili = secilenVade === v;
                          return (
                            <Pressable key={v} onPress={() => setVade(v)}
                              style={[s.vadePul, secili && s.vadePulAktif]}>
                              <Text style={[s.vadeYazi, secili && s.vadeYaziAktif]}>
                                {Math.round(v / TUR_GUN)} gün
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {onizleme && (
                    <View style={s.onizlemeKart}>
                      <View style={s.onizlemeSatir}>
                        <Text style={s.onizlemeEtiket}>tur taksidi</Text>
                        <Text style={s.onizlemeDeger}>{onizleme.paymentPerTickFormatted}</Text>
                      </View>
                      <View style={s.onizlemeSatir}>
                        <Text style={s.onizlemeEtiket}>vade sonuna kadar toplam</Text>
                        <Text style={s.onizlemeDeger}>{onizleme.totalPaymentFormatted}</Text>
                      </View>
                      <View style={s.onizlemeSatir}>
                        <Text style={s.onizlemeEtiket}>bunun faizi</Text>
                        <Text style={[s.onizlemeDeger, { color: renk.uyari }]}>
                          {onizleme.totalInterestFormatted}
                        </Text>
                      </View>
                      <YukUyarisi oran={onizleme.paymentBurden} />
                      {onizleme.exceedsLimit && (
                        <View style={s.uyariSatir}>
                          <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                          <Text style={s.uyari}>
                            Limitin üstünde — en fazla {onizleme.availableCreditFormatted}.
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {hata && (
                    <View style={s.uyariSatir}>
                      <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                      <Text style={s.uyari}>{hata}</Text>
                    </View>
                  )}

                  <Text style={s.not}>
                    Taksit her turda kasadan otomatik düşer. Ödenmeyen taksit
                    birikirse tesislerin satılır.
                  </Text>
                </ScrollView>

                {/* Düğme kaydırma alanının DIŞINDA: liste uzayınca altta kaybolmasın. */}
                <Pressable disabled={!alinabilir} onPress={() => void al()}>
                  <LinearGradient
                    colors={alinabilir ? gradyan.altin : [renk.kenar, renk.kenar]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[s.dugme, alinabilir && golge.altin]}
                  >
                    {bekliyor
                      ? <ActivityIndicator color="#3D2A00" />
                      : (
                        <Text style={[s.dugmeYazi, !alinabilir && s.dugmeYaziPasif]}>
                          {onizleme ? `${onizleme.amountFormatted} kredi al` : 'Tutar gir'}
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

function KrediSatiri({ k, kapat, kilitli }: {
  k: Kredi; kapat: () => void; kilitli: boolean;
}) {
  return (
    <View style={s.kredi}>
      <View style={s.krediUst}>
        <Text style={s.krediBakiye}>{k.remainingBalanceFormatted}</Text>
        <Text style={s.krediAlt}>
          {k.paymentPerTickFormatted}/tur · {Math.max(0, Math.round(k.ticksRemaining / TUR_GUN))} gün
        </Text>
        <View style={s.bosluk} />
        <Pressable onPress={kapat} disabled={kilitli} style={s.kapatDugme}>
          <Text style={s.kapatYazi}>erken kapat</Text>
        </Pressable>
      </View>
      {k.missedPayments > 0 && (
        <View style={s.uyariSatir}>
          <MCI name="alert" size={14} color={renk.eksi} />
          <Text style={s.uyari}>{k.missedPayments} taksit ödenmedi.</Text>
        </View>
      )}
      <YukUyarisi oran={k.paymentBurden} />
    </View>
  );
}

/** Taksidin gelire oranı — batmadan önce görünsün (R16). */
function YukUyarisi({ oran }: { oran: number | null }) {
  if (oran === null || oran < YUK_UYARI) return null;
  const tehlike = oran >= YUK_TEHLIKE;
  return (
    <View style={s.uyariSatir}>
      <MCI
        name={tehlike ? 'alert-octagon-outline' : 'alert-outline'}
        size={15} color={tehlike ? renk.eksi : renk.uyari}
      />
      <Text style={[s.uyari, !tehlike && { color: renk.uyari }]}>
        Taksit, tur gelirinin %{Math.round(oran * 100)}'ini götürüyor
        {tehlike ? ' — bu borç seni batırır.' : '.'}
      </Text>
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

  ustSatir: { flexDirection: 'row', gap: bosluk.s },
  kutu: {
    flex: 1, backgroundColor: renk.kart, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: renk.kenar, padding: bosluk.m,
  },
  kutuVurgu: { borderColor: 'rgba(90,160,255,0.35)', backgroundColor: 'rgba(90,160,255,0.08)' },
  kutuEtiket: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },
  kutuDeger: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.rakam, marginTop: 3 },
  faiz: { color: renk.soluk, fontSize: 12.5, fontFamily: yaziTipi.govde, marginTop: bosluk.s },

  altBaslik: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.l, marginBottom: bosluk.s,
  },
  etiket: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.m, marginBottom: 6,
  },

  kredi: { paddingVertical: bosluk.s, borderTopWidth: 1, borderTopColor: renk.kenar },
  krediUst: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  krediBakiye: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.rakam },
  krediAlt: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  kapatDugme: {
    paddingHorizontal: bosluk.m, paddingVertical: 6, borderRadius: yuvarlak.tam,
    borderWidth: 1, borderColor: renk.kenarIsik,
  },
  kapatYazi: { color: renk.soluk, fontSize: 12, fontFamily: yaziTipi.govde },

  giris: {
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 18, fontFamily: yaziTipi.rakam,
  },
  girisUyari: { borderColor: renk.eksi },

  vadeSerit: { flexDirection: 'row', gap: bosluk.s, flexWrap: 'wrap' },
  vadePul: {
    paddingHorizontal: bosluk.m, paddingVertical: 8, borderRadius: yuvarlak.tam,
    backgroundColor: renk.kart, borderWidth: 1, borderColor: renk.kenar,
  },
  vadePulAktif: { backgroundColor: 'rgba(90,160,255,0.16)', borderColor: renk.mavi },
  vadeYazi: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govdeOrta },
  vadeYaziAktif: { color: renk.mavi },

  onizlemeKart: {
    marginTop: bosluk.m, padding: bosluk.m, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(90,160,255,0.08)', borderWidth: 1,
    borderColor: 'rgba(90,160,255,0.28)',
  },
  onizlemeSatir: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 },
  onizlemeEtiket: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde, flex: 1 },
  onizlemeDeger: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.rakam },

  uyariSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  uyari: { color: renk.eksi, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    alignItems: 'center', justifyContent: 'center', borderRadius: yuvarlak.m,
    paddingVertical: bosluk.l, marginTop: bosluk.m,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  dugmeYaziPasif: { color: renk.cokSoluk },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, marginTop: bosluk.m, fontFamily: yaziTipi.govde },
});
