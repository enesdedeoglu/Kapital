import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import { useOturum } from '~/oturum';
import { useTur, useTurDegisince } from '~/tur';
import type { KrediDurumu, KrediOnizleme, Ozet, Sirket } from '~/api/types';
import { ApiError } from '~/api/client';
import { GeriSayim } from '~/ui/GeriSayim';
import { KrediPaneli } from '~/ui/KrediPaneli';
import {
  Etiket, KarRozeti, Kart, Kasa, KritikStok, Kutu, Olaylar, SeviyeRozeti,
} from '~/ui/parcalar';
import { bosluk, kisaPara, paraBicimle, renk, yaziTipi, yuvarlak } from '~/ui/tema';

export default function AnaSayfa() {
  const { iste } = useOturum();
  const { sonraki } = useTur();
  const kenar = useSafeAreaInsets();
  const [sirket, setSirket] = useState<Sirket | null>(null);
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);
  /*
   * ★ "Yüklendi" AYRI bir durumdur, "şirket var" değil. Önce yükleme koşulu
   * `!sirket && !hata` idi ve şirketi olmayan oyuncuda (404 → ikisi de null)
   * spinner sonsuza dek dönüyordu. Boş durumun kendisi de bir SONUÇTUR.
   */
  const [yuklendi, setYuklendi] = useState(false);

  /*
   * Kredi paneli. Durum TEMBEL çekilir: oyuncuların çoğu her açılışta kredi
   * bakmaz, ana sayfayı iki istekle açık tutmak daha önemli.
   */
  const [krediAcik, setKrediAcik] = useState(false);
  const [kredi, setKredi] = useState<KrediDurumu | null>(null);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      /*
       * İkisi PARALEL: şirket künyesi ile özet birbirini beklemez. Sıralı
       * olsaydı ekran iki gidiş-dönüş kadar geç dolardı.
       */
      const [s, o] = await Promise.all([
        iste<Sirket>('/company'),
        iste<Ozet>('/dashboard'),
      ]);
      setSirket(s);
      setOzet(o);
    } catch (e) {
      // Şirketi olmayan oyuncu: 404 hata değil, DURUM. İkisi de 404 döner.
      if (e instanceof ApiError && e.status === 404) { setSirket(null); setOzet(null); }
      else setHata(e instanceof ApiError ? e.message : 'Sunucuya ulaşılamadı');
    } finally {
      setYuklendi(true);
    }
  }, [iste]);

  useEffect(() => { void yukle(); }, [yukle]);
  // Tur düşünce ekran kendini tazeler — oyuncunun aşağı çekmesi gerekmez.
  useTurDegisince(() => {
    void yukle();
    // Taksit her turda kasadan düşer; panel açıksa bakiye eskimesin.
    if (krediAcik) void krediyiYukle();
  });

  const krediyiYukle = useCallback(async () => {
    try {
      setKredi(await iste<KrediDurumu>('/loans'));
    } catch (e) {
      setKredi(null);
      setHata(e instanceof ApiError ? e.message : 'Kredi bilgisi alınamadı');
    }
  }, [iste]);

  const krediyiAc = useCallback(() => {
    setKrediAcik(true);
    setKredi(null);
    void krediyiYukle();
  }, [krediyiYukle]);

  /*
   * ★ TAKSİT SUNUCUDAN SORULUR, İSTEMCİDE HESAPLANMAZ (ADR-0001):
   * `annuityPayment` float bir çarpanın ardından bigint çarpımı ve bankacı
   * yuvarlaması yapar. Burada yeniden yazmak, gösterilen taksidin her tur
   * tahsil edilenden sapması demekti.
   */
  const krediOnizle = useCallback(
    async (tutar: number, vade: number): Promise<KrediOnizleme | null> => {
      try {
        return await iste<KrediOnizleme>(
          `/loans/preview?amount=${tutar}&termTicks=${vade}`);
      } catch {
        return null;
      }
    }, [iste]);

  const krediCek = useCallback(
    async (tutar: number, vade: number): Promise<string | null> => {
      try {
        await iste('/loans', { method: 'POST', body: { amount: tutar, termTicks: vade } });
        await Promise.all([krediyiYukle(), yukle()]);
        return null;
      } catch (e) {
        return e instanceof ApiError ? e.message : 'Kredi alınamadı';
      }
    }, [iste, krediyiYukle, yukle]);

  const krediKapat = useCallback(async (id: string): Promise<string | null> => {
    try {
      await iste(`/loans/${id}/repay`, { method: 'POST' });
      await Promise.all([krediyiYukle(), yukle()]);
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Kredi kapatılamadı';
    }
  }, [iste, krediyiYukle, yukle]);

  if (!yuklendi) {
    return <View style={s.orta}><ActivityIndicator color={renk.altin} /></View>;
  }

  return (
    <>
    <ScrollView
      contentContainerStyle={[s.icerik, { paddingTop: kenar.top + 56 }]}
      refreshControl={
        <RefreshControl
          refreshing={yenileniyor} tintColor={renk.soluk}
          onRefresh={() => { setYenileniyor(true); void yukle().finally(() => setYenileniyor(false)); }}
        />
      }
    >
      {hata && (
        <Kart style={s.hataKart}>
          <Etiket ikon="wifi-off" yazi="BAĞLANTI" ton={renk.eksi} />
          <Text style={s.hata}>{hata}</Text>
        </Kart>
      )}

      {!sirket && !hata && (
        <>
          <View style={s.hosgeldin}>
            <MCI name="storefront-outline" size={44} color={renk.altin} />
            <Text style={s.hosBaslik}>Şirketini kur</Text>
            <Text style={s.hosAlt}>
              Bir şehir seç, ilk dükkânını aç ve piyasaya gir.
            </Text>
          </View>
          <Kart>
            <Etiket ikon="flag-checkered" yazi="İLK ADIMLAR" />
            {['Şehrini seç', 'Manavını aç', 'İlk malını al', 'Rafına koy ve sat'].map((m, i) => (
              <View key={m} style={s.adim}>
                <View style={s.adimNo}><Text style={s.adimNoYazi}>{i + 1}</Text></View>
                <Text style={s.adimYazi}>{m}</Text>
              </View>
            ))}
          </Kart>
        </>
      )}

      {sirket && (
        <>
          <Kart style={s.kimlik}>
            {/*
              ★ HALKA ARTIK GERÇEK ORANI GÖSTERİYOR. Eskiden
              `(experience % 1000) / 1000` idi, yani her seviyeyi 1.000 XP
              sanıyordu; gerçek eşikler 200 · 1.000 · 2.500 · 9.000 · 17.000 …
              diye gidiyor ve tam 9.000 XP'deki oyuncu halkayı BOŞ görüyordu.

              `progress.ratio` en yavaş şartın oranı: seviye atlamak yalnız XP
              değil, şirket değeri/hacim/üretim/ürün çeşidi de istiyor. Dört
              şart dolup biri %10'daysa halkanın dolu görünmesi yalan olurdu.
            */}
            <SeviyeRozeti
              seviye={sirket.level}
              unvan={sirket.levelTitle}
              oran={sirket.progress.ratio}
            />
            <View style={s.kimlikAlt}>
              <MCI name="office-building" size={14} color={renk.soluk} />
              <Text style={s.kimlikYazi}>{sirket.name}</Text>
              <MCI name="map-marker" size={14} color={renk.soluk} />
              <Text style={s.kimlikYazi}>{sirket.city.name}</Text>
            </View>
          </Kart>

          {/*
            ★ Hedef TUR BAĞLAMINDAN, `/dashboard`tan değil: tur düştüğünde
            geri sayımın yeni hedefe atlaması gerekir ve o haberi yoklayan
            bağlam getirir. İki kaynak olsaydı geri sayım eski hedefte
            "işleniyor…" diye asılı kalırdı.
          */}
          <GeriSayim hedef={sonraki ?? ozet?.tur.sonraki ?? null} />

          <Kasa tutar={paraBicimle(sirket.cash)} altYazi="kullanılabilir nakit" />

          {/*
            ★ KREDİ KASANIN HEMEN ALTINDA. Kredi sistemi kuruluydu ama mobilde
            hiçbir ekran `/loans`u çağırmıyordu: nakdi biten oyuncunun elinde
            tesis satmaktan başka yol yoktu. Soru kasaya bakarken sorulur, o
            yüzden cevabı da orada duruyor — profile saklamak, ihtiyaç anında
            bulunmamak demekti.
          */}
          <Pressable style={s.krediDugme} onPress={krediyiAc}>
            <MCI name="bank-outline" size={17} color={renk.mavi} />
            <Text style={s.krediYazi}>Kredi</Text>
            <MCI name="chevron-right" size={18} color={renk.mavi} />
          </Pressable>

          <View style={s.satir}>
            {ozet
              ? <KarRozeti net={ozet.kar.net} oran={ozet.kar.oran} />
              : (
                <Kutu
                  ikon="chart-areaspline" etiket="ŞİRKET DEĞERİ"
                  deger={kisaPara(sirket.companyValue)} alt="₺ toplam varlık"
                />
              )}
            <Kutu
              ikon="star-four-points" etiket="İTİBAR"
              deger={Number(sirket.reputation).toFixed(0)} alt="0 – 100"
              ton={renk.mor}
            />
          </View>

          {ozet && (
            <View style={s.satir}>
              <Kutu
                ikon="chart-areaspline" etiket="ŞİRKET DEĞERİ"
                deger={kisaPara(sirket.companyValue)} alt="₺ toplam varlık"
              />
              <Kutu
                ikon="cash-plus" etiket="24S CİRO"
                deger={kisaPara(ozet.kar.ciro)} alt="₺ gelen"
                ton={renk.altin}
              />
            </View>
          )}

          {ozet && <KritikStok satirlar={ozet.kritikStok} />}
          {ozet && <Olaylar satirlar={ozet.olaylar} />}
        </>
      )}
    </ScrollView>

    <KrediPaneli
      acik={krediAcik}
      durum={kredi}
      onizle={krediOnizle}
      kapat={() => setKrediAcik(false)}
      cek={krediCek}
      kapatKredi={krediKapat}
    />
    </>
  );
}

const s = StyleSheet.create({
  orta: { flex: 1, justifyContent: 'center' },
  krediDugme: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: bosluk.l, borderRadius: yuvarlak.m,
    backgroundColor: 'rgba(90,160,255,0.10)', borderWidth: 1,
    borderColor: 'rgba(90,160,255,0.35)',
  },
  krediYazi: { color: renk.mavi, fontSize: 15, fontFamily: yaziTipi.baslikOrta, flex: 1 },
  icerik: { padding: bosluk.l, paddingBottom: 110, gap: bosluk.m },

  hataKart: { borderColor: renk.eksi },
  hata: { color: renk.eksi, fontSize: 14, fontFamily: yaziTipi.govde },

  hosgeldin: { alignItems: 'center', gap: bosluk.xs, paddingVertical: bosluk.xl },
  hosBaslik: { color: renk.metin, fontSize: 26, fontFamily: yaziTipi.baslik },
  hosAlt: { color: renk.soluk, fontSize: 14, textAlign: 'center', paddingHorizontal: bosluk.xl, fontFamily: yaziTipi.govde, lineHeight: 21 },

  adim: { flexDirection: 'row', alignItems: 'center', gap: bosluk.m, paddingVertical: 5 },
  adimNo: {
    width: 24, height: 24, borderRadius: yuvarlak.tam, backgroundColor: 'rgba(255,194,75,0.16)',
    borderWidth: 1, borderColor: 'rgba(255,194,75,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  adimNoYazi: { color: renk.altin, fontSize: 12, fontFamily: yaziTipi.rakam },
  adimYazi: { color: renk.metin, fontSize: 15, fontFamily: yaziTipi.govdeOrta },

  kimlik: { gap: bosluk.m },
  kimlikAlt: { flexDirection: 'row', alignItems: 'center', gap: bosluk.xs, flexWrap: 'wrap' },
  kimlikYazi: { color: renk.soluk, fontSize: 13, marginRight: bosluk.s, fontFamily: yaziTipi.govde },

  satir: { flexDirection: 'row', gap: bosluk.m },

  bekleyen: { borderStyle: 'dashed', borderColor: renk.kenarIsik },
  bekleyenYazi: { color: renk.soluk, fontSize: 13, lineHeight: 21, fontFamily: yaziTipi.govde },
});
