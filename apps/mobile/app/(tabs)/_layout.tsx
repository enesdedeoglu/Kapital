import { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { ColorValue } from 'react-native';
import { Platform, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useOturum } from '~/oturum';
import { useTur } from '~/tur';
import type { Rapor } from '~/api/types';
import { sonGorulenTur, sonGorulenTuruYaz } from '~/rapor';
import { RaporPaneli } from '~/ui/RaporPaneli';
import { renk, yaziTipi } from '~/ui/tema';

/*
 * ★ Rapor eşiği: bu kadar turdan AZI için gösterilmez.
 *
 * Bir tur 15 dakika. Oyuncu uygulamayı kapatıp 20 dakika sonra açtığında tam
 * ekran bir rapor açmak rahatsız edicidir — üstelik ana sayfa zaten canlı
 * güncelleniyor ve o tek turu ona göstermişti. Rapor "bir süredir yoktun"
 * durumuna aittir; 4 tur = 1 saat.
 */
const ESIK_TUR = 4;

/**
 * Beş sekme (roadmap F9). İkonlar GERÇEK ikon: önce `◆ ▣ ⇅` gibi yazı
 * karakterleri vardı ve arayüzü terminale benzetiyordu.
 */
const ikon = (ad: React.ComponentProps<typeof MCI>['name']) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <MCI name={ad} size={focused ? 26 : 23} color={color} />
  );

/**
 * Sekme düzeni ayrıca "sen yokken" raporunu taşır (madde 45).
 *
 * ★ EKRANDA DEĞİL, DÜZENDE: rapor uygulama açılışına aittir, ana sayfaya
 * değil. Ana sayfaya koysaydım oyuncu başka bir sekmede bırakıp çıktığında
 * (expo-router son rotayı geri getirir) raporu hiç görmezdi.
 */
export default function SekmeDuzeni() {
  const { girisli, iste } = useOturum();
  const { tamamlanan } = useTur();
  const [rapor, setRapor] = useState<Rapor | null>(null);
  // Bir açılışta bir kez sorulur; tur ilerledikçe tekrar tekrar sorulmaz.
  const [soruldu, setSoruldu] = useState(false);

  useEffect(() => {
    if (!girisli || soruldu || tamamlanan === null) return;
    setSoruldu(true);
    void (async () => {
      const gorulen = await sonGorulenTur();
      if (gorulen === null) {
        // İlk kurulum: geçmişi anlatma, buradan itibaren say.
        await sonGorulenTuruYaz(tamamlanan);
        return;
      }
      if (BigInt(tamamlanan) - gorulen < BigInt(ESIK_TUR)) {
        await sonGorulenTuruYaz(tamamlanan);
        return;
      }
      try {
        const r = await iste<Rapor>(`/report?sinceTick=${gorulen}`);
        if (r.yeniMi) setRapor(r); else await sonGorulenTuruYaz(tamamlanan);
      } catch {
        // Rapor alınamadıysa işareti İLERLETMEYİZ: bir sonraki açılışta
        // yeniden denenir. İlerletmek, anlatılmamış turları sessizce yutardı.
      }
    })();
  }, [girisli, soruldu, tamamlanan, iste]);

  /*
   * İşaret rapor KAPATILINCA ilerler, açılınca değil: oyuncu paneli okumadan
   * uygulamayı arka plana atarsa rapor kaybolmamalı.
   */
  const raporuKapat = useCallback(() => {
    const bitis = rapor?.pencere.bitisTur;
    setRapor(null);
    if (bitis !== undefined) void sonGorulenTuruYaz(bitis);
  }, [rapor]);

  return (
    <>
    <RaporPaneli rapor={rapor} kapat={raporuKapat} />
    <Tabs
      screenOptions={{
        headerTransparent: true,
        /*
         * ★ Şeffaf başlık İÇERİĞİ GEÇİRİR. Zemin gradyanı üstten kesilmesin
         * diye şeffaf bırakıldı, ama kaydırılan kartlar başlığın altından
         * görünüp "Ana Sayfa" yazısıyla çakışıyordu. Zemin rengiyle başlayıp
         * saydama giden bir perde, gradyanı bozmadan okunurluğu kurtarır.
         */
        headerBackground: () => (
          <LinearGradient
            colors={[renk.zeminUst, 'rgba(20,26,46,0.92)', 'rgba(20,26,46,0)']}
            style={StyleSheet.absoluteFill}
          />
        ),
        headerTitleStyle: { color: renk.metin, fontFamily: yaziTipi.baslik, fontSize: 17, letterSpacing: 0.5 },
        headerTitleAlign: 'center',
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarStyle: {
          backgroundColor: 'rgba(16,21,38,0.96)',
          borderTopColor: renk.kenar,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: yaziTipi.etiket, letterSpacing: 0.3 },
        tabBarActiveTintColor: renk.altin,
        tabBarInactiveTintColor: renk.cokSoluk,
      }}
    >
      <Tabs.Screen name="index"    options={{ title: 'Ana Sayfa', tabBarIcon: ikon('view-dashboard-variant') }} />
      <Tabs.Screen name="sirket"   options={{ title: 'Şirketim',  tabBarIcon: ikon('factory') }} />
      <Tabs.Screen name="piyasa"   options={{ title: 'Piyasa',    tabBarIcon: ikon('chart-line-variant') }} />
      <Tabs.Screen name="sehirler" options={{ title: 'Şehirler',  tabBarIcon: ikon('map-marker-radius') }} />
      {/*
        ★ "Menü" değil PROFİL: sekme üç satırlık bir ayar listesiydi (sunucu,
        sürüm, çıkış) ve adı da onu anlatıyordu. Artık oyuncunun künyesini,
        şirketini ve seviye merdivenini taşıyor; "menü" diye adlandırılan bir
        sekmede kimse seviye şartlarını aramaz.
      */}
      <Tabs.Screen name="menu"     options={{ title: 'Profil',    tabBarIcon: ikon('account-circle-outline') }} />
    </Tabs>
    </>
  );
}
