import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { OturumSaglayici, useOturum } from '~/oturum';
import { tema } from '~/ui/tema';

/** Oturum yoksa girişe, varsa sekmelere yönlendirir. */
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
      <View style={{ flex: 1, backgroundColor: tema.renk.zemin, justifyContent: 'center' }}>
        <ActivityIndicator color={tema.renk.vurgu} />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tema.renk.zemin } }} />;
}

export default function KokDuzen() {
  return (
    <OturumSaglayici>
      <StatusBar style="light" />
      <Kapi />
    </OturumSaglayici>
  );
}
