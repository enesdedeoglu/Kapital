# 07 — NPC ve Economic Director Sınırları

Madde 28: *"Bu iki sistem kesinlikle ayrı olmalıdır."* Bu doküman ayrımı
**mimari olarak zorlayıcı** hale getirir — disiplinle değil, kodla.

## 1. Temel ayrım

| | **NPC Ajanı** | **Economic Director (ED)** |
|---|---|---|
| Soru | "Benim şirketim nasıl daha çok kâr eder?" | "Oyun ekonomisi sağlıklı mı?" |
| Görüş alanı | Kendi defteri + **herkese açık** piyasa verisi | Yalnızca **agrege** istatistikler |
| Karar birimi | Tek şirket | Ürün / sektör / şehir |
| Yazdığı tablolar | `market_orders`, `retail_offers`, `facilities`, `production_jobs` | **yalnızca** `npc_directives` |
| Sıklık | Her tick (ops) / N tick (strateji) | Her tick (skor) / N tick (müdahale) |
| Asla | Global agregat göremez | Fiyat belirleyemez, emir veremez, oyuncuya dokunamaz |

## 2. Mimari zorlama (mekanizma)

İki modül **farklı repository arayüzleri** alır. Sınır tip sistemiyle korunur:

```ts
// packages/economy/src/npc/ports.ts
export interface NpcView {                 // NPC'nin görebildiği HER ŞEY
  self: CompanyBooks;                      // kendi nakit/stok/tesis/borç
  publicMarket: {                          // oyuncunun da gördüğü veri
    referencePrice(p: ProductId, c: CityId): Money;
    openOrders(p: ProductId, c: CityId): OrderBookSummary;   // derinlik, en iyi fiyat
    retailPriceBand(p: ProductId, c: CityId): { p25: Money; p75: Money };
  };
  directives: NpcDirective[];              // ED'den gelen sınırlı modifiye ediciler
}

// packages/economy/src/director/ports.ts
export interface DirectorView {            // ED'nin görebildiği HER ŞEY
  health: MarketHealth[];                  // ürün×şehir sağlık skorları
  aggregates: {
    moneySupply: Decimal; gameCpi: number; playerShare: number;
    inventoryDepthTicks: number; bankruptcyRate: number;
  };
  // ★ Tek bir şirket, tek bir emir, tek bir oyuncu ERİŞİLEBİLİR DEĞİL
}
export type DirectorOutput = NpcDirective[];   // ★ tek çıktı tipi
```

`DirectorView` içinde şirket bazlı hiçbir alan **yoktur**. ED, "şu oyuncu çok
zenginleşti, onu yavaşlatalım" diyemez — çünkü o veriyi göremez. Bu, tip düzeyinde
uygulanmış bir güvence.

`DirectorOutput` tipi `NpcDirective[]`'dir. ED bir `MarketOrder` üretemez, çünkü
fonksiyon imzası buna izin vermez.

## 3. Direktif kaldıraçları (ED'nin yapabildiği her şey)

ED yalnızca 6 kaldıraca, `-1..+1` aralığında dokunabilir:

| Kaldıraç | Etkisi | Sınır |
|---|---|---|
| `INVENTORY_TARGET` | NPC hedef stok tur sayısı | ±%40 |
| `PRODUCTION_BIAS` | NPC üretim kapasitesi kullanımı | ±%30 |
| `BUY_BIAS` | NPC alış emri agresifliği | ±%35 |
| `INVESTMENT_BIAS` | NPC yatırım eşiği | ±%50 |
| `CAPACITY_CAP` | NPC toplam kapasite tavanı (oyuncu payı arttıkça düşer — madde 31) | 0..1 |
| `IMPORT_QUOTA` | Dış ticaret ithalat derinliği: `import_depth_pct × (1 + m×3)` | 0,5×–4× |

**Yapamadıkları (kodda mümkün değil):**
- Fiyat belirlemek
- Emir vermek/iptal etmek
- Şirket nakdine dokunmak
- Oyuncu tesisini/stoğunu değiştirmek
- Şehir talebini doğrudan değiştirmek (o `world_events` işidir, admin onaylı)

## 4. Müdahale bantları (madde 30)

```
Health > 75   HEALTHY    → müdahale yok, geçerli direktifler süresi dolar
55 – 75       WATCH      → INVENTORY_TARGET ±%10
35 – 55       ADJUST     → INVENTORY_TARGET ±%25, PRODUCTION_BIAS ±%15, BUY_BIAS ±%20
20 – 35       STIMULATE  → + INVESTMENT_BIAS +%40 · IMPORT_QUOTA +0.5
< 20          EMERGENCY  → önce IMPORT_QUOTA +1 (ithalat kapısı açılır);
                           ürün ithal edilemiyorsa veya döviz de yetmiyorsa SYS_RESERVE
```

### ★ Yön: kaldıraçların işareti arz/talep oranından gelir

Yukarıdaki tablo düşük sağlığın her zaman KITLIK demek olduğunu varsayar. Oysa
`f_supply` çift yönlüdür (§7): oran 1,0'da tepe yapar, hem kıtlık hem **aşırı
arz** skoru düşürür. Yön ayrımı yapılmazsa ED bolluk gördüğünde üretimi daha da
artırır ve düzeltmesi gereken sorunu kendisi büyütür.

Ölçüldü (F7 ilk koşusu, R24): buğday arzı 4.108, ara talep 2.128 → oran 1,93 →
`f_supply` 0 → ADJUST → `PRODUCTION_BIAS` +%15 → daha çok buğday.

```
oran > 1 (bolluk)  → PRODUCTION_BIAS, BUY_BIAS, INVENTORY_TARGET işaretleri TERS
                     IMPORT_QUOTA ve INVESTMENT_BIAS hiç yayınlanmaz
oran ≤ 1 (kıtlık)  → tablodaki gibi
```

Acil BOLLUK krizinde ithalat açmak felaket olurdu; onun yerine üretim −1,
stok −0,625, yatırım −1 verilir.

### ★ Duruş tutarlılığı: geçersiz direktifler anında iptal edilir

Direktifler `expires_tick` ile sönümlenir, ama bant veya yön değiştiğinde eski
direktifleri 96 tur boyunca yaşatmak ED'yi tutarsız bırakır. Ölçüldü (R25): un
arzı fazlaya döndüğünde ED üretimi kısarken (`PRODUCTION_BIAS −0,50`) önceki
kıtlık dönemine ait `IMPORT_QUOTA +0,50` ve `INVESTMENT_BIAS +0,80` hâlâ
etkindi — bir eliyle kısıp diğeriyle teşvik ediyordu.

Bu yüzden her turda, o ürünün güncel plana ait olmayan aktif direktifleri
anında sonlandırılır. `CAPACITY_CAP` bunun dışındadır: onu bant değil oyuncu
payı yönetir (§8.1).

### ★ İthal edilemeyen ürünler

`world_market.importable = false` olan ürünlerde (ekmek, domates, sigara —
nihai tüketim ürünleri) `IMPORT_QUOTA` yayınlanmaz. Kota artsa da hiçbir mal
gelmez; "ithalat kapısı açıldı" demek oyuncuya yanlış bilgi vermektir. Bu
ürünlerde durum olduğu gibi duyurulur (`IMPORT_UNAVAILABLE`) ve tek kalan yol
`SYS_RESERVE`'dür.

Direktifler `expires_tick` ile **kendiliğinden sönümlenir** (varsayılan 96 tick = 24 saat).
Kalıcı müdahale yoktur; sağlık düzelirse ekonomi kendi haline döner.

**Histerezis:** Bir bant değişimi için skorun eşiği **6 tick üst üste** aşması gerekir.
Aksi halde ED bant sınırında salınır ve NPC'ler her tick strateji değiştirir.

## 4.1 Neden önce ithalat, sonra rezerv?

`SYS_RESERVE`'ün stok yaratması, ne kadar iyi gerekçelendirilse de "sistem araya girdi"
hissi verir. İthalat ise **ekonomik olarak gerçek bir cevaptır**: pahalıdır (dünya fiyatı ×1,35),
döviz harcar, ticaret dengesini bozar ve kuru yükseltir. Oyuncu "sistem hile yaptı" değil,
*"ithalat açıldı, maliyetler arttı"* görür — ve ithalat ucuz olmadığı için yurt içi üretim
kârlı bir fırsat olmayı sürdürür.

`SYS_RESERVE` bu yüzden **son çareye** çekildi: yalnızca ürün ithal edilemiyorsa
(nihai perakende ürünleri) veya ekonominin dövizi tükenmişse devreye girer.
Ayrıntı: `12-doviz-mekanigi.md` §6.

## 5. Acil rezerv — `SYS_RESERVE` (son çare, madde 32)

ED "sıfırdan stok yaratmaz". Bunun yerine `SYS_RESERVE` adlı **gerçek bir şirket**
kullanılır; bu şirket normal ekonomik kuralların tamamına tabidir.

```
Tetik: bir ürünün tüm üretim zinciri durdu VE health < 20 VE 12 tick üst üste
Aksiyon: SYS_RESERVE, referans fiyatın 1.5–2.0 katından SELL emri verir
Kural: normal piyasa fiyatının ALTINDA asla satmaz          ← madde 32
Kural: satıştan gelen para SYS_SINK'e gider (para arzını şişirmez)
Kural: her acil müdahale admin paneline ve `world_events` akışına düşer
```

`SYS_RESERVE` bir şirket olduğu için tüm değişmezler (I1–I8) geçerli kalır ve
ledger bütünlüğü bozulmaz. "Sistem hile yapıyor" hissi yerine, oyuncu piyasada
pahalı ama mevcut bir tedarikçi görür.

## 6. Alım desteği — soft floor (madde 33)

Fiyat çöktüğünde ED, NPC'lere `BUY_BIAS` verir. NPC'ler kendi kâr mantıklarıyla
alım yapar. **Referans fiyattan sınırsız alım yoktur:**

```
soft_floor = ema_reference × 0.55
NPC alış emri fiyatı asla soft_floor'un üstüne ED tarafından zorlanamaz;
NPC yalnızca "daha çok almaya eğilimli" olur, "her fiyattan almaya" değil.
```
Oyuncu kötü yatırım yaptıysa zarar eder. Bu bilinçli.

**Uygulama (F7).** `BUY_BIAS` NPC'nin alış **miktarını** ölçekler, fiyatını
değil — ED'nin yapamadıkları listesinin ilk maddesi "fiyat belirlemek"tir (§3).
Destek tabanı ise bir anahtardır: son turun ağırlıklı medyanı `ema × 0,55`'in
altına düşmüşse ED desteği tamamen çekilir ve piyasa temizlensin diye bırakılır.
Yani ED "daha çok al" der, "her fiyattan al" demez.

## 7. Market Health Score (madde 29)

```
score = 100 × ( 0.30 × f_supply
              + 0.15 × f_sellers
              + 0.10 × f_buyers
              + 0.15 × f_depth
              + 0.15 × f_stability
              + 0.15 × f_playerShare )

f_supply    = 1 − min(1, |supply/demand − 1| / 0.5)     (1.0'da tepe)
f_sellers   = min(1, seller_count / target_sellers)
f_buyers    = min(1, buyer_count / target_buyers)
f_depth     = min(1, inventory_depth_ticks / 12)
f_stability = 1 − min(1, price_volatility_24h / 0.35)      ← işlem yoksa 0
f_playerShare = min(1, player_share / product.npc_target_market_share)
```
Ağırlıklar `game_configs` üzerinden admin panelden değiştirilebilir; toplamları
1 olmasa bile skor normalize edilir, aksi halde bant sınırları anlamsızlaşır.

**★ İşlem görmeyen piyasa istikrarlı sayılmaz (R26).** Oynaklık tek başına
yanıltıcıdır: hiç işlem olmayan ölü bir piyasada oynaklık sıfırdır ve istikrar
puanı tam çıkar. Fiyat sinyali olmayan piyasa istikrarlı değil, yoktur — bu
yüzden pencerede işlem yoksa `f_stability = 0`. Bu düzeltme olmadan üretimi
tamamen durmuş bir ürün EMERGENCY yerine STIMULATE bandında kalıyor ve acil
rezerv hiç devreye giremiyordu.

**★ Soğuk başlangıç kuralı (R27).** Dünyada hiç aktif oyuncu şirketi yokken
`f_playerShare` her ürün için 0 çıkar ve skoru kalıcı 15 puan aşağı çeker.
Üstelik ED'nin hiçbir kaldıracı oyuncu getiremez: müdahale edilemez bir
eksiklik için sürekli müdahale edilir. Bu yüzden oyuncusuz dünyada bileşen
nötrlenir (hedef 0 → katsayı 1). İlk oyuncu girdiği anda ölçüm normale döner.

## 8. NPC payının otomatik geri çekilmesi (madde 31)

Ürün bazlı, kullanıcı sayısı bazlı **değil**:

```
player_supply_share = oyuncu arzı / toplam arz        (son 96 tick)
hedef_npc_share     = clamp(1 − player_supply_share × 1.15, 0.10, 0.85)
capacity_cap        = hedef_npc_share  →  NPC toplam kapasitesi bu oranla sınırlanır
```

Geri çekilme **kademelidir**: `capacity_cap` tick başına en fazla %2 değişir.
Aksi halde oyuncular bir üründe üretime başladığında NPC'ler aniden çekilir, arz
çöker ve fiyat patlar.

Uzun vade hedefi (madde 31): çoğu üründe %70–90 oyuncu / %10–30 NPC.

### 8.1 İkinci kısma: satılmayan kendi stoğu (R21)

Yukarıdaki kaldıraç NPC'yi **oyuncu arzı** karşısında geri çeker. Ama oyuncusuz
bir dünyada da aşırı üretim olur: hammadde üreticileri aşağı halkanın
işleyebileceğinden fazlasını üretir. Kapasiteye üreten tesis, malı satılmasa
bile her tur işçilik öder ve o para `SYS_SINK`'e, yani ekonomiden çıkar.

```
kapsam        = çıktı_stoğu / tur_başına_kapasite      (kaç turluk satılmamış üretim)
hedef_kullanım = kapsam ≤ 8 ? 1 : clamp(8 / kapsam, 0.10, 1)
utilization   = önceki + clamp(hedef − önceki, −0.05, +0.05)
```

`facilities.utilization` üretim kapasitesiyle çarpılır (madde 12 formülünün son
terimi). Taban %10'dur: tesis tamamen durmaz, çünkü sıfır üretim **fiyat
sinyalini de yok eder** — piyasa o ürünün pahalılaştığını göremez.

İki kaldıraç birbirinden bağımsızdır ve çarpışmaz: `npcCapacityCap` NPC'nin
piyasa payını, `outputThrottle` tek tesisin doluluk geri beslemesini yönetir.

### 8.2 Formülün doğrudan uygulanamayan yanı (F7)

`hedef_npc_share = clamp(1 − oyuncu_payı × 1,15, 0,10, 0,85)` oyuncu payı
SIFIRKEN bile 0,85 verir. Bunu tesis kullanım oranı olarak uygularsak
oyuncusuz bir dünyada NPC arzı kalıcı olarak %15 kısılır ve boşluğu dolduracak
kimse olmadığı için kıtlık doğar — ED'nin önlemesi gereken şeyi ED üretir.

Bu yüzden hedef pay, NPC'nin mevcut payına göre bir **tavana** çevrilir:

```
tavan = oyuncu_payı > 0 ? min(1, hedef_npc_payı / (1 − oyuncu_payı)) : 1
```

Oyuncu payı 0 iken tavan 1'dir (kısma yok). Oyuncu payı %30'a çıktığında hedef
NPC payı 0,655, mevcut NPC payı 0,70 → tavan 0,936, yani NPC %6,4 geri çekilir.

**Kademelilik TAVANA uygulanır, hedef paya değil.** Hedef payı adım adım
yürütüp tavanı ondan türetirsek tavan uzun süre 1'de kalır; 1 olduğu sürece
direktif yazılmadığı için yürüyüşün durumu da saklanmaz ve geri çekilme hiç
başlamaz. Kademeliliği NPC'nin fiilen tükettiği büyüklüğe taşımak bu kilidi
açar ve madde 31'in amacını korur: tur başına en fazla %2 değişim.

## 9. NPC arketipleri (madde 24)

| Arketip | target_margin | quality_target | price_aggr. | Rol |
|---|---|---|---|---|
| `DISCOUNTER` | 0.08 | 45 | 0.85 | Fiyat tabanı oluşturur |
| `PREMIUM` | 0.35 | 88 | 0.25 | Kalite tavanı oluşturur |
| `VOLUME` | 0.12 | 60 | 0.65 | Likidite hacmi |
| `SPECULATOR` | 0.45 | 55 | 0.90 | Volatilite yaratır, arbitraj kapatır |
| `AGRI` | 0.18 | 70 | 0.45 | Hammadde arzı |
| `INDUSTRIAL` | 0.22 | 72 | 0.40 | Ara ürün arzı |
| `ELECTRONICS` | 0.28 | 82 | 0.35 | Üst zincir arzı |
| `RETAIL_CHAIN` | 0.20 | 65 | 0.55 | Perakende rekabeti |

Her arketip parametreleri ±%15 rastgeleleştirilir → 250 NPC'nin hiçbiri aynı değil.

## 10. NPC fiyat algoritması (madde 25)

```
target = unit_cost × (1 + target_margin) × (1 + directive.PRICE_none)   // ED fiyata dokunmaz
market = ema_reference(product, city)
desired = target × (1 − price_aggressiveness) + market × price_aggressiveness
new_price = clamp(desired, prev × 0.97, prev × 1.03)        ← ±%3 bant
```

**Acil bant istisnası (R4):** `|desired − prev| / prev > 0.25` **ve** market_health < 35
ise bant tek seferliğine ±%10'a açılır. Aksi halde bir çöküşte NPC'lerin fiyata
yetişmesi 6 saat sürer ve NPC'ler oyuncular tarafından sistematik olarak soyulur.

## 11. NPC-NPC işlemlerinde maliyet optimizasyonu (madde 54)

| İşlem türü | Kayıt |
|---|---|
| Oyuncu ↔ Oyuncu | Tam transaction + ledger + shipment |
| Oyuncu ↔ NPC | Tam transaction + ledger + shipment |
| **NPC ↔ NPC** | **Agrege**: `market_trades`'e tek özet satır, ledger'a tek net satır |

NPC-NPC ticareti oyuncuya görünen fiyat sinyalini üretmek için **fiyat ve hacim
olarak** kaydedilir (referans fiyat hesabına girer), ama her lot için ayrı shipment
ve batch yaratılmaz. Bu, tick süresinin en büyük tasarruf kalemidir.

Uyarı: NPC-NPC hacminin referans fiyatı domine etmemesi için bu işlemler medyan
hesabında **%50 ağırlıkla** sayılır (config'ten ayarlanır).
