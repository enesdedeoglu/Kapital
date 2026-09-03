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

## F6 — NPC ekonomisi · 2 hafta
- `npc_profiles`, 8 arketip, ±%15 parametre dağılımı
- P6 fazı NPC bölümü: operasyonel (her tick) + stratejik (N tick)
- NPC fiyat algoritması (±%3 bant + acil bant)
- NPC stok yönetimi (min 4 / hedef 12 / max 24 tur)
- NPC yatırım skoru → inşaat kararı
- NPC-NPC agregasyonu (madde 54 optimizasyonu)
- 60 NPC / 150 tesis dünya tohumlama

**Çıkış:** Oyuncusuz bir dünyada ekonomi 500 tick boyunca kendi kendine sağlıklı koşuyor.

---

## F7 — Economic Director · 1,5 hafta
- `market_health` skorlaması (7 bileşen)
- ED karar motoru + histerezis + 5 direktif kaldıracı
- `npc_directives` yayını ve NPC tarafında tüketimi
- `SYS_RESERVE` acil rezerv akışı
- NPC payının oyuncu arzına göre kademeli geri çekilmesi (madde 31)
- `economy_snapshots`: para arzı, Game CPI, Gini
- **Kur modeli** (`fx_rates`): PPP çıpası + ticaret dengesi baskısı, tur ±%0,5 / gün ±%3
- **`IMPORT_QUOTA`** altıncı kaldıraç; müdahale sıralaması: önce ithalat, sonra `SYS_RESERVE`

**Çıkış:** Bir ürünün üretimi kasıtlı durdurulduğunda ekonomi kendini toparlıyor —
önce ithalat kapısı açılarak, ancak o yetmezse rezervle.

---

## F8 ★ — Simülasyon ve denge · 2 hafta
- `packages/sim`: headless harness, 1000 şirket × 90 gün (≈8.640 tick)
- 8 oyuncu davranış profili (agresif tüccar, pasif, ucuzcu, kaliteci, üretici,
  perakendeci, dikey entegre, spekülatör)
- Metrik raporu: money supply, CPI, medyan şirket değeri, Top1%/medyan,
  volatilite, S/D oranı, stok derinliği, NPC payı, tesis ROI, iflas oranı
- Parametre tarama (parameter sweep) ile denge ayarı

### ★ GEÇİŞ KAPISI 2 — Ekonomi hedefleri
`08-mvp-kapsami.md` sonundaki 8 metrik eşiği tutmalı. **Tutmadan beta açılmaz.**

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
