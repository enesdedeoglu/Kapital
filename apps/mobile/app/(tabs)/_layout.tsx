import { Tabs } from 'expo-router';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { ColorValue } from 'react-native';
import { Platform, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { renk, yaziTipi } from '~/ui/tema';

/**
 * Beş sekme (roadmap F9). İkonlar GERÇEK ikon: önce `◆ ▣ ⇅` gibi yazı
 * karakterleri vardı ve arayüzü terminale benzetiyordu.
 */
const ikon = (ad: React.ComponentProps<typeof MCI>['name']) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <MCI name={ad} size={focused ? 26 : 23} color={color} />
  );

export default function SekmeDuzeni() {
  return (
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
      <Tabs.Screen name="menu"     options={{ title: 'Menü',      tabBarIcon: ikon('menu') }} />
    </Tabs>
  );
}
