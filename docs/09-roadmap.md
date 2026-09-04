# 09 — Geliştirme Yol Haritası (10 Faz)

Her faz **çalışan kod** üretir. Mock ekran + "backend sonra" yaklaşımı yok (madde 59).
Süre tahminleri 1 tam zamanlı senior geliştirici içindir; ekip büyürse F9 paralelleşir.

```
F0 ─ F1 ─ F2 ★ ─ F3 ─ F4 ─ F5 ─ F6 ─ F7 ─ F8 ★ ─ F10 ─ F11
                              └──── F9 (mobil, F2'den itibaren paralel) ────┘
★ = geçiş kapısı (gate); geçilmeden sonraki faza başlanmaz
```

---

## F0 — Temel altyapı · 2 hafta  ✅ TAMAMLANDI (2 Eylül 2026)
- pnpm monorepo, turbo, TS strict, ESLint/Prettier, CI
- `docker-compose.dev.yml`: PostgreSQL 16 + Redis 7 + Grafana
- Drizzle şema + migration pipeline, seed altyapısı
- `packages/shared`: `Money`/`Qty` branded tipleri, `roundToMoney`, hata kodları
- `packages/config`: versiyonlu config yükleyici + hot reload
- **Ledger servisi + `transfer()` fonksiyonu** (tek para geçiş noktası)
- Auth: kayıt, giriş, refresh token, `Idempotency-Key` middleware
- Gözlemlenebilirlik iskeleti (OTel + Prometheus)

**Çıkış:** ✅ `POST /auth/register` çalışıyor · defter testleri (T1, T3, T4, T6) geçiyor ·
migration CI'da koşuyor · 46 test yeşil.

Uygulama sırasında alınan iki ek karar: [ADR-0006](adr/0006-elle-yazilan-migrationlar.md)
(elle yazılan SQL migration'ları + şema ayrışma bekçisi) ve
[ADR-0007](adr/0007-acik-di-tokenlari.md) (açık DI token'ları).

`packages/economy` ve `apps/worker` F0'da oluşturulmadı: ilk saf formüller ve tick
motoru F2'de yazılacak, boş paket iskeleti bırakmanın faydası yok.

---

## F1 — Dünya ve şirket · 1,5 hafta  ✅ TAMAMLANDI (2 Eylül 2026)
- `cities`, `products`, `product_categories`, `facility_types`, `city_distances` seed
- `companies` CRUD, şirket kurma akışı, `company_levels` tablosu
- `facilities` oluşturma (inşaat süresi dahil), `inventories`
- **`inventory_batches` + FEFO tüketim servisi** (`06-transaction-locking.md` §4)
- `GET /company`, `GET /cities`, `GET /products`, `GET /inventory`

**Çıkış:** ✅ Şirket kurulup manav açılabiliyor · lot ekleme/çıkarma ve **T2** (aynı stok
iki kez satılamaz) testleri geçiyor · 74 test yeşil.

Uygulama notu: `used_capacity` bir trigger ile senkron tutulur ve
`CHECK (used_capacity <= capacity)` kısıtı **I4'ü veritabanı düzeyinde garanti eder** —
uygulama katmanı atlansa bile depo kapasitesi aşılamaz. Tesis oluşturulunca envanteri
de trigger ile açılır (1:1).

---

## F2 ★ — Tick motoru v1 + Perakende (MVP-0) · 2,5 hafta  ✅ TAMAMLANDI (3 Eylül 2026)
- `economic_ticks` + `tick_phase_runs` durum makinesi
- Orchestrator (Redis lider kilidi) + BullMQ flow
- Fazlar: P0, P3 (retail), P4 (bozulma+bakım), P5 (finans), P7
- `packages/economy`: talep, çekicilik, pazar payı, yeniden dağıtım formülleri
- 5 basit NPC satıcı (sabit fiyat), `SYS_CONSUMER` / `SYS_SINK` şirketleri
- Deterministik RNG, `config_version` snapshot
- Değişmez kontrolleri I1–I8, kilitleme testleri T1–T6

### ★ GEÇİŞ KAPISI 1 — MVP-0 kabul testi
```
Şirket kur → Manav aç → Domates al → Fiyat koy → Tick koş
→ NPC tüketici alsın → Para artsın → Rapor gör
```
**✅ GEÇİLDİ.** MVP-0 kabul testi uçtan uca yeşil; 120 test geçiyor.

Uygulama notları:
- `packages/economy` saf çekirdek olarak doğdu (ADR-0003); tüm denge formülleri
  I/O'suz ve deterministik. `packages/sim` (F8) bu formülleri birebir koşacak.
- Orchestrator, Redis yerine **PostgreSQL danışma kilidi** kullanıyor ve fazlar
  şimdilik tek süreçte sırayla koşuyor — gerekçe ve BullMQ'ya geçiş eşiği
  [ADR-0008](adr/0008-tick-orchestrator-kilidi.md)'de.
- **R10, R1 ve R2 azaltımları uygulandı ve test edildi.**

---

## F3 — Tesisler ve üretim · 2 hafta  ✅ TAMAMLANDI (3 Eylül 2026)
- `production_recipes` + `recipe_inputs` + ürün grafı DAG doğrulaması
- P1 (PRODUCE) fazı: tarım, maden, fabrika — tek kod yolu
- Üretim kalitesi formülü, `production_jobs` (çok-tick döngüler)
- Tesis yükseltme (`facility_level_curve`), `condition` aşınması
- Zincir: Buğday→Un→Ekmek, Demir+Kömür→Çelik

**Çıkış:** ✅ Oyuncu kendi buğdayını üretip ununu yapıp ekmeğini satabiliyor.
154 test geçiyor.

Uygulama notları:
- Tarla, maden ve fabrika **tek kod yolunu** kullanır; aralarındaki fark yalnız
  reçetedir (girdisiz reçete = hammadde üreticisi).
- Ürün grafı DAG doğrulaması seed'de koşar: döngülü reçete hiç yazılamaz (R13).
- Kendi tesisleri arası stok taşıma eklendi ama **yalnız aynı şehirde**;
  şehirler arası taşıma F4'te sevkiyat sistemine bağlanacak, aksi halde
  lojistik bedavaya atlanabilirdi.
- Yeni denge bulgusu: derin zincirlerde kalite sabit noktaya yakınsıyor
  ([R19](10-riskler.md)) — teknoloji/çalışan sistemleri bunun telafisi.

---

## F4 — Piyasa, lojistik ve dış ticaret · 3,5 hafta  ✅ TAMAMLANDI (3 Eylül 2026)
- `market_orders` (BUY/SELL, min_quality, escrow), advisory lock protokolü
- P2 (EXCHANGE) fazı: eşleştirme motoru, kısmi doldurma
- `shipments`: mesafe = maliyet **+ transit süresi**
- Ağırlıklı medyan + P10/P90 kırpma + EMA referans fiyat
- `price_history`, wash-trade tespiti (`trade_flags`)
- Şirket değeri hesabı (piyasa medyanıyla stok değerleme)
- **Dış ticaret** (`12-doviz-mekanigi.md`): `world_market`, `foreign_trades`,
  **Liman** tesisi (yalnız İstanbul/İzmir/Bursa), pro-rata derinlik dağıtımı,
  sürtünme bandı (ihracat ×0,75 · ithalat ×1,35), Lv7 kilidi

**Çıkış:** ✅ İki oyuncu şehirler arası ticaret yapabiliyor, referans fiyat oluşuyor;
liman sahibi oyuncu ithalat/ihracat yapabiliyor. 215 test geçiyor.

Uygulama notları:
- **Escrow kullanılmadı** ([ADR-0009](adr/0009-escrow-yerine-eslesme-aninda-dogrulama.md)):
  bakiye eşleşme anında doğrulanır. Satıcı zarar görmez çünkü stok yalnız
  başarılı eşleşmede tüketilir.
- **Wash trade'in birincil savunması eşleştirme motorunun kendisi çıktı**: kendi
  ortağınızla eşleşemezsiniz, motor en ucuz toplam maliyeti seçer. Tespit
  mekanizması ikinci katman (bkz. [R8](10-riskler.md)).
- Kur modeli PPP çıpasına yakınsıyor ve iki para biriminin defteri ayrı ayrı
  dengede kalıyor (I1-TRY, I1-USD).

---

## F5 — Bankacılık, kredi ve döviz · 2 hafta  ✅ TAMAMLANDI (3 Eylül 2026)

> **Karar (2 Eylül 2026):** Krediler MVP-1 kapsamına alındı ve denge kapısının **önüne** çekildi.

- **`SYS_BANK` sistem şirketi.** Kredi anaparası buradan çıkar — bu bir **para yaratımıdır**;
  geri ödeme aynı yere döner ve parayı **yok eder**. Faiz `SYS_SINK`'e gider (kalıcı gider).
- Kredi limiti şirket değerine bağlanır, keyfi değil:
  `max_loan = company_value × leverage_ratio(level) − mevcut_borç`
  (öneri: Lv1–5 için 0,40 · Lv6–12 için 0,60 · üstü 0,75, config'ten ayarlı)
- Taksit tahsilatı P4 (UPKEEP) fazında; faiz oranı `game_configs`'ten
- **Kademeli temerrüt.** Nakit yetmezse tesis kapatılmaz: `missed_payments` artar → uyarı →
  3 kaçırılan taksitte tesis tasfiyesi → şirket `BANKRUPT`. Madde 40'ın "yeni kullanıcıyı
  yanlışlıkla oyundan silme" şartının uygulama noktası burasıdır
- Şirket değerinde borç düşülür (formül F4'te yazıldı, burada gerçek veri gelir)
- Mobil: borç ekranı, taksit geri sayımı, temerrüt uyarısı

- **Kur dönüşümü:** `fx_trades`, **%1,5 spread** (komisyon `SYS_SINK`'e), Lv7 kilidi,
  şirket değerine `usd_balance × fx_rate` girer

**Çıkış:** ✅ Oyuncu kredi çekip tesis kurabiliyor; ödeyemeyince kademeli olarak
batıyor, tek turda silinmiyor. 253 test geçiyor.

Uygulama notları:
- **`loans` tablosu F0'da migration'a girmemişti** — yalnız şema dokümanında vardı.
  Ayrışma testi Drizzle ↔ veritabanı arasını korur, doküman ↔ veritabanı arasını
  korumaz. Eksik F5'te ortaya çıktı ve 0009 ile kapatıldı.
- Faiz ve anapara **ayrı hesaplara** gider: faiz `SYS_SINK` (kalıcı gider),
  anapara `SYS_BANK` (yaratılan parayı yok eder). Aynı hesaba yazılsaydı para
  arzı ölçümü bozulurdu.
- Test harness'i başlangıç sermayesini `SYS_BANK`'tan veriyordu; `SYS_TREASURY`
  tam da bunu ayırmak için vardı. Kredi payı metriği (R15) kirleniyordu.
- Tasfiye bir NAKİT hareketi değildir: banka varlığa el koyar, borç azalır.
  Kredinin yarattığı para zaten CAPEX ile ekonomiden çıkmıştı, `Σ bakiye = 0`
  özdeşliği bozulmaz.
- Döviz kısmı F4'te gelmişti (kur modeli, dönüşüm, spread).

**Neden denge kapısından önce:** F8'in çıkış kriterlerinden biri *"90 günde iflas oranı < %15"*.
Kredi yoksa oyunda iflas mekanizması da yok — bu metrik ölçülemez ve simülasyon eksik kalır.

---

## F6 — NPC ekonomisi · 2 hafta  ✅ TAMAMLANDI (3 Eylül 2026)
- `npc_profiles`, 8 arketip, ±%15 parametre dağılımı
- P6 fazı NPC bölümü: operasyonel (her tick) + stratejik (N tick)
- NPC fiyat algoritması (±%3 bant + acil bant)
- NPC stok yönetimi (min 4 / hedef 12 / max 24 tur)
- NPC alış teklifi **navlun payı** içerir (R20) — `inputBid` + medyan mesafe
- **Üretim kısma** (R21): `facilities.utilization` + `outputThrottle`
- Ürün grafı tohum verisine karşı doğrulanır (R23); mobilya zinciri kapatıldı
- Tohum fiyatları tariflerle tutarlı hale getirildi, marj bandı testi (R22)
- 60 NPC / 75 tesis dünya tohumlama + `run-ticks` başsız koşu aracı

**Çıkış:** Oyuncusuz bir dünyada ekonomi 500 tick boyunca kendi kendine sağlıklı koşuyor.

**Ölçüm (500 tur, oyuncusuz):**

| Ölçüt | Sonuç | Hedef |
|---|---|---|
| Tur süresi | ort 1.202 ms · p95 1.394 ms | < 37.000 ms |
| Para arzı | 15,00 M → 15,17 M ₺ (**+%1,1**) | sapma yok |
| Game CPI | 1,000 → **1,029** (tepe 1,033, sonra geri) | 1,0 civarında dengeli |
| İflas | **0** / 65 NPC | sıfır |
| İşlem gören ürün | **10 / 10** | tümü |
| Zincir duruşu | yok — yalnız normal sürtünme | yok |
| Perakende cirosu | 4.900–7.800 ₺/tur, trend yok | çökmüyor |

CPI 500 tur boyunca 1,022 → 1,033 → 1,029 seyretti: yükselip **geri döndü**.
Tek yönlü sürüklenme değil, dar bantta salınım — yani fiyat mekanizması kendi
kendini düzeltiyor.

**Devredilen:** NPC stratejik yatırım kararı (`investmentScore` yazılı ve test
edildi, ama tesis inşası henüz bağlanmadı) → F7 ile birlikte, Ekonomi Direktörü
sermaye akışını yönetirken. Nihai denge ayarı → F8.

---

## F7 — Economic Director · 1,5 hafta  ✅ TAMAMLANDI (3 Eylül 2026)
- `market_health` skorlaması — **6 bileşen** (yol haritası "7" diyordu; docs/07 §7
  formülü altı terim içeriyor ve ağırlıkları 1,00'a toplanıyor)
- ED karar motoru + histerezis (6 tur) + 6 direktif kaldıracı
- `npc_directives` yayını ve NPC tarafında tüketimi
- `SYS_RESERVE` acil rezerv akışı (12 tur EMERGENCY + sıfır üretim)
- NPC payının oyuncu arzına göre kademeli geri çekilmesi (madde 31)
- NPC stratejik yatırımı (F6'dan devredildi) — `INVESTMENT_BIAS` kaldıracının tüketicisi
- `economy_snapshots`: para arzı, Game CPI, **Gini**
- **Kur modeli** F4'te kurulmuştu; `IMPORT_QUOTA` tüketimi de oradaydı
- `world_events` — her müdahale görünür duyuru olur
- `scenario-shock.ts` — arz şoku senaryosu aracı

**Çıkış:** Bir ürünün üretimi kasıtlı durdurulduğunda ekonomi kendini toparlıyor —
önce ithalat kapısı açılarak, ancak o yetmezse rezervle.

### Bulunan ve düzeltilen tasarım kusurları

500 turluk koşu ve arz şoku senaryosu, ancak bu ölçekte görünen altı kusur
ortaya çıkardı (ayrıntı: docs/10 R24–R29):

| Kod | Kusur | Etki |
|---|---|---|
| R24 | ED bolluğu kıtlık sanıp teşvik veriyordu | buğday oranı 1,93 iken üretim +%15 |
| R25 | Eski direktifler 96 tur yaşıyordu | ED aynı anda kısıp teşvik ediyordu |
| R26 | Ölü piyasa "istikrarlı" sayılıyordu | acil rezerv hiç tetiklenemiyordu |
| R27 | `f_playerShare` oyuncusuz dünyada ceza | 10 ürün kalıcı ADJUST |
| R28 | Eşzamanlı yatırım balonu | 120 turda 43 tesis, para arzı −%11,3 |
| — | Ara mal talebi gerçekleşen üretimden ölçülüyordu | arz şoku GÖRÜNMEZ oluyordu |

Sonuncusu en incesiydi: çelik bitince mobilya fabrikası da durur, dolayısıyla
ölçülen çelik talebi de düşer ve arz/talep oranı 1,00'da kalır. Talep artık
aşağı halkanın **kapasitesinden** ölçülüyor — girdisizlikten duran tesis o
girdiyi istemeye devam eder.

### ED aktifken 500 turluk oyuncusuz koşu

ED'nin sağlıklı bir ekonomiyi bozmadığını doğrular — müdahale yalnız gereken
yere dokunmalı:

| Ölçüt | F6 (ED yok) | F7 (ED aktif) |
|---|---|---|
| Para arzı | +%1,1 | **+%1,1** |
| Game CPI | 1,029 | **1,028** |
| İflas | 0 / 65 | **0 / 65** |
| İşlem gören ürün | 10 / 10 | **10 / 10** |
| Tur süresi (ort) | 1.202 ms | 1.263 ms |

ED'nin maliyeti tur başına ~60 ms (%5); bütçe 37.000 ms.

### Çıkış kriteri ölçümü — arz şoku senaryosu

`scenario-shock.ts` bir ürünün üretimini durdurur, stoğunu imha eder, gözler ve
sonra üretimi geri açar. Depoları dolu bırakan bir "şok" aslında şok değil
duraklamadır: mobilya üretimi 80 tur durdurulduğu halde raflar dolu kaldığı
için skor YÜKSELDİ. Bu yüzden şok stoğu da imha eder.

**Domates (ithal edilemez, perakende ürünü):**

| Aşama | Skor | Bant | Arz/talep | Direktif | 24t satış |
|---|---|---|---|---|---|
| ısınma sonu | 83,41 | HEALTHY | 0,72 | — | 1.383 |
| şok +20 | 54,98 | WATCH | 0,48 | 1 | 589 |
| şok +40 | 54,98 | ADJUST | 0,36 | 3 | 0 |
| şok sonu | 54,99 | ADJUST | 0,27 | 3 | 0 |
| onarım +20 | 65,78 | WATCH | 0,26 | 1 | 398 |
| onarım sonu | 69,97 | WATCH | 0,42 | 1 | **2.089** |

Kademeli tırmanış (HEALTHY → WATCH → ADJUST), direktiflerin yoğunlaşması ve
onarımdan sonra şok ÖNCESİNİN üstüne çıkan satış. Skor 54,98'de sabitken bandın
WATCH'tan ADJUST'a geçmesi histerezisin çalıştığını gösterir: eşik aşılıyor ama
bant 6 tur beklemeden değişmiyor.

Domates ithal edilemediği için ithalat kapısı açılmadı — tasarım gereği
(docs/07 §4.1). İthalat ve acil rezerv yolları `director.test.ts` içinde
belirlenimci olarak doğrulanıyor: ithal edilebilir üründe `IMPORT_QUOTA` ilk
kaldıraç, ithal edilemeyende 12 tur EMERGENCY sonrası `SYS_RESERVE` referansın
1,75 katından satışa çıkıyor.

**Devredilen (F8):** CAPEX'in para arzını sızdırması (R29) ölçüldü ama çözümü
dairesel akış tasarımına dokunuyor; simülasyon kapısında karara bağlanacak.
Ayrıca sağlık skorunun tabanı: arz/talep 0,27 ve sıfır satışta bile skor ~55'te
kalıyor, çünkü arz dışı bileşenler (satıcı, alıcı, derinlik, istikrar) ağırlığın
%70'ini taşıyor. Ağırlık kalibrasyonu F8'de.

---

## F8 ★ — Simülasyon ve denge · 2 hafta  🔨 SÜRÜYOR (3 Eylül 2026)
- `apps/sim`: headless harness — **`packages/sim` değil, `apps/sim`**: bu bir
  kütüphane değil, koşulan bir araç. Ayrıca `@kapital/api`'nin servislerini
  kullanır ve bir paketin bir uygulamaya bağımlı olması katmanı ters çevirirdi.
- 8 oyuncu davranış profili ✅
- 12 metriklik geçiş kapısı raporu ✅
- Parametre tarama (`sweep.ts`) ✅

### ★ Simülasyon GERÇEK servisleri çağırır

Simüle edilen oyuncu, gerçek oyuncunun geçtiği kod yolundan geçer
(`@kapital/api/services`): aynı doğrulamalar, aynı seviye kilitleri, aynı nakit
kontrolleri, aynı defter kayıtları. Kuralları simülasyon için ikinci kez
yazmak, simülasyonu ölçtüğü şeyden ayırırdı — denge kapısı da o kadar
anlamsızlaşırdı. Simülasyonun kendisi yalnız KARARI verir.

### Bulunan ve düzeltilen kusurlar

| Kod | Kusur | Nasıl görüldü |
|---|---|---|
| R30 | Seviye merdiveni kilitli: hiçbir oyuncu Lv1'i geçemiyor | 700 turda 420 `LEVEL_LOCKED` |
| R30b | İlerleme hiç uygulanmamış; 4 sayaç ölü | `companies.level` hiçbir yerde artmıyordu |
| R31 | Aynı depoya çoklu sevkiyat TÜM TURU düşürüyor | oyuncular alım yapınca çöktü |
| — | Oyuncu teklifi referansın altında: hiç mal alamıyor | 138 alış emri, 0 dolum |
| — | Oyuncu rafı piyasanın %37 üstünde: hiç satamıyor | 87 dükkân, 7.693 ₺ ciro, 17.272 ₺ bakım |

### Kapı çok tohumludur (R39)

Dünya olayları eklendikten sonra her koşu farklı bir dünya üretiyor. Tek koşuya
bakan bir kapı gürültüyü sinyal sanar; ölçüldü: aynı yapılandırmanın iki
koşusunda NPC payı %52,7 ve %68,1, kur %22,0 ve %35,9.

```bash
pnpm --filter @kapital/sim exec tsx src/cli/gate.ts 5 60 700 --json rapor.json
```

Bir metrik İKİ koşulu birden sağlarsa geçer: tohumların **çoğunluğunda** eşiği
tutmalı **ve** tohumlar arası **medyanı** bandın içinde olmalı. Tohumlar
kararda anlaşmazsa metrik **kararsız** işaretlenir — eşiği tutsa bile kapıyı
ona dayandırmak risklidir.

Kararsızlık ölçüsü sayısal yayılma değil karar ayrılığıdır: `(max−min)÷medyan`
kullanıldığında para arzı yanlışlıkla kararsız çıktı (medyan %0,1, aralık
%−1,3…%1,4 — mutlak olarak minicik, orana göre 27 kat).

### İlk çok tohumlu koşu (5 × 60 × 700, 118 dk): **7/12**

Geçenler: fiyat hareketi · para arzı · iflas oranı · kredi payı · dış ticaret
payı · bant yapışması · tur süresi.

Kalanlar: arz/talep · NPC payı · ilk gün büyümesi · 1. hafta değeri · kur.

★ Üç metrik KARARSIZ (tohumlar kararda anlaşmıyor): NPC payı 2/5, kur 2/5,
fiyat hareketi 3/5. **Tek koşular yanıltmıştı**: NPC payı bir koşuda %68,1
çıkıp "hedefe girdi" diye kaydedilmişti; beş tohumda medyanı %56,3 ve yalnız
2'sinde tutuyor.

### ★ GEÇİŞ KAPISI 2 — Ekonomi hedefleri

`08-mvp-kapsami.md` sonundaki **12** metrik eşiği tutmalı (yol haritası "8"
diyordu; tablo 12 satır). **Tutmadan beta açılmaz.**

**Şu anki durum: KAPI GEÇİLMEDİ.** 60 oyuncu × 700 tur koşusunda 6 metrik
tutmuyor. Kök neden ölçüldü ve mekanizması kuruldu (R32): dünya talebi oyuncu
tabanıyla ölçeklenmiyordu — 130 satış noktası, nokta başına 43 ₺/tur ciro,
bakım 2 ₺/tur, brüt marj %12. Madde 56'nın "1. hafta 100.000–250.000 ₺"
hedefi bu talep düzeyinde matematiksel olarak ulaşılamaz.

`worldDemandScale` eklendi; `economy.demandScale.baseMultiplier` kalibrasyon
koludur. **Varsayılanı 1 (kapalı) bırakıldı**, çünkü tarama talebi büyütmenin
tek başına durumu KÖTÜLEŞTİRDİĞİNİ gösterdi:

| `baseMultiplier` | Arz/talep bandındaki ürün | Kur değişimi | Bant yapışması |
|---|---|---|---|
| 1 | **6/10** ✓ | %3,4 | %62,9 |
| 5 | 4/10 ✗ | %10,2 | %10,0 |
| 12 | 4/10 ✗ | %9,4 | %20,0 |

Üretim kapasitesi sabitken talebi büyütmek yalnız kıtlığı derinleştiriyor.

### Dünya olayları (madde 30/45)

Spec `world_events`'i docs/03'te tanımlamıştı: süresi ve çarpanları olan bir
ETKİ tablosu. F7'de aynı isimle bir DUYURU akışı kurulmuştu — doğru isim
altında yanlış şey. 0014'te ayrıldılar:

| Tablo | Ne |
|---|---|
| `world_notices` | Oyuncuya görünen duyuru akışı (ED müdahaleleri dahil) |
| `world_events` | Ekonomiye etki eden olay: `demand/supply/cost` çarpanı + süre |

Bir ED müdahalesi duyurudur ama etki değildir (etkisi `npc_directives`te); bir
kuraklık ise hem etkidir hem duyurulur.

**Katalog:** kuraklık · maden kazası · enerji krizi · tedarik aksaması ·
sağlık uyarısı · soğuk dalgası · bayram · bereketli hasat · verimlilik hamlesi ·
şehre göç. Kapsamlar: `PRODUCT` · `SECTOR` · `CITY` · `GLOBAL`.

★ Ağırlığın **yarısından fazlası olumlu** olaylara ayrıldı ve bu bir testle
sabitlendi. Yalnız felaket üreten bir dünya oyuncuya "ne yaparsan yap başına
bir şey gelir" der; oysa amaç fırsat da yaratmaktır.

Etkiler: arz → `productionCapacity.eventMultiplier` · maliyet → işçilik+enerji
gideri (enerji krizinde üretim DURMAZ, pahalılaşır) · talep →
`cityDemand.eventMultiplier`, dünya ölçeğiyle **çarpılarak** (ikisi farklı şey:
biri oyuncu tabanının büyüklüğü, diğeri o anki hava).

Üretim P0'da koşar (docs/05 §P0.2) ve tohumludur: aynı tohum aynı dünyayı
üretir. Zar HER ZAMAN atılır, eleme sonra yapılır — doluluk kontrolünü zardan
önce yapmak RNG dizisini dünyanın durumuna bağlar ve tekrarlanabilirliği bozar.

### Kalibrasyon turları — nereye gelindi

| Yapılandırma | Geçen metrik |
|---|---|
| Başlangıç | 6 / 12 |
| + perakende marjı (R34) + üretim ağırlıklı dünya (R35) | 6 / 12 |
| + Lv2 duvarı 34.000 ₺ (R36 ön adımı) | 7 / 12 |
| **+ talep ×3** | **8 / 12** |

Kalan dört metrik (week1_value, npc_share, supply_demand, volatility) tek bir
sayıdan çıkıyor: **tesis geri ödeme süresi 36 gün**, hedefin gerektirdiği ~4
güne karşı. Ayrıntı ve seçenekler: docs/10 **R36**.

### Önceki engel (R33) — çözüldü

Seviye 1'de bir oyuncu yalnız **domates** ticareti yapabilir; diğer perakende
ürünlerinin kilidi Lv6, Lv8 ve Lv12'de. Tüm yeni oyuncu nüfusu tek bir ürünün
toptan arzı için yarışıyor ve o ürünün üretimi tavanda:

```
domates talebi   62.656 birim / 24 tur
domates üretimi   1.881 birim / 24 tur     ← NPC bahçeleri %100 kullanımda
oyuncu alış emri  877 açıldı · 640 süresi doldu · 55 doldu
Lv2'ye çıkan      2 / 40 oyuncu
```

NPC'ler kıtlığa yatırımla cevap verdi (400 turda 20 tesis) ama sebze bahçesi
kurmadılar: yatırım skoru rekabeti ceza sayıyor ve domateste 5 satıcı varken
fırında 2 vardı. Ekonomik olarak tutarlı, ama sonucu yeni oyuncunun giriş
ürününün kıt kalması.

Seçenekler docs/10 R33'te; **karar bir oyun tasarımı kararıdır** ve kapı
geçilmeden verilmelidir.

---

## F9 — Mobil uygulama · 3 hafta (F2'den itibaren paralel)
- Expo + expo-router, 5 sekme: Ana Sayfa / Şirketim / Piyasa / Şehirler / Menü
- Ana sayfa: nakit, şirket değeri, 24s K/Z, seviye, **tur geri sayımı**,
  kritik stok uyarıları, son olaylar
- Piyasa: ürün fiyatı / nakliye / **toplam maliyet** ayrı gösterim (madde 16)
- Stok: toplam / ortalama kalite / ağırlıklı ortalama maliyet + lot detayı (bottom sheet)
- Tesis kartları, üretim durumu, fiyat belirleme
- Offline rapor ekranı (madde 45)
- WebSocket ile tick sonucu canlı güncelleme
- Uygulama içi bildirim akışı

---

## F10 — Admin panel ve gözlemlenebilirlik · 1,5 hafta
- Next.js admin: config editörü (versiyonlu, audit'li), ürün/tesis/reçete yönetimi
- Ekonomi dashboard: para arzı, CPI, medyan değer, Top1%/medyan, fiyat grafikleri,
  arz/talep, NPC payı, stok derinliği, iflas oranı, tesis ROI, volatilite
- Dünya olayları (world events) oluşturma
- Grafana: tick faz süreleri, kuyruk derinliği, DB bağlantıları
- Push bildirim (Expo Push) + kategori tercihleri

---

## F11 — Genişleme ve ölçek · sürekli
- Kalan 30 ürün, kalan tesisler, seviye 13–30
- Çalışan sistemi (madde 38) → `staff_score`'u besler
- Teknoloji/AR-GE (madde 39) → `technology_bonus`'u besler
- 81 şehre genişleme (`cities.is_active` ile kademeli)
- Sıralamalar, sektör/şehir liderleri
- Partition otomasyonu + rollup job'ları
- Yük testi: 100k şirket ile tick süre bütçesi doğrulaması

---

## Kritik yol

```
F0 → F1 → F2 ★ → F4 → F5 → F6 → F7 → F8 ★
        (F3 ve F9 paralelleştirilebilir)
```

**Toplam kapalı betaya kadar: ~22,5 hafta** (tek geliştirici, F9 paralel).

| Değişiklik | Etki |
|---|---|
| Lojistik transit süresi onaylandı | **+0** — F4'ün 2,5 haftası zaten sevkiyatı içeriyordu |
| Krediler MVP-1'e alındı | **+1,5** kritik yola (yeni F5), **−0,5** F10'dan |
| Döviz ve dış ticaret (S1–S5 karara bağlandı) | **+2,5** (F0 2 gün · F4 +1 hafta · F5 +0,5 hafta · F7 3 gün) |
| Önceki tahmin | 19 hafta → **~22,5 hafta** |

## Faz bağımlılıkları

| Faz | Bağımlı olduğu | Neden |
|---|---|---|
| F2 | F0 (ledger), F1 (lot) | Tick motoru para ve stoğa yazar |
| F3 | F2 | Üretim tick fazıdır |
| F4 | F1 (lot), F2 (tick) | Eşleşme lot rezerve eder |
| F5 | F1, F2, F4 | Kredi limiti şirket değerine bağlı; taksit P4'te tahsil edilir. Döviz dönüşümü dış ticaretten sonra anlamlı |
| F6 | F3, F4 | NPC üretir ve emir verir |
| F7 | F6 | ED, NPC üzerinden çalışır |
| F8 | F7 | Simülasyon tam ekonomiyi koşar |
| F9 | F2 | İlk ekran gerçek tick verisi ister |
| F10 | F0 (config), F7 | Admin gerçek parametreleri düzenler |

NPC'lerin kredi kullanıp kullanmayacağı F6'da kararlaştırılır (öneri: **evet**, `max_debt_ratio` profilde zaten var).
