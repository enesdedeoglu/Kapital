# Kapital

Türkiye şehirleri üzerinde kurulu, tek ve ortak bir ekonomide gerçek oyuncuların
üretim, ticaret, perakende ve yatırım yaptığı **mobil ekonomi simülasyonu**.

Fiyatlar merkezi olarak belirlenmez; arz-talep, üretim maliyeti, kalite, lojistik ve
oyuncu davranışıyla oluşur. Ekonomi **15 dakikalık turlarla**, oyuncu çevrimdışıyken
de çalışır.

> **Durum: F0–F3 tamamlandı.** MVP-0 çalışıyor ve dikey üretim zinciri kuruldu.
> Sıradaki faz: F4 — Piyasa, lojistik ve dış ticaret.
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
pnpm test                    # 154 test
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
| `POST /admin/tick` · `GET /admin/economy` | Tur tetikleme ve ekonomi dashboard'u |

### Mimari Karar Kayıtları
[0001 Para gösterimi](docs/adr/0001-para-gosterimi.md) ·
[0002 Drizzle](docs/adr/0002-orm-secimi.md) ·
[0003 Saf ekonomi çekirdeği](docs/adr/0003-saf-ekonomi-cekirdegi.md) ·
[0004 ED/NPC ayrımı](docs/adr/0004-ed-npc-ayrimi.md) ·
[0005 Tick sharding](docs/adr/0005-tick-sharding.md) ·
[0006 Elle yazılan migration'lar](docs/adr/0006-elle-yazilan-migrationlar.md) ·
[0007 Açık DI token'ları](docs/adr/0007-acik-di-tokenlari.md) ·
[0008 Tur orchestrator kilidi](docs/adr/0008-tick-orchestrator-kilidi.md)

## Altın kurallar

1. **Para asla kayan nokta değildir.** `Money = bigint`, 1 ₺ = 10.000.
2. **`companies.cash` yalnız `transfer()` içinde değişir.** Başka hiçbir yerde.
3. **Zaman `NOW()` değil, `tick.seq`'tir.**
4. **Denge değerleri koda gömülmez** — `game_configs` ve seed tablolarından okunur.
5. **Constructor bağımlılıkları açık `@Inject()` ile verilir** (ADR-0007).
6. **Uygulanmış migration düzenlenmez** — yeni dosya eklenir.
