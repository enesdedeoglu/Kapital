import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOturum } from '~/oturum';
import type { Sirket } from '~/api/types';
import { ApiError } from '~/api/client';
import { paraBicimle, tema } from '~/ui/tema';

export default function AnaSayfa() {
  const { iste } = useOturum();
  const [sirket, setSirket] = useState<Sirket | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);
  /*
   * ★ "Yüklendi" AYRI bir durumdur, "şirket var" değil.
   * Önce yükleme koşulu `!sirket && !hata` idi ve şirketi olmayan oyuncuda
   * (404 → sirket null, hata null) spinner sonsuza dek dönüyordu. Simülatörde
   * ilk gerçek girişte yakalandı: boş durumun kendisi de bir SONUÇTUR.
   */
  const [yuklendi, setYuklendi] = useState(false);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      setSirket(await iste<Sirket>('/company'));
    } catch (e) {
      // Şirketi olmayan yeni oyuncu: 404 bir hata değil, bir durum.
      if (e instanceof ApiError && e.status === 404) setSirket(null);
      else setHata(e instanceof ApiError ? e.message : 'Sunucuya ulaşılamadı');
    } finally {
      setYuklendi(true);
    }
  }, [iste]);

  useEffect(() => { void yukle(); }, [yukle]);

  if (!yuklendi) {
    return <View style={s.orta}><ActivityIndicator color={tema.renk.vurgu} /></View>;
  }

  return (
    <ScrollView
      style={s.zemin}
      contentContainerStyle={s.icerik}
      refreshControl={
        <RefreshControl
          refreshing={yenileniyor}
          tintColor={tema.renk.soluk}
          onRefresh={() => { setYenileniyor(true); void yukle().finally(() => setYenileniyor(false)); }}
        />
      }
    >
      {hata && <View style={[s.kart, s.hataKart]}><Text style={s.hata}>{hata}</Text></View>}

      {!sirket && !hata && (
        <View style={s.kart}>
          <Text style={s.etiket}>HENÜZ ŞİRKETİN YOK</Text>
          <Text style={s.buyukDeger}>Kurulum bekliyor</Text>
          <Text style={s.soluk}>
            Bir şehir seç ve ilk dükkânını aç. Şirket kurma akışı yakında bu ekrana gelecek.
          </Text>
        </View>
      )}

      {sirket && (
        <>
          <View style={s.kart}>
            <Text style={s.etiket}>NAKİT</Text>
            <Text style={s.buyukDeger}>{sirket.cashFormatted}</Text>
            <Text style={s.soluk}>{sirket.name} · {sirket.city.name}</Text>
          </View>

          <View style={s.satir}>
            <View style={[s.kart, s.yarim]}>
              <Text style={s.etiket}>ŞİRKET DEĞERİ</Text>
              <Text style={s.deger}>{paraBicimle(sirket.companyValue)}</Text>
            </View>
            <View style={[s.kart, s.yarim]}>
              <Text style={s.etiket}>SEVİYE</Text>
              <Text style={s.deger}>Lv{sirket.level}</Text>
              <Text style={s.soluk}>{sirket.levelTitle}</Text>
            </View>
          </View>

          {/* Tur geri sayımı, 24s K/Z, kritik stok ve son olaylar için API ucu
              henüz yok — F9 planının 4. adımı. */}
          <View style={[s.kart, s.yakinda]}>
            <Text style={s.etiket}>SIRADAKİ</Text>
            <Text style={s.soluk}>
              Tur geri sayımı · 24s K/Z · kritik stok · son olaylar{'\n'}
              Bu dört alan tek bir özet ucuyla gelecek.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  zemin: { flex: 1, backgroundColor: tema.renk.zemin },
  icerik: { padding: tema.bosluk.l, gap: tema.bosluk.m },
  orta: { flex: 1, backgroundColor: tema.renk.zemin, justifyContent: 'center' },
  kart: {
    backgroundColor: tema.renk.kart, borderColor: tema.renk.kartKenar, borderWidth: 1,
    borderRadius: tema.yuvarlak.l, padding: tema.bosluk.l, gap: tema.bosluk.xs,
  },
  hataKart: { borderColor: tema.renk.eksi },
  hata: { color: tema.renk.eksi, fontSize: 14 },
  satir: { flexDirection: 'row', gap: tema.bosluk.m },
  yarim: { flex: 1 },
  etiket: { color: tema.renk.soluk, fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  buyukDeger: { color: tema.renk.metin, fontSize: 32, fontWeight: '700' },
  deger: { color: tema.renk.metin, fontSize: 20, fontWeight: '600' },
  soluk: { color: tema.renk.soluk, fontSize: 13 },
  yakinda: { borderStyle: 'dashed' },
});
