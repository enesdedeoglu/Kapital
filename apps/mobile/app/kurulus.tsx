import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { ApiError } from '~/api/client';
import type { SehirBilgi } from '~/api/types';
import { useOturum } from '~/oturum';
import { bosluk, golge, gradyan, renk, yaziTipi, yuvarlak } from '~/ui/tema';

/**
 * Şirket kuruluşu — kayıttan sonraki ilk ekran.
 *
 * ★★★★ BU EKRAN YOKTU VE OYUN BAŞLAMIYORDU. `POST /company` ucu çalışıyor,
 * 30.000 ₺ sermayeyi ve ilk dükkânı veriyordu; ama mobilde onu çağıran
 * hiçbir yer yoktu. Kayıt olan oyuncu içeri giriyor, şirketi olmadığı için
 * her sekme boş ve kasası 0 ₺ görünüyor, ilerlemenin yolu bulunmuyordu.
 *
 * Hata görünmez kalmıştı çünkü geliştirme hep ŞİRKETİ OLAN test hesabıyla
 * yapılmıştı. İlk kez sıfırdan bir hesapla girildiğinde ortaya çıktı.
 *
 * ★ ÜÇ SEÇİM DE KALICIDIR ve bu ekranda söylenir: şirketin merkezi şehir
 * sonradan taşınmaz, ilk dükkân türü geri alınmaz. Oyuncunun kör seçim
 * yapmaması için her şehrin ve dükkânın ne anlama geldiği yazılı.
 */

/*
 * ★ AÇIKLAMALAR SEVİYE KİLİDİNİ SÖYLER. Seviye 1'de ticarete açık tek ürün
 * domates; ekmek Lv2, sigara Lv4'te açılıyor. "Büfe ekmek ve sigara satar"
 * demek, oyuncuya ilk gün yapamayacağı bir şeyi vadetmekti — dükkânını
 * dolduramayınca oyunun bozuk olduğunu düşünürdü.
 */
const DUKKANLAR = [
  {
    code: 'GREENGROCER', ad: 'Manav', ikon: 'storefront-outline' as const,
    aciklama: 'Sebze ve meyve satar. Domates ilk günden açık ve piyasası en canlı zincir.',
  },
  {
    code: 'KIOSK', ad: 'Büfe', ikon: 'store-outline' as const,
    aciklama: 'İlerisi için ekmek ve sigara; ikisi de seviyeyle açılır (Lv2 ve Lv4). '
      + 'Başlangıçta büfen de domates satar.',
  },
];

export default function Kurulus() {
  const { iste, cikisYap, sirketKuruldu } = useOturum();
  const router = useRouter();

  const [ad, setAd] = useState('');
  const [sehirler, setSehirler] = useState<SehirBilgi[] | null>(null);
  const [sehir, setSehir] = useState<string | null>(null);
  const [dukkan, setDukkan] = useState<string>('GREENGROCER');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const liste = await iste<SehirBilgi[]>('/cities');
        setSehirler(liste);
        setSehir((s) => s ?? liste[0]?.code ?? null);
      } catch {
        setSehirler([]);
        setHata('Şehir listesi alınamadı. Sunucuya ulaşılamıyor olabilir.');
      }
    })();
  }, [iste]);

  const gecerli = ad.trim().length >= 2 && sehir !== null && !bekliyor;

  const kur = useCallback(async () => {
    if (!gecerli || sehir === null) return;
    setBekliyor(true);
    setHata(null);
    try {
      await iste('/company', {
        method: 'POST',
        body: { name: ad.trim(), cityCode: sehir, facilityTypeCode: dukkan },
      });
      // ★ Kapı yeniden sorgulamasın diye durum burada güncellenir; yoksa
      // yönlendirme bu ekrana geri döner ve oyuncu döngüde kalır.
      sirketKuruldu();
      router.replace('/');
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Şirket kurulamadı');
    } finally {
      setBekliyor(false);
    }
  }, [gecerli, iste, ad, sehir, dukkan, sirketKuruldu, router]);

  return (
    <LinearGradient colors={gradyan.zemin} style={s.zemin}>
      <KeyboardAvoidingView style={s.zemin} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.govde} keyboardShouldPersistTaps="handled">
          <View style={s.marka}>
            <LinearGradient colors={gradyan.altin} style={[s.rozet, golge.altin]}>
              <MCI name="office-building-outline" size={30} color="#3D2A00" />
            </LinearGradient>
            <Text style={s.baslik}>Şirketini kur</Text>
            <Text style={s.slogan}>
              30.000 ₺ sermaye ve ilk dükkânın seni bekliyor.
            </Text>
          </View>

          <Text style={s.etiket}>ŞİRKET ADI</Text>
          <TextInput
            style={s.giris} value={ad} onChangeText={setAd}
            placeholder="Dedeoğlu Ticaret" placeholderTextColor={renk.cokSoluk}
            maxLength={60} autoCorrect={false}
          />

          <Text style={s.etiket}>MERKEZ ŞEHİR</Text>
          <Text style={s.ipucu}>Sonradan taşınamaz; ilk dükkânın da burada kurulur.</Text>
          {sehirler === null
            ? <ActivityIndicator color={renk.altin} style={s.yukleniyor} />
            : sehirler.map((c) => (
              <Pressable
                key={c.code} onPress={() => setSehir(c.code)}
                style={[s.secenek, c.code === sehir && s.secili]}
              >
                <View style={s.bosluk}>
                  <Text style={s.secenekAd}>{c.name}</Text>
                  <Text style={s.secenekAlt}>
                    {sehirOzeti(c)}
                  </Text>
                </View>
                {c.code === sehir && <MCI name="check-circle" size={20} color={renk.altin} />}
              </Pressable>
            ))}

          <Text style={s.etiket}>İLK DÜKKÂNIN</Text>
          <Text style={s.ipucu}>
            Bedeli sermayeden düşmez; kuruluş hediyesidir. Hangisini seçersen seç,
            ilk gün satabileceğin ürün domatestir — çeşit seviye atladıkça açılır.
          </Text>
          {DUKKANLAR.map((d) => (
            <Pressable
              key={d.code} onPress={() => setDukkan(d.code)}
              style={[s.secenek, d.code === dukkan && s.secili]}
            >
              <MCI name={d.ikon} size={22} color={d.code === dukkan ? renk.altin : renk.soluk} />
              <View style={s.bosluk}>
                <Text style={s.secenekAd}>{d.ad}</Text>
                <Text style={s.secenekAlt}>{d.aciklama}</Text>
              </View>
              {d.code === dukkan && <MCI name="check-circle" size={20} color={renk.altin} />}
            </Pressable>
          ))}

          {hata && (
            <View style={s.hataSatir}>
              <MCI name="alert-circle-outline" size={16} color={renk.eksi} />
              <Text style={s.hata}>{hata}</Text>
            </View>
          )}

          <Pressable onPress={() => void kur()} disabled={!gecerli}>
            <LinearGradient
              colors={gecerli ? gradyan.altin : [renk.kart, renk.kart]}
              style={s.dugme}
            >
              {bekliyor
                ? <ActivityIndicator color="#3D2A00" />
                : (
                  <>
                    <Text style={[s.dugmeYazi, !gecerli && s.dugmeYaziPasif]}>Şirketi kur</Text>
                    <MCI name="arrow-right" size={19}
                      color={gecerli ? '#3D2A00' : renk.cokSoluk} />
                  </>
                )}
            </LinearGradient>
          </Pressable>

          <Pressable onPress={() => void cikisYap()} style={s.cikisAlan}>
            <Text style={s.cikis}>Başka hesapla gir</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

/** Şehri oyuncunun kararını etkileyen iki sayıyla anlatır. */
function sehirOzeti(c: SehirBilgi): string {
  const talep = c.populationIndex * c.consumerDemandIndex;
  const buyukluk = talep >= 1.4 ? 'büyük talep' : talep >= 0.9 ? 'orta talep' : 'küçük talep';
  const arsa = c.landCostIndex >= 1.3 ? 'pahalı arsa'
    : c.landCostIndex <= 0.85 ? 'ucuz arsa' : 'orta arsa';
  return `${buyukluk} · ${arsa}${c.hasPort ? ' · liman kurulabilir' : ''}`;
}

const s = StyleSheet.create({
  zemin: { flex: 1 },
  govde: { flexGrow: 1, justifyContent: 'center', padding: bosluk.xl, gap: bosluk.s },

  marka: { alignItems: 'center', gap: 6, marginBottom: bosluk.m },
  rozet: {
    width: 64, height: 64, borderRadius: yuvarlak.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: bosluk.xs,
  },
  baslik: { color: renk.metin, fontSize: 26, fontFamily: yaziTipi.baslik, letterSpacing: 1 },
  slogan: {
    color: renk.soluk, fontSize: 14, textAlign: 'center', fontFamily: yaziTipi.govde,
  },

  etiket: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.l,
  },
  ipucu: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde, marginBottom: 6 },
  yukleniyor: { marginVertical: bosluk.l },

  giris: {
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    color: renk.metin, fontSize: 16, fontFamily: yaziTipi.govde, marginTop: 6,
  },

  secenek: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.m,
    backgroundColor: renk.kart, borderColor: renk.kenar, borderWidth: 1,
    borderRadius: yuvarlak.m, paddingHorizontal: bosluk.l, paddingVertical: bosluk.m,
    marginBottom: 6,
  },
  secili: { borderColor: renk.altin, backgroundColor: 'rgba(255,194,75,0.10)' },
  bosluk: { flex: 1 },
  secenekAd: { color: renk.metin, fontSize: 15.5, fontFamily: yaziTipi.govdeOrta },
  secenekAlt: {
    color: renk.cokSoluk, fontSize: 12.5, lineHeight: 18,
    fontFamily: yaziTipi.govde, marginTop: 2,
  },

  hataSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.xs, marginTop: bosluk.s },
  hata: { color: renk.eksi, fontSize: 14, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: bosluk.s,
    borderRadius: yuvarlak.m, paddingVertical: bosluk.l, marginTop: bosluk.l,
  },
  dugmeYazi: { color: '#3D2A00', fontSize: 16, fontFamily: yaziTipi.baslik, letterSpacing: 0.5 },
  dugmeYaziPasif: { color: renk.cokSoluk },

  cikisAlan: { paddingVertical: bosluk.m },
  cikis: { color: renk.mavi, textAlign: 'center', fontSize: 14, fontFamily: yaziTipi.govdeOrta },
});
