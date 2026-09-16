import { useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Tesis, Uretim } from '~/api/types';
import { tesisEtiketi } from './tesisEtiketi';
import { bosluk, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Üretim paneli — tesis ne yapıyor, ne kadar yapıyor, neden yapmıyor.
 *
 * ★ BU PANELİN VAR OLMA SEBEBİ BİR ÖLÇÜMDÜR (R96). Kurulan tesisin
 * `active_recipe_id`si boş kalıyordu; üretim fazı o alan üzerinden JOIN
 * yaptığı için tesis sorgunun dışında kalıyor, üretim kaydı da açılmıyordu.
 * Sonuç: `productionEnabled: true`, `haltedReason: null`, kapasite 15,28 —
 * her şey sağlıklı görünürken depo sonsuza dek boş. Reçete artık kurulumda
 * atanıyor; bu panel de "sağlıklı görünüyor" ile "gerçekten üretiyor"
 * arasındaki farkı GÖSTERİLEBİLİR kılıyor.
 *
 * ★ SON TURLAR LİSTESİ SÜS DEĞİL. Üretimin durduğu tek yer "durdurdum"
 * değil: girdi biterse motor `halted_reason` yazar ve tesis sessizce boşa
 * döner. O satırları göstermeyen bir panel, aynı körlüğü başka bir kılıkta
 * sürdürürdü.
 */
export function UretimPaneli({ tesis, uretim, kapat, degistir }: {
  tesis: Tesis | null;
  /** null = yükleniyor. */
  uretim: Uretim | null;
  kapat: () => void;
  /** Üretimi açar/kapatır; hata mesajı döner (null = başarılı). */
  degistir: (tesisId: string, urunKodu: string, acik: boolean) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  async function anahtar(acik: boolean) {
    if (!tesis || !uretim?.recipe) return;
    setBekliyor(true);
    setHata(null);
    const sonuc = await degistir(tesis.id, uretim.recipe.outputProduct.code, acik);
    setBekliyor(false);
    if (sonuc !== null) setHata(sonuc);
  }

  const r = uretim?.recipe ?? null;
  const calisiyor = uretim?.productionEnabled ?? false;

  return (
    <Modal visible={tesis !== null} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
        <View style={s.tutamak} />
        <View style={s.baslikSatir}>
          <MCI name="factory" size={19} color={renk.mavi} />
          <Text style={s.baslik}>Üretim · {tesis ? tesisEtiketi(tesis) : ''}</Text>
          <View style={s.bosluk} />
          <Pressable onPress={kapat} hitSlop={12}>
            <MCI name="close" size={22} color={renk.soluk} />
          </Pressable>
        </View>

        {uretim === null
          ? <View style={s.orta}><ActivityIndicator color={renk.mavi} /></View>
          : r === null
            ? (
              /*
               * Tarifsiz tesis. Bugün kurulumda atandığı için buraya normalde
               * düşülmez; düşülüyorsa tesis türünün birden çok reçetesi var
               * demektir (o zaman seçim gerçekten oyuncunun) ya da veri
               * bozuk. İkisinde de SESSİZ KALMAK en kötüsü olurdu.
               */
              <View style={s.bosKutu}>
                <MCI name="help-rhombus-outline" size={28} color={renk.uyari} />
                <Text style={s.bosYazi}>
                  Bu tesise bir üretim tarifi atanmamış, bu yüzden hiçbir şey
                  üretmiyor. Destekten yardım iste.
                </Text>
              </View>
            )
            : (
              <ScrollView>
                <View style={s.urunKutu}>
                  <View>
                    <Text style={s.urunEtiket}>ÜRETİLEN</Text>
                    <Text style={s.urunAd}>{r.outputProduct.name}</Text>
                  </View>
                  <View style={s.bosluk} />
                  <View style={s.anahtarKutu}>
                    <Text style={[s.anahtarYazi, { color: calisiyor ? renk.artı : renk.eksi }]}>
                      {calisiyor ? 'çalışıyor' : 'durdu'}
                    </Text>
                    <Switch
                      value={calisiyor} disabled={bekliyor}
                      onValueChange={(v) => void anahtar(v)}
                      trackColor={{ false: renk.kenar, true: 'rgba(61,220,151,0.5)' }}
                      thumbColor={calisiyor ? renk.artı : renk.soluk}
                    />
                  </View>
                </View>

                <View style={s.sayiSatir}>
                  <Sayi
                    etiket="tur başına"
                    deger={`${Number(uretim.capacityPerTick).toFixed(1)} ${r.outputProduct.unit}`}
                  />
                  <Sayi etiket="tesis durumu" deger={`%${uretim.condition.toFixed(0)}`} />
                  <Sayi etiket="seviye" deger={`Lv${uretim.level}`} />
                </View>

                {r.inputs.length > 0 && (
                  <>
                    <Text style={s.altBaslik}>GİRDİLER — bunlar bitince üretim durur</Text>
                    {r.inputs.map((g) => (
                      <View key={g.code} style={s.girdiSatir}>
                        <MCI name="circle-small" size={18} color={renk.soluk} />
                        <Text style={s.girdiAd}>{g.name}</Text>
                        <View style={s.bosluk} />
                        <Text style={s.girdiMiktar}>{g.quantityFormatted}</Text>
                      </View>
                    ))}
                  </>
                )}

                {uretim.haltedReason && (
                  <View style={s.uyariSatir}>
                    <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                    <Text style={s.uyari}>{uretim.haltedReason}</Text>
                  </View>
                )}

                <Text style={s.altBaslik}>SON TURLAR</Text>
                {uretim.recentTicks.length === 0
                  ? (
                    <Text style={s.bosSatir}>
                      {tesis?.isUnderConstruction
                        ? 'İnşaat sürüyor; bitince üretim kendiliğinden başlar.'
                        : 'Henüz üretim turu geçmedi.'}
                    </Text>
                  )
                  : uretim.recentTicks.map((t) => (
                    <View key={t.tickSeq} style={s.turSatir}>
                      <Text style={s.turNo}>#{t.tickSeq}</Text>
                      <Text style={[s.turMiktar, t.produced === '0' && s.turBos]}>
                        {(Number(t.produced) / 1000).toFixed(1)} {r.outputProduct.unit}
                      </Text>
                      <Text style={s.turKalite}>kal {t.outputQuality.toFixed(0)}</Text>
                      <View style={s.bosluk} />
                      {t.haltedReason && (
                        <Text style={s.turHata} numberOfLines={1}>{t.haltedReason}</Text>
                      )}
                    </View>
                  ))}

                {hata && (
                  <View style={s.uyariSatir}>
                    <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                    <Text style={s.uyari}>{hata}</Text>
                  </View>
                )}

                <Text style={s.not}>
                  Üretim her turda kendiliğinden olur; kapatırsan tesis durur ama
                  bakım gideri işlemeye devam eder.
                </Text>
              </ScrollView>
            )}
      </View>
    </Modal>
  );
}

function Sayi({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <View style={s.sayiKutu}>
      <Text style={s.sayiEtiket}>{etiket}</Text>
      <Text style={s.sayiDeger}>{deger}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    backgroundColor: renk.kartUst, borderTopLeftRadius: yuvarlak.xl,
    borderTopRightRadius: yuvarlak.xl, borderTopWidth: 1, borderColor: renk.kenarIsik,
    paddingHorizontal: bosluk.l, paddingTop: bosluk.s, maxHeight: '86%',
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s, marginBottom: bosluk.m },
  baslik: { color: renk.metin, fontSize: 17, fontFamily: yaziTipi.baslik, flexShrink: 1 },
  bosluk: { flex: 1 },
  orta: { paddingVertical: bosluk.xxl },

  bosKutu: { alignItems: 'center', gap: bosluk.m, paddingVertical: bosluk.xl },
  bosYazi: {
    color: renk.soluk, fontSize: 14, lineHeight: 21, textAlign: 'center',
    fontFamily: yaziTipi.govde,
  },

  urunKutu: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: renk.kart,
    borderRadius: yuvarlak.m, borderWidth: 1, borderColor: renk.kenar,
    padding: bosluk.l,
  },
  urunEtiket: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde, letterSpacing: 0.5 },
  urunAd: { color: renk.metin, fontSize: 19, fontFamily: yaziTipi.baslik, marginTop: 2 },
  anahtarKutu: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  anahtarYazi: { fontSize: 13, fontFamily: yaziTipi.baslikOrta },

  sayiSatir: { flexDirection: 'row', gap: bosluk.s, marginTop: bosluk.m },
  sayiKutu: {
    flex: 1, backgroundColor: renk.kart, borderRadius: yuvarlak.m,
    borderWidth: 1, borderColor: renk.kenar, padding: bosluk.m,
  },
  sayiEtiket: { color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde },
  sayiDeger: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.rakam, marginTop: 3 },

  altBaslik: {
    color: renk.cokSoluk, fontSize: 11, fontFamily: yaziTipi.govde,
    letterSpacing: 0.5, marginTop: bosluk.l, marginBottom: bosluk.s,
  },
  girdiSatir: { flexDirection: 'row', alignItems: 'center' },
  girdiAd: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.govde },
  girdiMiktar: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.rakam },

  turSatir: {
    flexDirection: 'row', alignItems: 'center', gap: bosluk.m,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: renk.kenar,
  },
  turNo: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.rakam, width: 52 },
  turMiktar: { color: renk.metin, fontSize: 14, fontFamily: yaziTipi.rakam, width: 78 },
  turBos: { color: renk.eksi },
  turKalite: { color: renk.soluk, fontSize: 12, fontFamily: yaziTipi.rakam },
  turHata: { color: renk.eksi, fontSize: 11.5, fontFamily: yaziTipi.govde, flexShrink: 1 },
  bosSatir: { color: renk.soluk, fontSize: 13.5, lineHeight: 20, fontFamily: yaziTipi.govde },

  uyariSatir: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: bosluk.m },
  uyari: { color: renk.eksi, fontSize: 12.5, flex: 1, fontFamily: yaziTipi.govde },

  not: {
    color: renk.cokSoluk, fontSize: 12, lineHeight: 18,
    marginTop: bosluk.l, marginBottom: bosluk.s, fontFamily: yaziTipi.govde,
  },
});
