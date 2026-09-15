import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  ChakraPetch_600SemiBold, ChakraPetch_700Bold,
} from '@expo-google-fonts/chakra-petch';
import { Sora_400Regular, Sora_500Medium, Sora_600SemiBold } from '@expo-google-fonts/sora';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { OturumSaglayici, useOturum } from '~/oturum';
import { TurSaglayici } from '~/tur';
import { gradyan, renk } from '~/ui/tema';

// Yazı tipleri yüklenene kadar açılış ekranı durur: biçimsiz yazı yanıp
// sönmesin (FOUT). Yükleme bitince elle kapatılır.
void SplashScreen.preventAutoHideAsync();

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
  const [fontHazir] = useFonts({
    ChakraPetch_600SemiBold, ChakraPetch_700Bold,
    Sora_400Regular, Sora_500Medium, Sora_600SemiBold,
  });

  const cizildi = useCallback(() => {
    if (fontHazir) void SplashScreen.hideAsync();
  }, [fontHazir]);

  if (!fontHazir) return null;

  return (
    // Zemin gradyanı KÖKTE: her ekran üstüne saydam biner, düz yüzey hissi kalkar.
    <LinearGradient colors={gradyan.zemin} style={{ flex: 1 }}>
      <View style={{ flex: 1 }} onLayout={cizildi}>
        <ThemeProvider value={saydamTema}>
          <OturumSaglayici>
            {/* Tur bağlamı oturumun İÇİNDE: çıkış yapılınca yoklama da dursun. */}
            <TurSaglayici>
              <StatusBar style="light" />
              <Kapi />
            </TurSaglayici>
          </OturumSaglayici>
        </ThemeProvider>
      </View>
    </LinearGradient>
  );
}
