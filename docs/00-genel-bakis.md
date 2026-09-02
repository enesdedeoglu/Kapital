# Kapital — Genel Bakış ve Teknoloji Kararları

> Bu doküman planlama fazının kök dokümanıdır. Kod yazımı başlamadan önce
> 01–11 arası dokümanlar okunmalı ve onaylanmalıdır.

## 1. Oyunun tek cümlelik tanımı

Türkiye şehirleri üzerinde kurulu, **tek ve ortak** bir ekonomide gerçek oyuncuların
üretim / ticaret / perakende yaptığı, fiyatların merkezi olarak değil **arz-talep ve
oyuncu davranışıyla** oluştuğu, 15 dakikalık turlarla çalışan sunucu-otoriter bir
mobil ekonomi simülasyonu.

## 2. Bu oyunu "idle/tycoon"dan ayıran 4 teknik zorunluluk

| # | Zorunluluk | Sonucu |
|---|---|---|
| 1 | Tek ortak ekonomi | Tüm oyuncular aynı fiyat oluşumunu paylaşır → tick motoru global ve sıralı olmak zorunda |
| 2 | Fiyatı sunucu belirlemiyor | Referans fiyat, gerçekleşen işlemlerin **ağırlıklı medyanı**. Manipülasyon savunması 1. gün gerekiyor |
| 3 | Oyuncu offline'ken ekonomi devam eder | Motor client'tan tamamen bağımsız, worker olarak çalışır |
| 4 | Az oyuncuyla da canlı olmalı | NPC ekonomisi + Economic Director launch-blocker'dır, "sonra ekleriz" denemez |

## 3. Teknoloji kararları

| Katman | Karar | Gerekçe |
|---|---|---|
| Dil | TypeScript 5.x (strict) | İstenen; monorepo'da tip paylaşımı |
| Backend | NestJS 11, **modular monolith** | İstenen; modül sınırları net, erken mikroservis yok |
| DB | PostgreSQL 16 | İstenen; `NUMERIC`, advisory lock, partitioning, `SKIP LOCKED` |
| ORM | **Drizzle ORM** (Prisma değil) | Bkz. ADR-0002. Tick motoru set-based bulk SQL; Drizzle SQL-first |
| Kuyruk | BullMQ + Redis 7 | İstenen; tick fan-out, retry, rate limit |
| Realtime | Socket.IO (NestJS gateway) | Tick sonucu push, piyasa fiyat akışı |
| Mobil | React Native + Expo SDK 54 + TS | İstenen |
| Mobil state | TanStack Query + Zustand | Sunucu-otoriter; cache invalidation tick'e bağlanır |
| Admin | Next.js 15 (App Router) + shadcn/ui | Web; ayrı deploy, ayrı auth |
| Test | Vitest (unit) + Testcontainers (integration) | Ekonomi testleri gerçek PG ister |
| Gözlemlenebilirlik | OpenTelemetry + Prometheus + Grafana | Tick süre bütçesi ölçülebilir olmalı |

### 3.1 Reddedilen alternatifler
- **Prisma**: Tick motorunun sıcak yolu `UPDATE ... FROM (VALUES ...)` ve CTE'dir.
  Prisma'da bunların %80'i `$queryRaw` olarak yazılacaktı → Prisma'nın faydası kayboluyor.
- **Erken mikroservis**: Ekonomi turu atomik bir birim. Servis sınırına bölmek
  distributed transaction demek. Modüler monolit + shard'lı worker doğru cevap.
- **MongoDB / NoSQL**: Para ve stok tutarlılığı ACID ister. Tartışmaya kapalı.

## 4. Para ve miktar gösterimi (kritik karar)

Kayan nokta **hiçbir yerde** para veya stok tutmaz.

| Kavram | DB tipi | Ölçek | TS tipi |
|---|---|---|---|
| Para (nakit, fiyat, ciro, borç) | `BIGINT` | 1 ₺ = **10.000** birim (scale 4) | `Money = bigint` (branded) |
| Döviz bakiyesi | `BIGINT` | 1 $ = **10.000** birim (scale 4) | `Money = bigint` + `currency_t` |
| Miktar (kg, L, adet, m) | `BIGINT` | 1 birim = **1.000** (scale 3) | `Qty = bigint` (branded) |
| Kalite | `NUMERIC(6,3)` | 0.000 – 100.000 | `string` → `Decimal` |
| Katsayı (hassasiyet, indeks) | `DOUBLE PRECISION` | — | `number` |
| Toplu raporlama toplamı | `NUMERIC(38,4)` | — | `string` |

**Sınır kuralı:** Katsayılar `number` olarak çarpılır, **para sınırına bir kez**
gelindiğinde `roundToMoney()` ile tam sayıya yuvarlanır ve yuvarlama artığı
`ledger_entries.rounding_residue` alanında saklanır. Bu sayede para arzı toplamı
her tick sonunda **tam olarak** doğrulanabilir.

**Para birimi:** Yurt içi ekonominin tamamı ₺'dir. USD yalnızca üç yerde görünür —
cüzdan (`companies.usd_balance`), kur işlemi (`fx_trades`) ve dış ticaret. Yurt içi
fiyatlamaya sızmaması zorunludur; ayrıntı ve gerekçe: `12-doviz-mekanigi.md`.

Taşma kontrolü: `BIGINT` max ≈ 9,22×10¹⁸ → 922 trilyon ₺. Kaçak enflasyon senaryosunda
bile 30 dakikada bir çalışan `money_supply_guard` job'ı alarm üretir.

## 5. Oyun takvimi

| Birim | Değer |
|---|---|
| 1 ekonomik tur (tick) | 15 gerçek dakika |
| 1 gün | 96 tick |
| 1 oyun mevsimi | 672 tick = 7 gerçek gün |
| 1 oyun yılı | 2688 tick = 28 gerçek gün |

Mevsim çarpanı (`seasonMultiplier`) tarım üretimi ve bazı ürünlerin talebini etkiler.
Tick sıra numarası (`tick.seq`) tek gerçek zaman kaynağıdır; `NOW()` iş mantığında kullanılmaz.

## 6. Doküman haritası

| Dosya | İçerik | İstek maddesi |
|---|---|---|
| `01-klasor-yapisi.md` | Monorepo yapısı | 59.1 |
| `02-domain-modeli.md` | Bounded context'ler, agregatlar, değişmezler | 59.2 |
| `03-veritabani-semasi.md` | ER + DDL | 59.3 |
| `04-tablo-iliskileri.md` | İlişki ve kardinalite açıklamaları | 59.4 |
| `05-economic-tick.md` | Tick faz mimarisi, idempotency, sharding | 59.5 |
| `06-transaction-locking.md` | Kilit sırası, izolasyon, çift harcama savunması | 59.6 |
| `07-npc-ve-economic-director.md` | İki sistemin sınırları | 59.7 |
| `08-mvp-kapsami.md` | MVP-0 / MVP-1 kesin kapsam | 59.8 |
| `09-roadmap.md` | 10 fazlı yol haritası | 59.9 |
| `10-riskler.md` | Riskli teknik noktalar + azaltım | 59.10 |
| `11-kapsam-degisiklikleri.md` | **Eklenecek / çıkarılacak / değiştirilecek** | ek |
| `12-doviz-mekanigi.md` | Döviz tasarım çerçevesi ve güvenli sınırları | ek |
| `adr/` | Mimari karar kayıtları | ek |
