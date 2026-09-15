import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import type { ColorValue } from 'react-native';
import { tema } from '~/ui/tema';

/** Roadmap F9: beş sekme — Ana Sayfa / Şirketim / Piyasa / Şehirler / Menü. */
const simge = (yazi: string) => ({ color }: { color: ColorValue }) => (
  <Text style={{ color, fontSize: 18 }}>{yazi}</Text>
);

export default function SekmeDuzeni() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: tema.renk.zemin },
        headerTitleStyle: { color: tema.renk.metin },
        tabBarStyle: { backgroundColor: tema.renk.kart, borderTopColor: tema.renk.kartKenar },
        tabBarActiveTintColor: tema.renk.vurgu,
        tabBarInactiveTintColor: tema.renk.soluk,
      }}
    >
      <Tabs.Screen name="index"   options={{ title: 'Ana Sayfa', tabBarIcon: simge('◆') }} />
      <Tabs.Screen name="sirket"  options={{ title: 'Şirketim',  tabBarIcon: simge('▣') }} />
      <Tabs.Screen name="piyasa"  options={{ title: 'Piyasa',    tabBarIcon: simge('⇅') }} />
      <Tabs.Screen name="sehirler" options={{ title: 'Şehirler', tabBarIcon: simge('◉') }} />
      <Tabs.Screen name="menu"    options={{ title: 'Menü',      tabBarIcon: simge('≡') }} />
    </Tabs>
  );
}
