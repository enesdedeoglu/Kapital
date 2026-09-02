# Kapital

Türkiye şehirleri üzerinde kurulu, tek ve ortak bir ekonomide gerçek oyuncuların
üretim, ticaret, perakende ve yatırım yaptığı **mobil ekonomi simülasyonu**.

Fiyatlar merkezi olarak belirlenmez; arz-talep, üretim maliyeti, kalite, lojistik ve
oyuncu davranışıyla oluşur. Ekonomi **15 dakikalık turlarla**, oyuncu çevrimdışıyken
de çalışır.

> **Durum: F0 (Temel altyapı) tamamlandı.** Sıradaki faz: F1 — Dünya ve şirket.
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
pnpm test                    # 46 test
pnpm api:dev                 # http://localhost:3000
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

## Yapı

```
apps/api          NestJS — auth, şirket, sağlık, idempotency
packages/shared   Money/Qty tipleri, hata sınıfları, tur takvimi, seed'li RNG
packages/db       Şema, elle yazılan migration'lar, seed, DEFTER ve transfer()
packages/config    Versiyonlu denge config'i
docs/             Teknik plan (13 doküman + 7 ADR)
```

Planlanan ama henüz yazılmamış paketler: `packages/economy` (saf ekonomi çekirdeği,
F2), `packages/sim` (denge simülasyonu, F8), `apps/worker` (tick motoru, F2),
`apps/mobile` (F9), `apps/admin` (F10).

## F0'da ne var

| Alan | Durum |
|---|---|
| Monorepo, turbo, TS strict, CI | ✅ |
| PostgreSQL şeması — 22 tablo, partition'lı defter | ✅ |
| Migration hattı + checksum koruması + ayrışma bekçisi | ✅ |
| Seed: şehir, ürün, reçete, tesis, kredi şartları, seviyeler, config | ✅ |
| `Money`/`Qty` — kayan nokta yok, tek yuvarlama noktası | ✅ |
| **Çift taraflı defter + `transfer()`** — paranın tek geçiş noktası | ✅ |
| Değişmez denetimi I1, I2, R5 | ✅ |
| Auth: kayıt, giriş, refresh rotasyonu, scrypt | ✅ |
| Idempotency: anahtar çalıştırmadan önce rezerve edilir | ✅ |
| Şirket kurma — başlangıç sermayesi deftere yazılır | ✅ |

### Doğrulanmış çıkış kriterleri

| Test | Ne kanıtlıyor |
|---|---|
| **T1** | 100 eşzamanlı harcama, nakit 50'ye yetiyor → tam 50 başarılı, negatif bakiye yok |
| **T3** | Aynı `txId` 3 kez (ve 20 eşzamanlı) → tek etki |
| **T4** | A→B / B→A 120 çapraz transfer → **0 deadlock** |
| **T5** | Aynı `Idempotency-Key` ile 5 istek → tek şirket, tek sermaye aktarımı |
| **T6** | 200 rastgele transfer sonrası `Σ bakiye = defter` ve global toplam **0** |
| Ayrışma | Drizzle şemasındaki her tablo/kolon veritabanında mevcut |

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

### Mimari Karar Kayıtları
[0001 Para gösterimi](docs/adr/0001-para-gosterimi.md) ·
[0002 Drizzle](docs/adr/0002-orm-secimi.md) ·
[0003 Saf ekonomi çekirdeği](docs/adr/0003-saf-ekonomi-cekirdegi.md) ·
[0004 ED/NPC ayrımı](docs/adr/0004-ed-npc-ayrimi.md) ·
[0005 Tick sharding](docs/adr/0005-tick-sharding.md) ·
[0006 Elle yazılan migration'lar](docs/adr/0006-elle-yazilan-migrationlar.md) ·
[0007 Açık DI token'ları](docs/adr/0007-acik-di-tokenlari.md)

## Altın kurallar

1. **Para asla kayan nokta değildir.** `Money = bigint`, 1 ₺ = 10.000.
2. **`companies.cash` yalnız `transfer()` içinde değişir.** Başka hiçbir yerde.
3. **Zaman `NOW()` değil, `tick.seq`'tir.**
4. **Denge değerleri koda gömülmez** — `game_configs` ve seed tablolarından okunur.
5. **Constructor bağımlılıkları açık `@Inject()` ile verilir** (ADR-0007).
6. **Uygulanmış migration düzenlenmez** — yeni dosya eklenir.
