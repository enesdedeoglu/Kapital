import { useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MCI from '@expo/vector-icons/MaterialCommunityIcons';
import type { Tesis } from '~/api/types';
import { bosluk, paraBicimle, renk, yaziTipi, yuvarlak } from './tema';

/**
 * Tesis seviye yükseltme onayı.
 *
 * ★ ONAY KUTUSU DEĞİL, KARŞILAŞTIRMA. Yükseltme tesisin taban bedelinin
 * katlarına mal olur (Manav Lv2 = 8.784,51 ₺, kurulumun kendisi 4.000 ₺) ve
 * GERİ ALINAMAZ. "Emin misin?" diye sorup geçmek, oyuncuya ne aldığını
 * söylemeden para harcatmak olurdu. O yüzden önce/sonra yan yana.
 *
 * ★ ÜRETİM SATIRI YALNIZ ÜRETEN TESİSTE. Perakendede `base_capacity = 0`
 * (manav/büfe/market üretmez); orada yükseltme SADECE depoyu büyütür.
 * Herkese "üretim artar" demek yalan olurdu.
 */
export function YukseltmePaneli({ tesis, nakit, kapat, gonder }: {
  tesis: Tesis | null;
  /** Şirketin kasası, kuruş. */
  nakit: string;
  kapat: () => void;
  gonder: (tesisId: string) => Promise<string | null>;
}) {
  const kenar = useSafeAreaInsets();
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  const u = tesis?.upgrade;
  const bedel = u?.cost ?? null;
  const parasiYetmiyor = bedel !== null && BigInt(bedel) > BigInt(nakit);
  const olur = tesis !== null && u !== undefined && !u.atMaxLevel
    && bedel !== null && !parasiYetmiyor;

  async function onayla() {
    if (!olur || !tesis) return;
    setBekliyor(true);
    setHata(null);
    const sonuc = await gonder(tesis.id);
    setBekliyor(false);
    if (sonuc === null) kapat(); else setHata(sonuc);
  }

  return (
    <Modal visible={tesis !== null} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} />
      <View style={[s.panel, { paddingBottom: kenar.bottom + bosluk.l }]}>
        <View style={s.tutamak} />
        {tesis && u && (
          <>
            <View style={s.baslikSatir}>
              <MCI name="arrow-up-bold-hexagon-outline" size={19} color={renk.mor} />
              <Text style={s.baslik}>{tesis.name} · seviye atlat</Text>
              <View style={s.bosluk} />
              <Pressable onPress={kapat} hitSlop={12}>
                <MCI name="close" size={22} color={renk.soluk} />
              </Pressable>
            </View>

            {u.atMaxLevel
              ? (
                <View style={s.tavan}>
                  <MCI name="trophy-outline" size={30} color={renk.altin} />
                  <Text style={s.tavanYazi}>
                    Bu tesis en yüksek seviyede (Lv{u.maxLevel}).
                  </Text>
                </View>
              )
              : (
                <>
                  <View style={s.seviyeSatir}>
                    <View style={s.seviyeKutu}>
                      <Text style={s.seviyeEtiket}>ŞİMDİ</Text>
                      <Text style={s.seviyeDeger}>Lv{tesis.level}</Text>
                    </View>
                    <MCI name="arrow-right" size={22} color={renk.mor} />
                    <View style={[s.seviyeKutu, s.seviyeHedef]}>
                      <Text style={s.seviyeEtiket}>SONRA</Text>
                      <Text style={[s.seviyeDeger, s.morYazi]}>Lv{u.nextLevel}</Text>
                    </View>
                  </View>

                  <View style={s.kazanc}>
                    <KazancSatiri
                      ikon="warehouse" ad="depo"
                      once={`${birim(tesis.storageCapacity)} birim`}
                      sonra={`${birim(u.nextStorageCapacity)} birim`}
                    />
                    {u.producesGoods && u.nextLevelMultiplier !== null && (
                      <KazancSatiri
                        ikon="factory" ad="üretim"
                        once={`×${carpan(u.levelMultiplier)}`}
                        sonra={`×${carpan(u.nextLevelMultiplier)}`}
                      />
                    )}
                    {!u.producesGoods && (
                      <Text style={s.not}>
                        Bu tesis üretim yapmaz; yükseltme yalnız depoyu büyütür.
                      </Text>
                    )}
                  </View>

                  <View style={[s.ozet, olur ? s.ozetTamam : s.ozetEngel]}>
                    <View style={s.ozetSatir}>
                      <Text style={s.ozetEtiket}>MALİYET</Text>
                      <Text style={s.ozetDeger}>{u.costFormatted}</Text>
                    </View>
                    <View style={s.ozetSatir}>
                      <Text style={s.ozetAlt}>kasanda</Text>
                      <Text style={[s.ozetAlt, parasiYetmiyor && s.kirmizi]}>
                        {paraBicimle(nakit)} ₺
                      </Text>
                    </View>
                  </View>

                  {(hata ?? (parasiYetmiyor ? 'Kasan bu yükseltmeye yetmiyor.' : null)) && (
                    <View style={s.hataSatir}>
                      <MCI name="alert-circle-outline" size={15} color={renk.eksi} />
                      <Text style={s.hata}>
                        {hata ?? 'Kasan bu yükseltmeye yetmiyor.'}
                      </Text>
                    </View>
                  )}

                  <Pressable
                    onPress={() => void onayla()}
                    disabled={!olur || bekliyor}
                    style={[s.dugme, (!olur || bekliyor) && s.dugmePasif]}
                  >
                    {bekliyor
                      ? <ActivityIndicator color={renk.metin} />
                      : <Text style={s.dugmeYazi}>Yükselt</Text>}
                  </Pressable>
                </>
              )}
          </>
        )}
      </View>
    </Modal>
  );
}

function KazancSatiri({ ikon, ad, once, sonra }: {
  ikon: React.ComponentProps<typeof MCI>['name'];
  ad: string; once: string; sonra: string;
}) {
  return (
    <View style={s.kazancSatir}>
      <MCI name={ikon} size={15} color={renk.soluk} />
      <Text style={s.kazancAd}>{ad}</Text>
      <Text style={s.kazancOnce}>{once}</Text>
      <MCI name="arrow-right" size={13} color={renk.cokSoluk} />
      <Text style={s.kazancSonra}>{sonra}</Text>
    </View>
  );
}

/** Qty ölçeği 1e3 — depo kapasitesi birim cinsine indirilir. */
function birim(qty: string | null): string {
  if (qty === null) return '—';
  const n = BigInt(qty) / 1000n;
  const ham = n.toString();
  let out = '';
  for (let i = 0; i < ham.length; i++) {
    if (i > 0 && (ham.length - i) % 3 === 0) out += '.';
    out += ham[i];
  }
  return out;
}

/** 1.4 → "1,4" — Hermes'te ondalık ayracı elle konur. */
function carpan(n: number): string {
  return n.toFixed(n % 1 === 0 ? 0 : 1).replace('.', ',');
}

const s = StyleSheet.create({
  perde: { flex: 1, backgroundColor: 'rgba(5,8,18,0.65)' },
  panel: {
    backgroundColor: renk.kart, borderTopLeftRadius: yuvarlak.l,
    borderTopRightRadius: yuvarlak.l, paddingHorizontal: bosluk.l,
    paddingTop: bosluk.s, borderTopWidth: 1, borderColor: renk.kenarIsik,
  },
  tutamak: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: renk.kenarIsik,
    alignSelf: 'center', marginBottom: bosluk.m,
  },
  baslikSatir: { flexDirection: 'row', alignItems: 'center', gap: bosluk.s },
  baslik: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.baslikOrta, flexShrink: 1 },
  bosluk: { flex: 1 },

  tavan: { alignItems: 'center', gap: bosluk.s, paddingVertical: bosluk.xl },
  tavanYazi: { color: renk.soluk, fontSize: 14, fontFamily: yaziTipi.govde },

  seviyeSatir: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: bosluk.l, marginTop: bosluk.l,
  },
  seviyeKutu: {
    alignItems: 'center', paddingHorizontal: bosluk.xl, paddingVertical: bosluk.m,
    borderRadius: yuvarlak.m, borderWidth: 1, borderColor: renk.kenar,
    backgroundColor: renk.kartUst, minWidth: 104,
  },
  seviyeHedef: { borderColor: renk.mor, backgroundColor: 'rgba(139,92,246,0.12)' },
  seviyeEtiket: { color: renk.cokSoluk, fontSize: 9, letterSpacing: 1, fontFamily: yaziTipi.etiket },
  seviyeDeger: { color: renk.metin, fontSize: 24, fontFamily: yaziTipi.rakam },
  morYazi: { color: renk.mor },

  kazanc: { marginTop: bosluk.l, gap: 8 },
  kazancSatir: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  kazancAd: { color: renk.soluk, fontSize: 13, fontFamily: yaziTipi.govde, flex: 1 },
  kazancOnce: { color: renk.cokSoluk, fontSize: 14, fontFamily: yaziTipi.rakam },
  kazancSonra: { color: renk.artı, fontSize: 14, fontFamily: yaziTipi.rakam },
  not: { color: renk.cokSoluk, fontSize: 12, lineHeight: 18, fontFamily: yaziTipi.govde },

  ozet: {
    marginTop: bosluk.l, padding: bosluk.m, borderRadius: yuvarlak.m,
    borderWidth: 1, gap: 4,
  },
  ozetTamam: { borderColor: 'rgba(139,92,246,0.35)', backgroundColor: 'rgba(139,92,246,0.08)' },
  ozetEngel: { borderColor: renk.kenar, backgroundColor: renk.kartUst },
  ozetSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ozetEtiket: { color: renk.soluk, fontSize: 11, letterSpacing: 0.8, fontFamily: yaziTipi.etiket },
  ozetDeger: { color: renk.metin, fontSize: 18, fontFamily: yaziTipi.rakam },
  ozetAlt: { color: renk.cokSoluk, fontSize: 12, fontFamily: yaziTipi.govde },
  kirmizi: { color: renk.eksi },

  hataSatir: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: bosluk.m },
  hata: { color: renk.eksi, fontSize: 13, lineHeight: 19, flex: 1, fontFamily: yaziTipi.govde },

  dugme: {
    marginTop: bosluk.l, paddingVertical: 15, borderRadius: yuvarlak.m,
    backgroundColor: renk.mor, alignItems: 'center',
  },
  dugmePasif: { backgroundColor: renk.kenar },
  dugmeYazi: { color: renk.metin, fontSize: 16, fontFamily: yaziTipi.baslikOrta },
});
