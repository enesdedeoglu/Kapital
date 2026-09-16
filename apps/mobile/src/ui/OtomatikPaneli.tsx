import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { OtomatikKural, Tesis, Urun } from '~/api/types';
import { tesisEtiketi } from './tesisEtiketi';
import { bosluk, renk, yaziTipi, yuvarlak } from './tema';

export interface KuralGirdisi {
  facilityId: string;
  productCode: string;
  kind: 'RESTOCK' | 'SELL_SURPLUS';
  targetQuantity: number;
  maxPricePerUnit?: number;
  minPricePerUnit?: number;
}

/**
 * Otomatik sipariş (kalıcı emirler) paneli.
 *
 * ★ NEDEN VAR: docs/00'ın 3. ilkesi "oyuncu offline'ken ekonomi devam eder"
 * diyor. Motor devam ediyordu ama oyuncunun katılma yolu yoktu — girmeyenin
 * rafı boşalıyor, satışı duruyor, bakımı işlemeye devam ediyordu. "Sen yokken"
 * raporunun bir numaralı şikâyeti buydu; bu panel o şikâyetin cevabı.
 *
 * ★ KURALIN NE YAPACAĞINI SUNUCU ANLATIR (`explanation`). Cümleyi burada
 * kurmak, motorun kararıyla ekranın anlattığının ayrışmasına açık kapı
 * bırakırdı: kural değişir, metin eski kalır. Oyuncu kuralın ne yapacağını
 * OKUYARAK anlamalı, deneyerek değil.
 */
export function OtomatikPaneli({
  tesis, kurallar, urunler, seviye, yukleniyor, kapat, kaydet, sil,
}: {
  tesis: Tesis | null;
  kurallar: readonly OtomatikKural[];
  urunler: readonly Urun[];
  seviye: number;
  yukleniyor: boolean;
  kapat: () => void;
  kaydet: (g: KuralGirdisi) => Promise<string | null>;
  sil: (id: string) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [taraf, setTaraf] = useState<'RESTOCK' | 'SELL_SURPLUS'>('RESTOCK');
  const [urunKodu, setUrunKodu] = useState<string | null>(null);
  const [hedef, setHedef] = useState('');
  const [fiyat, setFiyat] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  const acik = tesis !== null;
  const buTesisinKurallari = useMemo(
    () => kurallar.filter((k) => k.facilityId === tesis?.id),
    [kurallar, tesis],
  );

  useEffect(() => {
    if (!acik) return;
    setHata(null);
    setUrunKodu((u) => u ?? urunler.find((x) => (x.unlockLevel ?? 1) <= seviye)?.code ?? null);
  }, [acik, urunler, seviye]);

  const urun = urunler.find((u) => u.code === urunKodu) ?? null;
  const kilitli = urun !== null && (urun.unlockLevel ?? 1) > seviye;
  const hedefSayi = Number(hedef.replace(',', '.'));
  const fiyatSayi = fiyat.trim() === '' ? undefined : Number(fiyat.replace(',', '.'));
  const fiyatGecerli = fiyatSayi === undefined || (Number.isFinite(fiyatSayi) && fiyatSayi > 0);
  const gecerli = tesis !== null && urun !== null && !kilitli
    && Number.isFinite(hedefSayi) && hedefSayi > 0 && fiyatGecerli;

  async function onayla() {
    if (!gecerli || !tesis || !urun) return;
    setBekliyor(true);
    setHata(null);
    const sonuc = await kaydet({
      facilityId: tesis.id,
      productCode: urun.code,
      kind: taraf,
      targetQuantity: hedefSayi,
      /*
       * ★ Fiyat alanı TARAFA GÖRE ayrı alan: sunucu "stok tamamlamada taban
       * fiyat kullanılmaz" diye reddediyor. Tek alanı iki yere göndermek
       * oyuncuya sebebi anlaşılmaz bir hata döndürürdü.
       */
      ...(taraf === 'RESTOCK'
        ? { maxPricePerUnit: fiyatSayi }
        : { minPricePerUnit: fiyatSayi }),
    });
    setBekliyor(false);
    if (sonuc === null) { setHedef(''); setFiyat(''); } else setHata(sonuc);
  }

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
          <View style={s.tutamak} />
          <View style={s.baslikSatir}>
            <MCI name="autorenew" size={19} color={renk.artı} />
            <Text style={s.baslik}>
              Otomatik sipariş · {tesis ? tesisEtiketi(tesis) : ''}
            </Text>
            <View style={s.bosluk} />
            <Pressable onPress={kapat} hitSlop={12}>
              <MCI name="close" size={22} color={renk.soluk} />
            </Pressable>
          </View>
          <Text style={s.tanim}>
            Sen yokken şirketin bunları kendi yapar — raf boşalmadan tamamlar,
            fazlayı satışa çıkarır.
          </Text>

          {yukleniyor
            ? <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>
            : (
              <ScrollView keyboardShouldPersistTaps="handled" style={s.govde}>
                {buTesisinKurallari.length > 0 && (
                  <>
                    <Text style={s.etiket}>ÇALIŞAN KURALLAR</Text>
                    {buTesisinKurallari.map((k) => (
                      <View key={k.id} style={s.kural}>
                        <MCI
                          name={k.kind === 'RESTOCK' ? 'cart-arrow-down' : 'cart-arrow-up'}
                          size={16} color={k.kind === 'RESTOCK' ? renk.mavi : renk.altin}
                        />
                        <Text style={s.kuralYazi}>{k.explanation}</Text>
                        <Pressable onPress={() => void sil(k.id)} hitSlop={10}>
                          <MCI name="close-circle-outline" size={19} color={renk.eksi} />
                        </Pressable>
                      </View>
                    ))}
                  </>
                )}

                <Text style={[s.etiket, buTesisinKurallari.length > 0 && s.etiketAra]}>
                  YENİ KURAL
                </Text>
                <View style={s.tarafSatir}>
                  <Pressable
                    onPress={() => { setTaraf('RESTOCK'); setFiyat(''); setHata(null); }}
                    style={[s.taraf, taraf === 'RESTOCK' && s.tarafAlis]}
                  >
                    <MCI name="cart-arrow-down" size={16}
                      color={taraf === 'RESTOCK' ? renk.mavi : renk.cokSoluk} />
                    <Text style={[s.tarafYazi, taraf === 'RESTOCK' && { color: renk.mavi }]}>
                      Stok tamamla
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setTaraf('SELL_SURPLUS'); setFiyat(''); setHata(null); }}
                    style={[s.taraf, taraf === 'SELL_SURPLUS' && s.tarafSatis]}
                  >
                    <MCI name="cart-arrow-up" size={16}
                      color={taraf === 'SELL_SURPLUS' ? renk.altin : renk.cokSoluk} />
                    <Text style={[s.tarafYazi, taraf === 'SELL_SURPLUS' && { color: renk.altin }]}>
                      Fazlayı sat
                    </Text>
                  </Pressable>
                </View>

                <Text style={s.etiket}>ÜRÜN</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.seritIc} style={s.serit}>
                  {urunler.map((u) => {
                    const secili = u.code === urunKodu;
                    const kilit = (u.unlockLevel ?? 1) > seviye;
                    return (
                      <Pressable key={u.code} onPress={() => { setUrunKodu(u.code); setHata(null); }}
                        style={[s.pul, secili && s.pulAktif, kilit && s.pulKilitli]}>
                        {kilit && <MCI name="lock" size={11} color={renk.cokSoluk} />}
                        <Text style={[s.pulYazi, secili && s.pulYaziAktif]}>{u.name}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={s.etiket}>
                  {taraf === 'RESTOCK' ? 'RAFTA TUTULACAK MİKTAR' : 'ELDE TUTULACAK MİKTAR'}
                  {urun ? ` (${urun.unit})` : ''}
                </Text>
                <TextInput
                  style={s.giris} value={hedef} onChangeText={setHedef}
                  keyboardType="decimal-pad" placeholder="0"
                  placeholderTextColor={renk.cokSoluk}
                />
                <Text style={s.ipucu}>
                  {taraf === 'RESTOCK'
                    ? 'Stok bu sayının altına düşünce otomatik alım yapılır.'
                    : 'Bu sayının üstündeki fazla otomatik satışa çıkar.'}
                </Text>

                <Text style={s.etiket}>
                  {taraf === 'RESTOCK' ? 'TAVAN BİRİM FİYAT' : 'TABAN BİRİM FİYAT'} · isteğe bağlı
                </Text>
                <TextInput
                  style={s.giris} value={fiyat} onChangeText={setFiyat}
                  keyboardType="decimal-pad" placeholder="sınır yok"
                  placeholderTextColor={renk.cokSoluk}
                />

              </ScrollView>
            )}

          {/*
            ★ Kaydet düğmesi KAYDIRMANIN DIŞINDA. İçeride bıraktığımda ekranın
            altında kalıyordu ve oyuncu formu doldurup düğmeyi göremiyordu —
            tesis kurma panelinde düzelttiğim hatanın aynısını burada tekrar
            yapmışım. Hata satırı da düğmeyle birlikte durur: sebebi görmeden
            pasif bir düğmeye bakmak en kötüsü.
          */}
          {!yukleniyor && (
            <View style={s.altBolum}>
              {kilitli && urun && (
                <View style={s.hataSatir}>
                  <MCI name="lock-outline" size={15} color={renk.uyari} />
                  <Text style={[s.hata, { color: renk.uyari }]}>
                    {urun.name} için seviye {urun.unlockLevel} gerekli.
                  </Text>
                </View>
              )}
              {hata && (
                <View style={s.hataSatir}>
                  <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                  <Text style={s.hata}>{hata}</Text>
                </View>
              )}

              <Pressable
                onPress={() => void onayla()}
                disabled={!gecerli || bekliyor}
                style={[s.dugme, (!gecerli || bekliyor) && s.dugmePasif]}
              >
                {bekliyor
                  ? <ActivityIndicator color={renk.zemin} />
                  : <Text style={s.dugmeYazi}>Kuralı kaydet</Text>}
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  baslik: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.baslikOrta, flexShrink: 1 },
  bosluk: { flex: 1 },
  tanim: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, fontFamily: yaziTipi.govde, marginTop: 4 },
  govde: { marginTop: bosluk.m },
  altBolum: { borderTopWidth: 1, borderTopColor: renk.kenar, marginTop: bosluk.s },
  orta: { paddingVertical: bosluk.xxl },

  etiket: {
    color: renk.cokSoluk, fontSize: 10, letterSpacing: 1,
    fontFamily: yaziTipi.etiket, marginBottom: 6, marginTop: bosluk.m,
  },
  etiketAra: { marginTop: bosluk.l },

  kural: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingVertical: 10, paddingHorizontal: bosluk.m, marginBottom: 6,
    borderRadius: yuvarlak.m, borderWidth: 1, borderColor: renk.kenar,
    backgroundColor: renk.kartUst,
  },
  kuralYazi: { color: renk.soluk, fontSize: 13, lineHeight: 19, flex: 1, fontFamily: yaziTipi.govde },

  tarafSatir: { flexDirection: 'row', gap: bosluk.s },
  taraf: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: renk.kenar, backgroundColor: renk.kartUst,
  },
  tarafAlis: { borderColor: renk.mavi, backgroundColor: 'rgba(78,161,255,0.10)' },
  tarafSatis: { borderColor: renk.altin, backgroundColor: 'rgba(255,194,75,0.10)' },
  tarafYazi: { color: renk.cokSoluk, fontSize: 14, fontFamily: yaziTipi.govdeOrta },

  serit: { marginHorizontal: -bosluk.l },
  seritIc: { paddingHorizontal: bosluk.l, gap: 6 },
  pul: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: bosluk.m, paddingVertical: 8, borderRadius: yuvarlak.tam,
    borderWidth: 1, borderColor: renk.kenar, backgroundColor: renk.kartUst,
  },
  pulAktif: { borderColor: renk.altin, backgroundColor: 'rgba(255,194,75,0.14)' },
  pulKilitli: { opacity: 0.55 },
  pulYazi: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde },
  pulYaziAktif: { color: renk.altin, fontFamily: yaziTipi.govdeOrta },

  giris: {
    backgroundColor: renk.kartUst, borderWidth: 1, borderColor: renk.kenar,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.m, paddingVertical: 12,
    color: renk.metin, fontSize: 17, fontFamily: yaziTipi.rakam,
  },
  ipucu: { color: renk.cokSoluk, fontSize: 12, lineHeight: 17, fontFamily: yaziTipi.govde, marginTop: 5 },

  hataSatir: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: bosluk.m },
  hata: { color: renk.eksi, fontSize: 13, lineHeight: 19, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    marginTop: bosluk.m, paddingVertical: 15,
    borderRadius: yuvarlak.m, backgroundColor: renk.artı, alignItems: 'center',
  },
  dugmePasif: { backgroundColor: renk.kenar },
  dugmeYazi: { color: '#07211A', fontSize: 16, fontFamily: yaziTipi.baslikOrta },
});
