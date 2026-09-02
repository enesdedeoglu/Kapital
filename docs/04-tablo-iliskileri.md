# 04 — Ana Tabloların İlişkileri

## 1. ER özeti (metin diyagramı)

```
users ─1:1─ companies ─┬─1:N─ facilities ─1:1─ inventories ─1:N─ inventory_batches
                       │                   │
                       │                   ├─1:N─ retail_offers
                       │                   ├─0:1─ production_jobs
                       │                   └─1:N─ facility_financials (tick başına)
                       │
                       ├─1:N─ market_orders ──┐
                       ├─1:N─ ledger_entries  │  N:M eşleşme
                       ├─1:N─ loans           ├─> market_trades ─1:1─ shipments
                       ├─1:N─ notifications   │
                       ├─1:1─ npc_profiles    │  (yalnız kind='NPC')
                       ├─1:1─ company_stats   │
                       └─1:N─ company_financials (tick başına)

cities ─1:N─ facilities,  market_orders,  city_demand
cities ─N:M─ cities  (city_distances)

products ─1:N─ market_orders, inventory_batches, retail_offers, price_history,
               market_health, city_demand
products ─1:N─ production_recipes(output) ─1:N─ recipe_inputs ─N:1─ products(input)
        ↑                                                              │
        └──────────────── ürün grafı (DAG) ────────────────────────────┘

facility_types ─1:N─ facilities,  production_recipes

economic_ticks ─1:N─ tick_phase_runs
economic_ticks ─1:N─ (tick_id ile) market_trades, retail_sales, price_history,
                     ledger_entries, company_financials, market_health,
                     city_demand, rankings, economy_snapshots

market_health ──(okur)──> economic_director ──(yazar)──> npc_directives
npc_directives ──(okur)──> npc_profiles + npc agent ──(yazar)──> market_orders
```

## 2. İlişki ve kardinalite açıklamaları

### 2.1 `users` ↔ `companies` (1:1, opsiyonel)
`companies.user_id` **UNIQUE ve NULL olabilir**. Bir kullanıcının en fazla bir şirketi
vardır (çoklu hesap = ekonomi manipülasyonu). `NULL` olması şirketin NPC veya SYSTEM
olduğu anlamına gelir.

Neden ayrı tablo? Çünkü NPC'ler ve sistem hesapları da tam birer şirkettir (madde 23:
"NPC şirketler gerçek oyuncular gibi aynı sistemleri kullanır"). Ayrı bir `npc_companies`
tablosu yapmak, her ekonomi sorgusunun `UNION` olmasına yol açar ve NPC'ler zamanla
ayrıcalıklı bir varlığa dönüşür.

### 2.2 `companies` ↔ `facilities` ↔ `inventories` (1:N:1)
Envanter **şirkete değil, tesise** bağlıdır. Bu bilinçli bir karar:
- Depo kapasitesi tesis bazlıdır (madde 36)
- Bir şehirdeki stok başka şehirde satılamaz → lojistik anlamlı olur (madde 17)
- Perakende satışta stok kontrolü tek tesise iner → kilit çekişmesi (contention) azalır

`inventories.facility_id` UNIQUE'tir; tesis silinirse envanter de silinir (CASCADE).

### 2.3 `inventories` ↔ `inventory_batches` (1:N)
Madde 10'un çekirdeği. Aynı ürünün farklı kalite/maliyetteki partileri **ayrı satırlar**.

UI'daki toplam değerler türetilir, saklanmaz:
```sql
SELECT product_id,
       SUM(quantity - reserved_quantity)                       AS available,
       SUM(quantity * quality) / NULLIF(SUM(quantity),0)       AS avg_quality,
       SUM(quantity * unit_cost) / NULLIF(SUM(quantity),0)     AS wavg_cost
FROM inventory_batches WHERE inventory_id = $1 GROUP BY product_id;
```
Tek istisna `inventories.used_capacity` — kapasite kontrolü her INSERT'te bir toplama
yapmasın diye denormalize edilir ve trigger ile tutarlı tutulur.

### 2.4 `products` ↔ `production_recipes` ↔ `recipe_inputs` (ürün grafı)
`production_recipes` bir çıktı ürünü, `recipe_inputs` N girdi ürünü tanımlar →
**N:M self-referencing** ilişki, `products` üzerinde yönlü asiklik graf oluşturur.

`production_recipes.facility_type_id` reçeteyi tesise bağlar: "Değirmen buğdayı una
çevirir". Aynı tesis tipi birden fazla reçeteye sahip olabilir; `facilities.active_recipe_id`
o an hangisinin çalıştığını söyler.

**Kısıt:** `UNIQUE (facility_type_id, output_product_id)` — aynı tesis tipi aynı ürün
için iki farklı reçeteye sahip olamaz (belirsizlik yaratır).

### 2.5 `market_orders` ↔ `market_trades` (N:M, eşleşme üzerinden)
Bir BUY emri N SELL emriyle, bir SELL emri N BUY emriyle eşleşebilir. `market_trades`
bu N:M ilişkinin gerçekleşme kaydıdır ve **değiştirilemez (immutable)**.

`market_trades.is_excluded_from_index` madde 48'in uygulama noktasıdır: wash trade veya
aşırı uç işlemler referans fiyat hesabından çıkarılır ama **işlem iptal edilmez** —
oyuncular ticaretlerini yapar, sadece endeksi kirletemez.

### 2.6 `market_trades` ↔ `shipments` (1:1)
Bir eşleşme gerçekleştiğinde stok **anında el değiştirmez**. Satıcının lotu
`reserved_quantity` ile bloke edilir, bir `shipment` oluşur, `arrival_tick`'te alıcının
tesisinde yeni bir `inventory_batch` olarak belirir.

Bu ilişki lojistiği (madde 17) bir vergiden **stratejik bir mekaniğe** dönüştürür:
mesafe hem maliyet hem gecikmedir.

### 2.7 `cities` ↔ `cities` (`city_distances`, N:M)
Simetrik olmak zorunda değil (tek yönlü yol/lojistik farkı modellenebilir). 5 şehir için
25 satır, 81 şehir için 6.561 satır — tamamen bellekte tutulabilir, her tick cache'lenir.

### 2.8 `economic_ticks` — merkezi zaman ekseni
Neredeyse tüm olay tabloları `tick_id` taşır. Bu:
- Idempotency anahtarının parçasıdır (`PK (tick_id, facility_id, product_id)`)
- Bölümleme (partition) anahtarıdır
- Raporlamada tek `JOIN` noktasıdır
- Deterministik tekrar oynatmayı mümkün kılar (`rng_seed` + `config_version`)

**Kural:** İş mantığında `NOW()` veya `Date.now()` kullanılmaz. Zaman = `tick.seq`.

### 2.9 `market_health` → `npc_directives` → `npc_profiles` (tek yönlü zincir)
Economic Director `market_health`'i **okur**, `npc_directives`'e **yazar**.
NPC ajanı kendi `npc_profiles` satırını + geçerli direktifleri okur, kendi
`market_orders` ve `retail_offers` satırlarını yazar.

**Bu zincirde ters ok yoktur.** Economic Director'ın `market_orders`, `retail_offers`
veya `companies.cash` üzerinde yazma yetkisi **yoktur** (tek istisna: `SYS_RESERVE`
şirketi üzerinden, normal bir NPC gibi). Ayrıntı: `07-npc-ve-economic-director.md`.

### 2.10 `ledger_entries` — çapraz kesen muhasebe
Para hareketi yaratan **her** tablo (market_trades, retail_sales, loans, facilities
inşaatı, maintenance) buraya çift kayıt yazar. `companies.cash` bir önbellektir;
gerçek doğruluk kaynağı ledger toplamıdır ve her tick I1 değişmeziyle doğrulanır.

## 3. Silme (delete) politikası

| İlişki | Politika | Gerekçe |
|---|---|---|
| `users` → `companies` | `SET NULL` | Hesap silinse de ekonomi geçmişi bozulmaz (KVKK: kişisel veri users'ta) |
| `companies` → `facilities`, `market_orders`, `loans` | `CASCADE` | Şirket yoksa varlığı da yok |
| `companies` → `ledger_entries`, `market_trades` | **FK YOK** (soft ref) | Muhasebe kaydı asla silinmez |
| `facilities` → `inventories` → `batches` | `CASCADE` | |
| `products`, `cities`, `facility_types` | **DELETE YOK**, `is_active=false` | Geçmiş kayıtlar referansı korur |

Ekonomi geçmişi taşıyan tablolarda FK yerine soft referans kullanılır; hem CASCADE
kazası riskini kaldırır hem partition'lı tablolarda FK maliyetinden kaçınır.
