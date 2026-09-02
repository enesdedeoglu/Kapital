# 02 — Domain Modeli

## 1. Bounded Context'ler

Modüler monolit içinde 8 bağlam. Bağlamlar birbirinin tablosuna **doğrudan
yazmaz**; servis arayüzü veya domain event üzerinden konuşur.

```
┌─────────────────────────────────────────────────────────────────┐
│  IDENTITY          │  ORGANIZATION       │  WORLD               │
│  users, sessions   │  companies, levels  │  cities, products,   │
│                    │  reputation         │  recipes, facility   │
│                    │                     │  types, distances    │
├─────────────────────────────────────────────────────────────────┤
│  OPERATIONS                                                     │
│  facilities · inventory (batch/lot) · production · shipments    │
├─────────────────────────────────────────────────────────────────┤
│  EXCHANGE                        │  CONSUMPTION                 │
│  market_orders, trades,          │  retail_offers, city demand, │
│  price discovery, logistics      │  retail_sales                │
├─────────────────────────────────────────────────────────────────┤
│  FINANCE (çapraz kesen)                                         │
│  ledger_entries · company_financials · loans · company_value    │
├─────────────────────────────────────────────────────────────────┤
│  SIMULATION (otorite)                                           │
│  economic_tick · npc agents · economic director · market_health │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Agregatlar ve tutarlılık sınırları

Agregat = tek transaction içinde tutarlı olması **zorunlu** olan birim.

| Agregat | Kök | İçindekiler | Değişmez (invariant) |
|---|---|---|---|
| **Company** | `companies` | cash, debt, level, reputation | `cash >= 0` her zaman |
| **Inventory** | `inventories` (facility başına) | `inventory_batches[]` | `Σ batch.quantity <= facility.storage_capacity` |
| **Batch** | `inventory_batches` | — | `quantity >= reserved_quantity >= 0` |
| **MarketOrder** | `market_orders` | — | `0 <= remaining_quantity <= quantity` |
| **Facility** | `facilities` | retail_offers, production_job | inşaat bitmeden üretim yok |
| **Loan** | `loans` | payments | `remaining_balance >= 0`; açılışta `principal <= company_value × leverage` |
| **Tick** | `economic_ticks` | `tick_phase_runs[]` | faz sırası atlanamaz |

### Agregatlar arası kural
Bir transaction **en fazla 2 Company agregatına** dokunur (alıcı + satıcı).
İkiden fazlası gerekiyorsa (örn. çok taraflı eşleşme) işlem, ikili transferlere
bölünür ve `market_trades` üzerinden bağlanır.

## 3. Çekirdek varlıklar (kavramsal)

### 3.1 Company
```
Company
├─ identity: user_id | null   (null ⇒ NPC veya sistem)
├─ kind: PLAYER | NPC | SYSTEM
├─ cash: Money                 (tek doğruluk kaynağı: ledger toplamı ile eşleşir)
├─ level, experience
├─ reputation: 0..100          (marka skorunu besler)
├─ home_city_id
└─ status: ACTIVE | BANKRUPT | SUSPENDED
```
`SYSTEM` türü üç özel şirket içindir ve **muhasebe bütünlüğü** için gereklidir:

| Kod | Rol |
|---|---|
| `SYS_CONSUMER` | NPC tüketiciler. Perakende satın alımı buradan çıkar → **para musluğu (faucet)** |
| `SYS_SINK` | Maaş, bakım, kira, faiz, vergi, nakliye sistem payı → **para gideri (sink)** |
| `SYS_RESERVE` | Economic Director acil rezervi (madde 32). Normal bir NPC gibi emir verir |
| `SYS_FX` | Döviz işlemlerinin karşı tarafı. `cash` = net sermaye girişi, `−usd_balance` = dolaşımdaki USD |
| `SYS_BANK` | Kredi anaparasının kaynağı. Kredi verme **para yaratır**, geri ödeme **yok eder**; faiz `SYS_SINK`'e gider |
| `SYS_WORLD` | Dünya piyasası — dış ticarette malı alan/satan taraf. `−usd_balance` = oyuna giren toplam USD |

Bu altısı olmadan "para arzı" (madde 34) ölçülemez; her ₺'nin bir kaynağı ve bir
hedefi olur. Sistem şirketleri negatif bakiye taşır (musluk tanımı gereği negatiftir),
bu yüzden `cash >= 0` kısıtı yalnız `PLAYER` ve `NPC` için geçerlidir. Faydalı sonucu:
her para biriminde tüm bakiyelerin toplamı **her zaman sıfırdır**, dolayısıyla
`para arzı = − Σ sistem bakiyeleri`.

### 3.2 Inventory Batch (lot)
Stok **asla** tek sayı değildir.
```
Batch { product, quantity, reserved_quantity, quality, unit_cost,
        expires_at_tick, source_company, source_facility, produced_in_tick }
```
- Tüketim sırası: **FEFO** (önce bozulacak önce çıkar), eşitlikte FIFO.
- `unit_cost` maliyet muhasebesinin temeli; satışta COGS bu lottan gelir.
- Bozulma lot bazında, `quality_decay_rate` ile her tick uygulanır.
- `reserved_quantity`: kargoya verilmiş ama henüz teslim edilmemiş miktar.
  **Aynı stoğun iki kez satılmasını engelleyen alan budur.**

### 3.3 Ürün ağı (product graph)
Ürünler bir **yönlü asiklik graf** oluşturur (hammadde → ara → nihai).
`production_recipes` + `recipe_inputs` bu grafı tanımlar.

Sistem başlangıçta grafı doğrular:
- döngü yok (Çelik → Motor → Çelik olamaz)
- her nihai ürüne ulaşan en az bir yol var
- `unlock_level`, reçetenin tüm girdilerinin unlock seviyesinden büyük

Bu doğrulama **migration/seed sırasında test olarak** koşar — admin panelden
bozuk reçete girilmesi engellenir.

### 3.4 Facility
```
Facility { type, city, level 1..10, condition 0..100,
           construction_complete_at_tick, production_enabled }
```
Kapasite = `type.base_capacity × levelMultiplier[level] × (condition/100)
            × cityBonus × technologyBonus × staffScore`

### 3.5 Fiyat keşfi (price discovery)
Sistemde **üç farklı fiyat** vardır, karıştırılmamalı:

| Fiyat | Kaynak | Kullanım |
|---|---|---|
| `base_reference_price` | Config (admin) | Yalnızca **denge çıpası** ve NPC ilk fiyatı |
| `market_reference_price` | Son 24s işlemlerin ağırlıklı medyanı (kırpılmış) | Şirket değerleme, çekicilik formülü, market health |
| `selling_price` | Oyuncunun kendi belirlediği | Perakende satış |

`market_reference_price` her tick'te **EMA ile yumuşatılır** (α = 0.25) — bkz. `10-riskler.md` R2.

## 4. Domain event'leri

Tick fazları arası ve bağlamlar arası iletişim event ile. `outbox` tablosuna
yazılır, ayrı bir dispatcher WebSocket/push'a taşır (transactional outbox pattern).

```
OrderMatched, ShipmentDispatched, ShipmentDelivered, ProductionCompleted,
ProductionHalted(reason), RetailSold, StockDepleted, FacilityCompleted,
UpgradeCompleted, LoanPaymentDue, LoanDefaulted, PriceShock(product, city, %),
CompanyLevelUp, MarketHealthDegraded(product, score), CrisisStarted(event)
```

## 5. Değişmezler listesi (test edilebilir)

Bunlar her tick sonunda `invariant_check` job'ı ile **doğrulanır**; ihlal alarm üretir.

| # | Değişmez |
|---|---|
| I1 | Para birimi başına: `Σ bakiye` = `Σ ledger_entries(credit) − Σ ledger_entries(debit)` |
| I2 | Hiçbir `PLAYER`/`NPC` şirketinde `cash < 0` veya `usd_balance < 0` |
| I3 | Her `inventory_batch`: `0 <= reserved_quantity <= quantity` |
| I4 | Her facility: `Σ batch.quantity <= storage_capacity` |
| I5 | Her `market_order`: `0 <= remaining_quantity <= quantity` |
| I6 | Bir tick içinde her (facility, product) için en fazla 1 `retail_sales` satırı |
| I7 | Kapalı tick'e ait yeni ledger kaydı yazılamaz |
| I8 | Ürün grafında döngü yok |
