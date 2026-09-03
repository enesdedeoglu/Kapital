# Kapital

Türkiye şehirleri üzerinde kurulu, tek ve ortak bir ekonomide gerçek oyuncuların
üretim, ticaret, perakende ve yatırım yaptığı **mobil ekonomi simülasyonu**.

Fiyatlar merkezi olarak belirlenmez; arz-talep, üretim maliyeti, kalite, lojistik ve
oyuncu davranışıyla oluşur. Ekonomi **15 dakikalık turlarla**, oyuncu çevrimdışıyken
de çalışır.

> **Durum: F0–F7 tamamlandı, F8 sürüyor.** MVP-0, üretim zinciri, toptan piyasa,
> lojistik, dış ticaret, bankacılık, NPC ekonomisi ve Ekonomi Direktörü
> çalışıyor. F8'in simülasyon altyapısı kuruldu ve beş ciddi kusur ortaya
> çıkardı; **denge kapısı henüz geçilmedi** — kalan iş oyun dengesi
> kalibrasyonu (docs/10 R32–R33).
> Yol haritası: [docs/09-roadmap.md](docs/09-roadmap.md)

## Hızlı başlangıç

```bash
nvm use                      # .nvmrc → Node 22
pnpm install
cp .env.example .env         # DATABASE_URL ve TEST_DATABASE_URL'i doldurun
```

Veritabanı — iki seçenekten biri:

```bash
pnpm db:up                   # A) Docker: postgres:16 (5433) + redis:7 (6380)
createdb kapital_dev && createdb kapital_test   # B) Yerel PostgreSQL 16 (5432)
```

```bash
pnpm build
pnpm db:migrate              # şemayı uygular
pnpm db:seed                 # 5 şehir · 10 ürün · 13 tesis · 9 reçete · 7 sistem şirketi
pnpm test                    # 253 test
pnpm api:dev                 # http://localhost:3000
pnpm worker:dev              # ekonomik tur zamanlayıcısı (15 dk)
pnpm tick                    # tek bir turu elle koş
```

### Uçtan uca deneme

```bash
curl -s localhost:3000/health
```

```bash
curl -s -X POST localhost:3000/auth/register -H 'content-type: application/json' -d '{"email":"oyuncu@kapital.test","password":"guclu-parola-123","displayName":"Oyuncu"}'
```

```bash
curl -s -X POST localhost:3000/company -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -H "idempotency-key: $(uuidgen)" -d '{"name":"Anadolu Ticaret","cityCode":"IST","facilityTypeCode":"GREENGROCER"}'
```

```bash
curl -s -X POST localhost:3000/facilities -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -H "idempotency-key: $(uuidgen)" -d '{"facilityTypeCode":"GREENGROCER","cityCode":"IST","name":"Kadıköy Manav"}'
```

## Yapı

```
apps/api          NestJS — auth, dünya, şirket, tesis, envanter, piyasa, perakende
apps/worker       Tur zamanlayıcısı ve catch-up politikası
packages/shared   Money/Qty tipleri, hata sınıfları, tur takvimi, seed'li RNG
packages/db       Şema, migration'lar, seed, DEFTER + transfer(), FEFO lot servisi
packages/economy  ★ SAF ekonomi çekirdeği — I/O yok, deterministik
packages/engine   Tur motoru: fazlar, orchestrator, lider kilidi
packages/config   Versiyonlu denge config'i
docs/             Teknik plan (13 doküman + 7 ADR)
```

Planlanan ama henüz yazılmamış: `packages/sim` (denge simülasyonu, F8),
`apps/mobile` (F9), `apps/admin` (F10).

## Ne çalışıyor

### F0 — Temel altyapı

| Alan | Durum |
|---|---|
| Monorepo, turbo, TS strict, CI | ✅ |
| PostgreSQL şeması — 34 tablo, partition'lı defter | ✅ |
| Migration hattı + checksum koruması + ayrışma bekçisi | ✅ |
| Seed: şehir, ürün, reçete, tesis, kredi şartları, seviyeler, config | ✅ |
| `Money`/`Qty` — kayan nokta yok, tek yuvarlama noktası | ✅ |
| **Çift taraflı defter + `transfer()`** — paranın tek geçiş noktası | ✅ |
| Değişmez denetimi I1, I2, R5 | ✅ |
| Auth: kayıt, giriş, refresh rotasyonu, scrypt | ✅ |
| Idempotency: anahtar çalıştırmadan önce rezerve edilir | ✅ |
| Şirket kurma — başlangıç sermayesi deftere yazılır | ✅ |

### F1 — Dünya ve şirket

| Alan | Durum |
|---|---|
| Dünya uçları: şehirler, mesafeler, ürünler, tesis türleri | ✅ |
| Tesis kurma — arsa endeksiyle maliyet, inşaat süresi, `CAPEX` defteri | ✅ |
| Seviye kilidi ve liman şartı | ✅ |
| Envanter tesisle birlikte otomatik oluşur (trigger) | ✅ |
| **Lot bazlı stok** — aynı ürünün farklı kalite/maliyetteki partileri ayrı | ✅ |
| **FEFO tüketim** — önce bozulacak önce çıkar, `SKIP LOCKED` ile paralel | ✅ |
| Rezervasyon yaşam döngüsü: rezerve → kesinleştir / bırak | ✅ |
| Depo kapasitesi trigger + `CHECK` ile garanti (I4) | ✅ |
| Türetilmiş stok görünümü: toplam, ort. kalite, ağırlıklı maliyet | ✅ |

### F2 — Tur motoru ve perakende (MVP-0)

| Alan | Durum |
|---|---|
| **Saf ekonomi çekirdeği** — talep, çekicilik, pazar payı, medyan, bozulma | ✅ |
| Tur motoru: 5 faz, durum makinesi, süre bütçeleri | ✅ |
| Lider kilidi (PostgreSQL danışma kilidi) — çok kopya güvenli | ✅ |
| Deterministik RNG + config anlık görüntüsü | ✅ |
| **Perakende satışı** — paranın oyuna tek giriş noktası | ✅ |
| **R10 azaltımı**: talep bütçe tavanı + rezervasyon fiyatı | ✅ |
| **R1 azaltımı**: sabit 3 turlu yeniden dağıtım | ✅ |
| **R2 azaltımı**: bir önceki turun EMA'sı + %15 devre kesici | ✅ |
| Stok bozulması, raf ömrü, bakım gideri, kademeli ceza | ✅ |
| Referans fiyat: kırpılmış ağırlıklı medyan + EMA | ✅ |
| NPC satıcılar (sabit arz) ve toptan alım | ✅ |
| Şirket/tesis finansalları, şirket değeri, ekonomi fotoğrafı | ✅ |
| Zamanlayıcı + catch-up politikası | ✅ |

### F3 — Tesisler ve üretim

| Alan | Durum |
|---|---|
| **Ürün grafı DAG doğrulaması** (I8/R13) — seed ve CI'da koşar | ✅ |
| P1 üretim fazı: tarla, maden, fabrika **tek kod yolu** | ✅ |
| Üretim kalitesi formülü (madde 14) ve kapasite formülü (madde 12) | ✅ |
| Çok girdili reçeteler ve minimum kalite filtresi | ✅ |
| Çok turlu üretim döngüleri (`production_jobs`) | ✅ |
| Tesis yükseltme — `taban × 0,75 × seviye^1,55` | ✅ |
| `condition` aşınması ve kritik seviyede duruş | ✅ |
| Kendi tesisleri arası stok taşıma (aynı şehir) | ✅ |
| Üretim durumu ve duruş nedeni raporu | ✅ |

### F4 — Piyasa, lojistik ve dış ticaret

| Alan | Durum |
|---|---|
| Emir defteri: BUY/SELL, kısmi doldurma, iptal, süre dolumu | ✅ |
| P2 eşleştirme fazı — ürün başına shard, danışma kilidi | ✅ |
| **Nakliye dahil tavan fiyat** (madde 16, C2) — uzak satıcı kendiliğinden elenir | ✅ |
| **Sevkiyat: mesafe = maliyet + SÜRE** (A3) — yoldaki mal hiçbir envanterde değil | ✅ |
| Kırpılmış ağırlıklı medyan + EMA + %15 devre kesici | ✅ |
| **Wash-trade tespiti** — işlem iptal edilmez, endeksten çıkarılır | ✅ |
| **Likidite iskontosu** (C3) — piyasayı stoklayarak şirket değeri şişirilemez | ✅ |
| **Kur modeli** — PPP çıpası + ticaret dengesi, oyuncu belirleyemez | ✅ |
| **Dış ticaret** — Liman, dünya fiyatı, derinlik tavanı, %60 band | ✅ |
| ₺ ↔ $ dönüşümü — %1,5 spread, iki defter ayrı ayrı dengeli | ✅ |

### F5 — Bankacılık ve kredi

| Alan | Durum |
|---|---|
| `SYS_BANK` — kredi anaparası para **yaratır**, geri ödeme **yok eder** | ✅ |
| Kredi limiti şirket değerine bağlı, kaldıraç seviyeye göre (0,40 / 0,60 / 0,75) | ✅ |
| Anüite taksit; faiz `SYS_SINK`'e, anapara `SYS_BANK`'a **ayrı** gider | ✅ |
| **Faiz enflasyona bağlı** — para arzı şişerse borçlanma pahalılaşır (R15) | ✅ |
| Şirket değerinden **borç düşülür** — kredi çekmek değeri artırmaz | ✅ |
| **Kademeli temerrüt** (R16): kaçırılan taksit → uyarı → tek tesis tasfiyesi | ✅ |
| İflas yalnız tasfiye edilecek tesis kalmayınca | ✅ |
| Ödeme yükü uyarısı — "bu kredi gelirinizin %X'ini götürür" | ✅ |
| Kredinin para arzı içindeki payı izlenir, %20'de alarm | ✅ |
| Erken kapatma ve taksit geçmişi | ✅ |

### F6 — NPC ekonomisi

| Alan | Durum |
|---|---|
| 8 arketip, ±%15 parametre dağılımı (`npc_profiles`) | ✅ |
| P6 fazı: operasyonel karar her tur, stratejik karar N turda bir | ✅ |
| Fiyat: ±%3 bant, sağlık < 35 ve sapma > %25 ise acil ±%10 bant (R4) | ✅ |
| Stok planı: min 4 / hedef 12 / max 24 tur | ✅ |
| **Alış teklifi navlun payı içerir** (R20) — yoksa zincir şehirler arası kopar | ✅ |
| **Üretim kısma** (R21) — satılmayan stok birikince kapasite kademeli düşer | ✅ |
| Ürün grafı tohuma karşı doğrulanır (R23); mobilya zinciri kapatıldı | ✅ |
| Tohum fiyatları tariflerle tutarlı, marj bandı 1,15–1,75 test edilir (R22) | ✅ |
| 60 NPC / 75 tesis dünya tohumlama (`pnpm --filter @kapital/db seed:npc`) | ✅ |
| Başsız N-tur koşu aracı (`run-ticks.ts`) | ✅ |
| NPC stratejik yatırım kararı → tesis inşası | ⏭ F7 |

**500 turluk oyuncusuz koşu:** tur ort 1.202 ms / p95 1.394 ms (bütçe 37.000 ms) ·
para arzı +%1,1 · **Game CPI 1,000 → 1,029** (tepe 1,033, sonra geri — dar bantta
salınım) · **0 iflas** / 65 NPC · **10/10** ürün işlem görüyor.

```bash
pnpm --filter @kapital/engine exec tsx src/cli/run-ticks.ts 500 50
```

### F7 — Ekonomi Direktörü

ED ekonomiyi **yönetmez, sınırlarını korur** (ADR-0004). Fiyat belirleyemez,
emir veremez, şirket nakdine dokunamaz. Elinde yalnız altı kaldıraç var ve
hepsi NPC davranışına dokunur.

| Alan | Durum |
|---|---|
| Market Health Score — 6 bileşen, ağırlıklar config'ten | ✅ |
| Müdahale bantları + **6 tur histerezis** (EMERGENCY'ye düşüş beklemez) | ✅ |
| Kaldıraçların **yönü arz/talep oranından** gelir — bolluk varken kısar (R24) | ✅ |
| Geçersiz kalan direktifler anında iptal edilir — tutarlı duruş (R25) | ✅ |
| İthal edilemeyen üründe boş kaldıraç yayınlanmaz, durum olduğu gibi duyurulur | ✅ |
| `SYS_RESERVE` son çare: 12 tur EMERGENCY + sıfır üretim, referansın 1,75 katı | ✅ |
| NPC payının oyuncu arzına göre kademeli geri çekilmesi (madde 31) | ✅ |
| NPC stratejik yatırımı — inşa halindeki kapasiteyi görür (R28) | ✅ |
| `world_events` — her müdahale görünür duyuru | ✅ |
| Gini katsayısı `economy_snapshots`'ta | ✅ |

**ED aktifken 500 turluk koşu** F6 ile aynı: para arzı +%1,1 · CPI 1,028 ·
0 iflas · 10/10 ürün. ED'nin maliyeti tur başına ~60 ms (%5).

**Arz şoku (domates, 60 tur):** 83,4 HEALTHY → 55,0 ADJUST → onarımdan sonra
70,0 WATCH ve satışlar şok öncesinin üstünde (1.383 → 2.089 birim).

```bash
# Arz şoku senaryosu: ısınma → üretimi durdur + stoğu imha et → gözle → onar
pnpm --filter @kapital/engine exec tsx src/cli/scenario-shock.ts TOMATO 40 60 60
```

### F8 — Simülasyon ve denge kapısı 🔨

| Alan | Durum |
|---|---|
| `apps/sim` — başsız simülasyon, 8 oyuncu davranış profili | ✅ |
| **Gerçek servis yollarını kullanır** — kural kopyalanmaz | ✅ |
| 12 metriklik geçiş kapısı raporu (madde 56) | ✅ |
| Parametre tarama (`sweep.ts`) | ✅ |
| **Denge kapısı geçildi mi** | ❌ henüz |

Simüle edilen oyuncu, gerçek oyuncunun geçtiği kod yolundan geçer
(`@kapital/api/services`): aynı doğrulamalar, aynı seviye kilitleri, aynı nakit
kontrolleri. Simülasyon yalnız kararı verir, kuralı değil.

**Bulup düzelttikleri:** seviye merdiveni kilitliydi ve ilerleme hiç
uygulanmamıştı (R30) · aynı depoya çoklu sevkiyat tüm turu düşürüyordu (R31) ·
oyuncu teklifi referansın altındaydı, hiç mal alamıyordu · oyuncu rafı
piyasanın %37 üstündeydi, hiç satamıyordu.

```bash
pnpm --filter @kapital/sim exec tsx src/cli/run-sim.ts 60 700 350
pnpm --filter @kapital/sim exec tsx src/cli/sweep.ts economy.demandScale '{...}' '{...}' -- 40 400
```

### Doğrulanmış çıkış kriterleri

| Test | Ne kanıtlıyor |
|---|---|
| **T1** | 100 eşzamanlı harcama, nakit 50'ye yetiyor → tam 50 başarılı, negatif bakiye yok |
| **T3** | Aynı `txId` 3 kez (ve 20 eşzamanlı) → tek etki |
| **T4** | A→B / B→A 120 çapraz transfer → **0 deadlock** |
| **T5** | Aynı `Idempotency-Key` ile 5 istek → tek şirket, tek sermaye aktarımı |
| **T6** | 200 rastgele transfer sonrası `Σ bakiye = defter` ve global toplam **0** |
| **T2** | Tek lota 30 eşzamanlı talep → toplam ayrılan lot miktarını **aşmıyor** |
| I3 | `reserved_quantity` hiçbir zaman `quantity`'yi aşmıyor |
| I4 | Depo kapasitesi aşılamıyor — DB kısıtı reddediyor |
| Ayrışma | Drizzle şemasındaki her tablo/kolon veritabanında mevcut |

### ★ Geçiş Kapısı 1 — MVP-0 kabul testi

```
Şirket kur → Manav aç → Domates al → Fiyat koy → Tur koş
→ NPC tüketici alsın → Para artsın → Kâr raporunu gör
```

Uçtan uca geçiyor. Canlı ölçüm: 15 ₺'ye alınan 200 kg domates, 22 ₺ raf fiyatıyla
tur başına ~38 kg satıldı (~836 ₺ ciro), stok 6 turda tükendi, nakit
14.880 → 18.560 ₺. Tur süresi ~110 ms.

Ayrıca doğrulandı:
- **Tur idempotency**: aynı tur iki kez koşturulduğunda bakiye ve satış satırları değişmiyor
- **R10**: rakipsiz mağaza referansın 100 katına fiyat koyunca **hiçbir şey satamıyor**
- **R10**: gelir hiçbir koşulda şehir bütçe tavanını aşamıyor
- 20 turluk kesintisiz koşuda değişmezler bozulmuyor
- Δ para arzı = perakende geliri − sistem giderleri (tam eşitlik)

### ★ F3 çıkış kriteri — dikey zincir

`Buğday Tarlası → Değirmen → Fırın → Manav`, hepsi Konya'da, hiçbir şey
piyasadan satın alınmadan. Canlı ölçüm:

| Adım | Miktar | Kalite | Birim maliyet |
|---|---|---|---|
| Buğday (tarla) | 323 kg | %69,5 | 3,00 ₺ |
| Un (değirmen) | 20,8 kg | %59,5 | 6,33 ₺ |
| Ekmek (fırın) | 37,8 adet | %52,0 | 5,66 ₺ |

Kalitenin zincir boyunca düşmesi madde 14'ün 0,70 katsayısının doğal sonucudur
ve tasarım gereğidir — telafisi teknoloji ve çalışan sistemleridir (F11).
Bu yapısal etki [R19](docs/10-riskler.md) olarak kaydedildi.

## Dokümantasyon

| # | Doküman | İçerik |
|---|---|---|
| 00 | [Genel Bakış](docs/00-genel-bakis.md) | Teknoloji kararları, para gösterimi, oyun takvimi |
| 01 | [Klasör Yapısı](docs/01-klasor-yapisi.md) | Monorepo düzeni |
| 02 | [Domain Modeli](docs/02-domain-modeli.md) | Bounded context, agregat, değişmezler |
| 03 | [Veritabanı Şeması](docs/03-veritabani-semasi.md) | Tam DDL, partitioning |
| 04 | [Tablo İlişkileri](docs/04-tablo-iliskileri.md) | ER açıklamaları |
| 05 | [Economic Tick](docs/05-economic-tick.md) | 8 faz, idempotency, sharding |
| 06 | [Transaction & Locking](docs/06-transaction-locking.md) | Kilit protokolü, çift harcama savunması |
| 07 | [NPC & Economic Director](docs/07-npc-ve-economic-director.md) | Sistem sınırları |
| 08 | [MVP Kapsamı](docs/08-mvp-kapsami.md) | MVP-0 / MVP-1 |
| 09 | [Yol Haritası](docs/09-roadmap.md) | 11 faz |
| 10 | [Riskler](docs/10-riskler.md) | 18 teknik risk + azaltım |
| 11 | [Kapsam Kararları](docs/11-kapsam-degisiklikleri.md) | Eklenen / çıkarılan |
| 12 | [Döviz ve Dış Ticaret](docs/12-doviz-mekanigi.md) | Spesifikasyon |

## API uçları

| Uç | Açıklama |
|---|---|
| `GET /health` · `/health/invariants` | Sağlık ve değişmez denetimi (açık) |
| `POST /auth/register` · `/login` · `/refresh` · `/logout` | Oturum |
| `GET /cities` · `/cities/:code/distances` | Şehirler, mesafe ve transit süresi (açık) |
| `GET /products` · `/facility-types` | Ürün ve tesis kataloğu (açık) |
| `GET` · `POST /company` | Şirket |
| `GET` · `POST /facilities` | Tesisler |
| `GET /facilities/:id/stock` | Türetilmiş stok özeti |
| `GET /facilities/:id/batches` | Lot detayı |
| `GET /inventory` | Tüm tesislerin birleşik stoğu |
| `POST /inventory/transfer` | Kendi tesisleri arası stok taşıma |
| `GET /facilities/:id/production` | Kapasite, reçete, duruş nedeni |
| `POST /facilities/:id/recipe` · `/upgrade` | Reçete seçimi ve yükseltme |
| `GET /market/:cityCode` | Şehirdeki satış emirleri |
| `POST /market/buy` | Toptan alım (anında doldurma) |
| `GET` · `PUT /retail/:facilityId/prices` | Raf fiyatları ve tüketici tavanı |
| `GET /market/book/:product` | Emir defteri — fiyat / nakliye / toplam ayrı |
| `GET` · `POST /market/orders` · `DELETE /market/orders/:id` | Emir yönetimi |
| `GET /market/shipments` | Yoldaki mal ve varış turu |
| `GET /foreign/capacity` | Dünya fiyatları ve kalan derinlik |
| `POST /foreign/import` · `/export` · `/fx/convert` | Dış ticaret ve döviz |
| `GET` · `POST /loans` · `POST /loans/:id/repay` | Kredi limiti, kullanım ve erken kapatma |
| `POST /admin/tick` · `GET /admin/economy` | Tur tetikleme ve ekonomi dashboard'u |

### Mimari Karar Kayıtları
[0001 Para gösterimi](docs/adr/0001-para-gosterimi.md) ·
[0002 Drizzle](docs/adr/0002-orm-secimi.md) ·
[0003 Saf ekonomi çekirdeği](docs/adr/0003-saf-ekonomi-cekirdegi.md) ·
[0004 ED/NPC ayrımı](docs/adr/0004-ed-npc-ayrimi.md) ·
[0005 Tick sharding](docs/adr/0005-tick-sharding.md) ·
[0006 Elle yazılan migration'lar](docs/adr/0006-elle-yazilan-migrationlar.md) ·
[0007 Açık DI token'ları](docs/adr/0007-acik-di-tokenlari.md) ·
[0008 Tur orchestrator kilidi](docs/adr/0008-tick-orchestrator-kilidi.md) ·
[0009 Escrow yerine eşleşme anında doğrulama](docs/adr/0009-escrow-yerine-eslesme-aninda-dogrulama.md)

## Altın kurallar

1. **Para asla kayan nokta değildir.** `Money = bigint`, 1 ₺ = 10.000.
2. **`companies.cash` yalnız `transfer()` içinde değişir.** Başka hiçbir yerde.
3. **Zaman `NOW()` değil, `tick.seq`'tir.**
4. **Denge değerleri koda gömülmez** — `game_configs` ve seed tablolarından okunur.
5. **Constructor bağımlılıkları açık `@Inject()` ile verilir** (ADR-0007).
6. **Uygulanmış migration düzenlenmez** — yeni dosya eklenir.
