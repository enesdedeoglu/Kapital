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
f_stability = 1 − min(1, price_volatility_24h / 0.35)
f_playerShare = min(1, player_share / product.npc_target_market_share)
```
Ağırlıklar `game_configs` üzerinden admin panelden değiştirilebilir.

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
