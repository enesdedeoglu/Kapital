# 12 — Döviz ve Dış Ticaret Spesifikasyonu

> **Durum: karara bağlandı (2 Eylül 2026).** S1–S5 ve §6'daki açık maddeler kapatıldı.
> Bu doküman artık bir tasarım çerçevesi değil, uygulanabilir spesifikasyondur.

| # | Soru | Karar |
|---|---|---|
| S1 | USD ne işe yarar? | **Dış ticaret** — ithalat ve ihracat |
| S2 | Kuru kim belirler? | **Model** — satın alma gücü paritesi çıpası + ticaret dengesi baskısı |
| S3 | Para arzına etkisi? | İhracat musluk, ithalat gider. **Oyuncu dış fiyatı belirleyemez** |
| S4 | Kur riski? | Şirket değerine girer; **%1,5 spread**, komisyon `SYS_SINK`'e |
| S5 | Director'ın rolü? | Altıncı kaldıraç **`IMPORT_QUOTA`**; `SYS_RESERVE` son çareye çekilir |

---

## 1. Değişmeyen kısıt: USD yurt içi fiyatlamaya sızmaz

| ₺ — yurt içi ekonominin tamamı | USD — üç yer |
|---|---|
| `market_orders`, `retail_offers` | `companies.usd_balance` |
| Maaş, bakım, kira, faiz, vergi, kredi | `fx_trades` (kur işlemi) |
| Tesis maliyeti, `price_history`, `market_health` | `foreign_trades` (dış ticaret) |

Sızarsa her fiyat formülü ve endeks para birimi boyutu kazanır; etki 3 tablodan ~20 tabloya çıkar.

---

## 2. Sistem şirketleri (altıya çıktı)

| Kod | Rol | Bakiyesinin anlamı |
|---|---|---|
| `SYS_CONSUMER` | NPC tüketiciler | ₺ negatif = perakendeden basılan para |
| `SYS_SINK` | Maaş, bakım, faiz, vergi, spread | ₺ pozitif = yok edilen para |
| `SYS_RESERVE` | Acil rezerv (son çare) | normal şirket gibi |
| `SYS_BANK` | Kredi anaparası | ₺ negatif = dolaşımdaki kredi |
| `SYS_FX` | ₺ ↔ $ dönüşümünün karşı tarafı | ₺ negatif = **dış ticaretin bastığı net para** · `−usd_balance` = oyuncuların elindeki USD |
| `SYS_WORLD` | Dünya piyasası — malı alan/satan taraf | `−usd_balance` = oyuna giren toplam USD · stok akışı |

`SYS_FX` ve `SYS_WORLD` ayrı tutuluyor: biri **sermaye hareketini**, diğeri **ticaret dengesini**
ölçer. Tek şirkette birleştirilseler iki metrik ayrıştırılamazdı.

### 2.1 Akışın muhasebesi

```
İHRACAT  (oyuncu mal verir, ₺ kazanır — para MUSLUĞU)
  mal:  oyuncu → SYS_WORLD
  $  :  SYS_WORLD −usd  →  oyuncu +usd
  ₺  :  oyuncu USD'yi bozar → SYS_FX −try, oyuncu +try     ← ₺ burada yaratılır

İTHALAT  (oyuncu ₺ öder, mal alır — para GİDERİ)
  ₺  :  oyuncu −try  →  SYS_FX +try                        ← ₺ burada yok edilir
  $  :  SYS_FX −usd → oyuncu, oyuncu → SYS_WORLD
  mal:  SYS_WORLD → oyuncu (limanda, transit süresiyle)
```

Değişmez **I1 para birimi başına** koşar: `I1-TRY` ve `I1-USD`. Her iki defter de ayrı ayrı sıfır toplamlıdır.

---

## 3. Dünya piyasası (S1 + S3)

### 3.1 Fiyat — oyuncu belirlemez

Dünya fiyatı **USD cinsindendir ve lansmanda çıpalanır**:

```
world_price_usd(p) = base_price_usd(p) × world_price_index(p)
base_price_usd(p)  = products.base_reference_price / fx_rate_0     ← seed anında sabitlenir
```

Kur düştükçe ithalat ₺ olarak pahalılaşır, ihracat cazipleşir — gerçek makro döngü budur.

### 3.2 Sürtünme bandı — fiyat keşfini boğmamak için geniş

```
ihracatta oyuncunun aldığı  = world_price_usd × 0.75
ithalatta oyuncunun ödediği = world_price_usd × 1.35
```

İki sonucu var:
1. **Arbitraj döngüsü imkânsız.** İthal edip ihraç etmek her turda ~%45 kaybettirir.
2. **Yurt içi fiyat keşfi hayatta kalır.** Taban dünya fiyatının %25 altında, tavan %35
   üstünde — band toplam **~%60 genişliğinde**. Yurt içi fiyat bu aralıkta serbestçe oluşur;
   dış ticaret yalnızca uçlarda devreye girer. Dar bir band bütün fiyatları dünya fiyatına
   çivilerdi (bkz. `10-riskler.md` R18).

Katsayılar `game_configs`'ten ayarlanır.

### 3.3 Derinlik — musluk tavanı

```
tur başına ihracat kapasitesi = Σ yurt içi talep(p) × export_depth_pct   (varsayılan %15)
tur başına ithalat kapasitesi = Σ yurt içi talep(p) × import_depth_pct   (varsayılan %15)
```

Kapasite tüm oyuncular arasında **pro-rata** paylaşılır (ilk gelen değil) — tick zamanlaması
yarışı oluşmaz. Bu tavan, R17'nin (ihracat musluğu) asıl kapatma noktasıdır.

### 3.4 Hangi ürünler?

| Grup | İthalat | İhracat | Gerekçe |
|---|---|---|---|
| Hammadde (buğday, demir, kömür, tütün…) | ✅ | ✅ | Zincir kopmalarının asıl çözümü burada |
| Ara ürün (un, çelik, kumaş…) | ✅ | ✅ | |
| **Nihai perakende ürünü** (ekmek, sigara, mobilya…) | ❌ | ✅ | İthal edilebilseydi oyuncunun mağazası dünya piyasasıyla rekabet ederdi — perakende oyununun kendisi ölürdü |

`world_market.importable` / `.exportable` alanlarıyla ürün bazında yönetilir.

### 3.5 Liman gerekir

Dış ticaret **Liman** tesisi ister. Liman yalnız `cities.has_port = true` olan şehirlerde
kurulabilir: **İstanbul, İzmir, Bursa** (Ankara ve Konya hayır).

Mal limana gelir; oradan iç şehirlere ulaşması normal lojistik (mesafe + transit) gerektirir.
Bunun oyun içi sonucu: **liman şehirleri stratejik değer kazanır ve Konya'daki oyuncunun
İzmir'deki oyuncuyla ticaret yapmak için gerçek bir nedeni olur.**

**Seviye kilidi: Lv7.** Yeni oyuncu kur riskiyle karşılaşmaz.

---

## 4. Kur modeli (S2)

Satın alma gücü paritesi çıpası + ticaret dengesi baskısı:

```
target_rate = fx_rate_0 × game_cpi                      // dış dünya enflasyonu = 0 kabul
tb          = (ihracat₺ − ithalat₺) / (ihracat₺ + ithalat₺ + ε)     // son 96 tur, [−1, +1]

rate_t = rate_{t−1} × ( 1 + α × (target_rate / rate_{t−1} − 1) − k × tb )

α = 0.05   (PPP'ye yavaş çekim)
k = 0.02   (ihracat fazlası ₺'yi değerlendirir)
clamp: tur başına ±%0,5 · gün başına ±%3
```

Okunuşu: **oyun içi enflasyon %20 olursa ₺ zamanla %20 değer kaybeder.** İhracat fazlası
veren ekonomi ₺'sini değerlendirir. Kur bir oyuncu tarafından belirlenmediği için manipüle
edilemez; `fx_rates` tablosuna tur başına tek satır yazılır.

### 4.1 `world_price_index` — MVP-1'de sabit

Ürün bazında admin ayarlı, varsayılan 1.0. Yavaş çevrim (dünya emtia döngüsü) **F11'e**
ertelendi: MVP-1'in denge ayarında sabit bir dış çıpa olması, hareketli olmasından
kıyaslanamayacak kadar değerli.

---

## 5. Kur işlemi (S4)

```
spread = %1,5 (her yönde) → SYS_SINK'e gider (para gideri)
şirket değeri = cash + usd_balance × fx_rate + stok + tesis − borç
seviye kilidi = Lv7
```

Spread, kur hareketini önceden gören oyuncunun risksiz round-trip yapmasını engeller.
Döviz tutmak bir spekülasyon vektörüdür ve serbesttir — ama bedava değildir.

**NPC'ler döviz tutmaz.** NPC fiyat algoritmasının kur riski taşıması, onları oyunculara
karşı sistematik olarak zayıflatırdı. NPC'ler dış ticaret yapabilir, ama kazandıkları USD'yi
aynı turda bozar.

---

## 6. Economic Director: `IMPORT_QUOTA` (S5)

Altıncı kaldıraç. `npc_directives.lever = 'IMPORT_QUOTA'`, `magnitude ∈ [−1, +1]`:

```
import_depth_pct_efektif = import_depth_pct × (1 + magnitude × 3)
→ magnitude +1 ile derinlik 4 katına çıkar, −1 ile yarıya iner
```

**Müdahale sıralaması değişti:**

| Health | Eski | **Yeni** |
|---|---|---|
| 20–35 `STIMULATE` | yatırım teşviki | yatırım teşviki **+ `IMPORT_QUOTA` +0.5** |
| < 20 `EMERGENCY` | `SYS_RESERVE` | **önce `IMPORT_QUOTA` +1**; ürün ithal edilemiyorsa (nihai perakende) veya döviz de yetmiyorsa `SYS_RESERVE` |

`SYS_RESERVE` böylece **son çareye** çekildi. Gerekçe: ithalat, ekonomik olarak gerçek bir
cevaptır — pahalıdır, döviz harcar, ticaret dengesini bozar, kuru yükseltir. Oyuncu
"sistem hile yaptı" değil, **"ithalat açıldı, maliyetler arttı"** görür; ve ithalat ucuz
olmadığı için yurt içi üretim kârlı bir fırsat olmayı sürdürür.

---

## 7. Şema eklemeleri

```sql
-- cities'e:
has_port BOOLEAN NOT NULL DEFAULT FALSE      -- İstanbul, İzmir, Bursa = true

CREATE TABLE world_market (                  -- ürün bazlı dış ticaret config'i
  product_id        SMALLINT PRIMARY KEY REFERENCES products(id),
  importable        BOOLEAN NOT NULL DEFAULT FALSE,
  exportable        BOOLEAN NOT NULL DEFAULT FALSE,
  base_price_usd    money_amt NOT NULL,      -- seed: base_reference_price / fx_rate_0
  world_price_index DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  export_multiplier DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  import_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.35,
  export_depth_pct  DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  import_depth_pct  DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  world_quality     quality_t NOT NULL DEFAULT 70    -- ithal malın kalitesi
);

CREATE TABLE foreign_trades (
  id             BIGSERIAL,
  tick_id        BIGINT NOT NULL,
  company_id     UUID NOT NULL,
  facility_id    UUID NOT NULL,              -- liman
  product_id     SMALLINT NOT NULL,
  direction      TEXT NOT NULL,              -- 'IMPORT' | 'EXPORT'
  quantity       qty_amt NOT NULL,
  unit_price_usd money_amt NOT NULL,
  usd_amount     money_amt NOT NULL,
  try_equivalent money_amt NOT NULL,
  quality        quality_t NOT NULL,
  PRIMARY KEY (tick_id, company_id, facility_id, product_id, direction)   -- ★ idempotency
) PARTITION BY RANGE (tick_id);
```

`fx_rates` ve `fx_trades` zaten `03-veritabani-semasi.md`'de tanımlı.

---

## 8. Faz etkisi ve süre

| Faz | İş | Süre |
|---|---|---|
| **F0** | `currency_t`, `usd_balance`, `ledger_entries.currency`, `SYS_FX` + `SYS_WORLD`, I1 para birimi başına | 2 gün |
| **F4** | `world_market`, `foreign_trades`, Liman tesisi, pro-rata derinlik dağıtımı, dış ticaret ekranı | **+1 hafta** |
| **F5** | Kur dönüşümü, %1,5 spread, Lv7 kilidi, şirket değerine USD | +0,5 hafta |
| **F6** | NPC dış ticaret yapar ama USD tutmaz | dahil |
| **F7** | Kur modeli (`fx_rates`), `IMPORT_QUOTA` kaldıracı, müdahale sıralaması | 3 gün |
| **F8** | Kur istikrarı, ticaret dengesi, fiyat keşfi metrikleri | dahil |
| **F10** | Admin: kur grafiği, ticaret dengesi, dolaşımdaki USD | dahil |

**Toplam ~2,5 hafta.** (Önceki kaba tahmin 1,5 haftaydı; tasarım somutlaştıkça
liman tesisi, pro-rata dağıtım ve dış ticaret ekranı netleşti.)

**Kapalı betaya güncel tahmin: ~22,5 hafta.**

---

## 9. Simülasyon eşikleri (F8 çıkış kriterine eklenenler)

| Metrik | Hedef |
|---|---|
| Kur 90 günlük değişim | ±%25 içinde |
| Dış ticaret kaynaklı para girişi / toplam musluk | < %30 |
| Döviz spekülasyonundan gelen kâr / toplam kâr | < %10 |
| **Yurt içi fiyatın dış ticaret bandına yapışma oranı** | **< %20 tur** (R18 — fiyat keşfi yaşıyor mu) |
| Liman şehri / iç şehir şirket değeri medyan oranı | 0,9 – 1,3 (liman aşırı avantaj olmamalı) |
