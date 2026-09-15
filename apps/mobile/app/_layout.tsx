import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { OturumSaglayici, useOturum } from '~/oturum';
import { gradyan, renk } from '~/ui/tema';

function Kapi() {
  const { hazir, girisli } = useOturum();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!hazir) return;
    const girisEkraninda = segments[0] === 'giris';
    if (!girisli && !girisEkraninda) router.replace('/giris');
    else if (girisli && girisEkraninda) router.replace('/');
  }, [hazir, girisli, segments, router]);

  if (!hazir) {
    return (
      <LinearGradient colors={gradyan.zemin} style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={renk.altin} />
      </LinearGradient>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
  );
}

/*
 * ★ Navigasyonun KENDİ zemini var ve varsayılanı AÇIK.
 *
 * ★★ Tema expo-router'DAN alınır, `@react-navigation/native`ten DEĞİL:
 * SDK 56'dan itibaren expo-router react-navigation ile uyumlu değil ve o
 * paketi kurmak Metro'yu "expo-router is no longer compatible with
 * react-navigation" hatasıyla düşürüyor. expo-router `DarkTheme`,
 * `ThemeProvider` ve `useTheme`'i kendisi ihraç eder.
 *
 * Gradyanı köke koymak yetmedi: navigasyon her ekran kabını
 * `theme.colors.background` ile boyuyor ve varsayılan açık tema gradyanın
 * üstünü örtüyordu — açık gri zemin üstünde açık yazı, ekran okunmaz hâle
 * geldi. Kabın zeminini SAYDAM yapmak, alttaki gradyanı görünür kılar.
 */
const saydamTema = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent', card: 'transparent' },
};

export default function KokDuzen() {
  return (
    // Zemin gradyanı KÖKTE: her ekran üstüne saydam biner, düz yüzey hissi kalkar.
    <LinearGradient colors={gradyan.zemin} style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <ThemeProvider value={saydamTema}>
          <OturumSaglayici>
            <StatusBar style="light" />
            <Kapi />
          </OturumSaglayici>
        </ThemeProvider>
      </View>
    </LinearGradient>
  );
}
