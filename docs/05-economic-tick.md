# 05 — Economic Tick Mimarisi

## 1. Tasarım hedefleri

| Hedef | Ölçüt |
|---|---|
| Idempotent | Aynı tick 2 kez koşarsa sonuç 1 kez koşmuş gibi olmalı |
| Sıralı ve deterministik | `rng_seed` + `config_version` ile tekrar oynatılabilir |
| Ölçeklenebilir | 100k şirket için yatay shard, tek worker'a bağımlı değil |
| Süre bütçesi | p95 **< 60 sn** (15 dk aralıkta %6.7 doluluk) |
| Kısmi hataya dayanıklı | Bir shard patlarsa yalnız o shard tekrarlanır |

## 2. Faz modeli

Madde 53'teki 25 adım, **bağımlılık ve shard anahtarına göre 8 faza** gruplanır.
Faz sırası atlanamaz; faz içi shard'lar paralel koşar.

| # | Faz | Madde 53 adımları | Shard anahtarı | Paralel? |
|---|---|---|---|---|
| P0 | **OPEN** | 1, 2 | — | Hayır (tekil) |
| P1 | **PRODUCE** | 3, 4, 5, 7 | `company_id` hash (N=64) | Evet |
| P2 | **EXCHANGE** | 6, 8 | `product_id` | Evet |
| P3 | **RETAIL** | 9, 10 | `city_id` (+ product bucket) | Evet |
| P4 | **UPKEEP** | 11, 12, 13, 14, 15 | `company_id` hash | Evet |
| P5 | **SETTLE** | 16, 17, 18, 19 | `company_id` hash → global agregat | Karma |
| P6 | **GOVERN** | 20, 21, 22 | ED tekil → NPC `company_id` hash | Karma |
| P7 | **CLOSE** | 23, 24, 25 | — | Hayır (tekil) |

```
      ┌─────────────────────────────────────────────────────────────┐
      │  ORCHESTRATOR  (Redis lider kilidi, tek instance)           │
      │  her 15 dk → tick oluştur → fazları sırayla ilerlet         │
      └───────────────────────────┬─────────────────────────────────┘
                                  │ BullMQ flow
   P0 ─→ P1 ─→ P2 ─→ P3 ─→ P4 ─→ P5 ─→ P6 ─→ P7
   │     ╱│╲   ╱│╲   ╱│╲   ╱│╲   ╱│╲   ╱│╲    │
   │    64 shard  ürün  şehir  64   64   NPC   │
   │                                            │
   tekil                                     tekil
```

### P0 — OPEN (tekil)
1. `economic_ticks` satırı oluştur (`seq = prev+1`), `config_version` JSONB snapshot al,
   `rng_seed` üret, `season` hesapla. **Bu andan sonra config değişikliği bu tick'i etkilemez.**
2. Aktif `world_events` çarpanlarını hesapla ve tick context'ine yaz.
3. Süresi dolan `market_orders` → `EXPIRED`, escrow iade.
4. `tick_phase_runs` satırlarını P1..P7 için `PENDING` olarak yaz.

### P1 — PRODUCE (shard: company_id)
Tarım, hayvancılık, maden, fabrika — hepsi aynı kod yolunu kullanır, fark reçetededir.

```
her aktif facility için:
  kapasite = base_capacity × levelMult × (condition/100) × cityBonus
             × (1 + technology_bonus) × staffScore × eventSupplyMult
  reçete girdilerini FEFO ile rezerve et → yetmiyorsa kısmi üret + ProductionHalted event
  input_quality = ağırlıklı ortalama(tüketilen lotların kalitesi)
  output_quality = input_quality×0.70 + tech×0.15 + staff×0.10
                   + (condition/100)×0.05 + rng(-1.5, +1.5)
  yeni inventory_batch yaz (unit_cost = girdi maliyeti + labor + energy)
```
Hammadde tesislerinde (tarla, maden) girdi yoktur; `input_quality` = tesis/şehir
temelli taban kalitedir.

**Idempotency:** `production_jobs` benzersiz `(facility_id, started_tick)`; üretilen lot
`inventory_batches.produced_in_tick` + `(facility_id, product_id, produced_in_tick)`
üzerinde partial unique index.

### P2 — EXCHANGE (shard: product_id)
Emir defteri **ürün başına** bölümlenir → iki worker asla aynı defteri görmez.

```
her product için:
  pg_advisory_xact_lock(hash(product_id))            -- oyuncu emirleriyle çakışmayı önler
  BUY emirleri: fiyat DESC, oluşturma ASC
  SELL emirleri: fiyat ASC, oluşturma ASC
  eşleşme: sell.price <= buy.price AND sell.quality >= buy.min_quality
           AND toplam_maliyet(sell) <= buy.price   (nakliye dahil — madde 16)
  fiyat = (buy.price + sell.price) / 2              -- pro-rata orta nokta
  → market_trades + shipments + ledger_entries (escrow'dan satıcıya)
  → satıcı lotunda reserved_quantity artır
```
Sonra: `arrival_tick = current` olan `shipments` teslim edilir → alıcı tesisinde yeni
`inventory_batch`, satıcı lotundan `quantity` ve `reserved_quantity` düşülür.

**Idempotency:** `market_trades` üzerinde `UNIQUE (tick_id, buy_order_id, sell_order_id)`.

### P3 — RETAIL (shard: city_id)
```
her (city, product) için:
  demand_units = base_demand × population_index × income_index × consumer_demand_index
                 × economicCycle × seasonMult × eventMult × rng(0.97, 1.03)
  demand_budget = demand_units × market_reference_price × income_index   ← ★ bütçe tavanı

  her stoklu retail_offer için:
    price_score   = (market_reference_price / selling_price) ^ price_sensitivity
    quality_score = 0.50 + quality/100
    brand_score   = 0.75 + reputation/400
    store_score   = 1 + facility_level × 0.03
    if selling_price > market_reference_price × reservation_price_mult:
        attractiveness = 0                          ← ★ rezervasyon fiyatı (bkz. R10)
    else:
        attractiveness = price_score^pw × quality_score^qw × brand_score^bw × store_score

  pay dağıtımı (en fazla 3 tur):
    share_i = attr_i / Σattr
    sale_i  = min(demand × share_i, stok_i, budget_kalan / price_i)
    karşılanmayan talep → kalan mağazalara yeniden dağıt
    3. turdan sonra kalan talep KARŞILANMAZ (sonsuz döngü yok)

  → retail_sales (agrege, tick×facility×product tek satır)
  → ledger: SYS_CONSUMER (DEBIT) → şirket (CREDIT)   ← paranın oyuna GİRİŞİ
```

### P4 — UPKEEP (shard: company_id)
Stok bozulması (lot bazında `quality *= (1 - decay_rate)`; `expires_at_tick` geçen lotlar
düşülür), maaş, bakım, kira, kredi taksiti, vergi. Hepsi `SYS_SINK`'e giden ledger kaydı.

Nakit yetmezse: **tesis kapatma değil**, `condition` düşürme + `halted_reason` +
`missed_payments` artırma. Yeni oyuncuyu bir tick'te silmeyen kademeli ceza (madde 40).

### P5 — SETTLE (shard: company → global)
1. Shard: `company_financials` + `facility_financials` yaz.
2. Global: `price_history` — son 24 saatin (96 tick) **ağırlıklı medyanı**:
   - `is_excluded_from_index = false` işlemler
   - P10–P90 fiyat bandı dışı işlemler kırpılır
   - miktar ağırlıklı medyan hesaplanır
   - `ema_reference = 0.25 × median + 0.75 × prev_ema`  ← salınım engelleyici
3. Şirket değeri: `cash + Σ(batch.qty × ema_reference) + tesis defter değeri − borç`
   (madde 41: stok oyuncunun kendi fiyatıyla değil, piyasa medyanıyla değerlenir)
4. `market_health` skorları.

### P6 — GOVERN
1. **Economic Director** (tekil): `market_health` okur → `npc_directives` yazar.
2. **NPC operasyonel** (shard, her tick): fiyat güncelle (±%3 bant), alış/satış emri ver,
   üretim reçetesi seç. Direktifler burada birer modifiye edici olarak uygulanır.
3. **NPC stratejik** (yalnız `tick.seq % strategy_interval == 0` olan NPC'ler):
   yatırım skoru hesapla, tesis inşa/yükselt kararı ver.

NPC'nin bu tick'te verdiği emirler **bir sonraki tick'in P2'sinde** eşleşir. Bu
1 tick'lik gecikme bilinçlidir: aynı tick içinde geri besleme döngüsü oluşmasını engeller.

### P7 — CLOSE (tekil)
Sıralamalar, `economy_snapshots`, bildirim üretimi (`outbox`), değişmez kontrolleri (I1–I8),
`tick.status = COMPLETED`, WebSocket yayını.

## 3. Idempotency stratejisi

Üç katmanlı savunma:

**Katman 1 — Faz durum makinesi.** `tick_phase_runs` bir fazın hangi shard'larının
tamamlandığını tutar. Tamamlanmış shard tekrar kuyruğa girmez.

**Katman 2 — Doğal anahtar (asıl savunma).** Her etki tablosunun birincil anahtarı
`tick_id` içerir:
```
retail_sales        PK (tick_id, facility_id, product_id)
company_financials  PK (tick_id, company_id)
market_trades       UNIQUE (tick_id, buy_order_id, sell_order_id)
price_history       PK (tick_id, product_id, city_id)
ledger_entries      UNIQUE (tick_id, company_id, account, ref_type, ref_id)
```
Tüm INSERT'ler `ON CONFLICT DO NOTHING`. Tekrar koşan bir shard hiçbir şey yazmaz.

**Katman 3 — Nakit mutasyonları ledger'dan türer.** `companies.cash` doğrudan
`cash = cash + X` ile değil, ledger INSERT'i başarılı olduysa güncellenir:
```sql
WITH ins AS (
  INSERT INTO ledger_entries (...) VALUES (...) ON CONFLICT DO NOTHING RETURNING amount, direction
)
UPDATE companies SET cash = cash + (SELECT COALESCE(SUM(signed),0) FROM ins) WHERE id = $1;
```
Ledger'a yazılmadıysa nakit de değişmez. Bu, "tick iki kez koştu, para iki kez yattı"
sınıfını tamamen ortadan kaldırır.

## 4. Batch ve süre bütçesi

- Bir transaction **asla** bir fazın tamamını kapsamaz. Chunk boyutu **1.000 varlık**.
- Her chunk kendi transaction'ında; hata olursa yalnız o chunk yeniden denenir.
- N+1 yok: tüm okumalar toplu `WHERE id = ANY($1)`, tüm yazımlar
  `INSERT ... SELECT * FROM UNNEST($1,$2,...)` veya `UPDATE ... FROM (VALUES ...)`.

**Faz süre bütçeleri (10k aktif şirket hedefi):**

| Faz | Bütçe | Aşımda |
|---|---|---|
| P0 | 1 sn | alarm |
| P1 | 12 sn | shard sayısı artır |
| P2 | 10 sn | ürün bazlı paralellik zaten max |
| P3 | 15 sn | şehir×ürün bucket'a böl |
| P4 | 8 sn | shard artır |
| P5 | 10 sn | medyan hesabını materialized view'e al |
| P6 | 8 sn | NPC stratejik kararları tick'lere yay |
| P7 | 3 sn | sıralamayı asenkron yap |
| **Toplam** | **~67 sn** | 15 dk aralığın %7'si |

Her fazın süresi `tick_phase_runs` ve Prometheus'a yazılır. p95 bütçeyi aşarsa alarm.

## 5. Catch-up politikası (spec'te eksikti — kritik)

Worker 2 saat düşerse 8 tick birikir. Kural:

| Gecikme | Davranış |
|---|---|
| ≤ 4 tick | Hepsi normal sırayla, hızlandırılmış koşar |
| 5–24 tick | `is_catch_up=true`: NPC **stratejik** kararlar ve bildirimler atlanır, üretim/satış/finans tam koşar |
| > 24 tick | Tek bir "birleştirilmiş tick" (üretim ve satış × N katsayısı), operatör onayı gerekir |

`is_catch_up` tick'leri sıralama ve başarım hesaplarından dışlanır.

## 6. Determinizm

`Math.random()` yasaktır. Tick context'i bir **seed'li RNG** taşır:
```ts
rng = mulberry32(hash(tick.rng_seed, phase, shardKey, entityId))
```
Aynı seed + aynı config + aynı başlangıç durumu → **aynı sonuç**. Bu:
- hata ayıklamayı (bug reproduction) mümkün kılar
- `packages/sim` simülasyonlarını tekrarlanabilir yapar
- "tick tekrar koştu, farklı sonuç çıktı" sınıfını engeller
