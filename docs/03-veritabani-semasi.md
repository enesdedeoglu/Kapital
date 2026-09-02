# 03 — PostgreSQL Şeması

PostgreSQL 16. Tüm DDL `packages/db/migrations/` altında Drizzle migration olarak üretilir.
Aşağıdaki DDL **referans şema**dır; alan adları kod ile birebir aynıdır.

## 0. Ortak tanımlar

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Para: 1 ₺ = 10.000 birim (scale 4). Miktar: 1 birim = 1.000 (scale 3).
CREATE DOMAIN money_amt AS BIGINT;
CREATE DOMAIN qty_amt   AS BIGINT CHECK (VALUE >= 0);
CREATE DOMAIN quality_t AS NUMERIC(6,3) CHECK (VALUE >= 0 AND VALUE <= 100);

CREATE TYPE company_kind  AS ENUM ('PLAYER','NPC','SYSTEM');
CREATE TYPE company_status AS ENUM ('ACTIVE','BANKRUPT','SUSPENDED','DELETED');
CREATE TYPE order_side    AS ENUM ('BUY','SELL');
CREATE TYPE order_status  AS ENUM ('OPEN','PARTIAL','FILLED','CANCELLED','EXPIRED');
CREATE TYPE facility_cat  AS ENUM ('RETAIL','AGRICULTURE','LIVESTOCK','MINING','INDUSTRY','LOGISTICS');
CREATE TYPE tick_status   AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED');
CREATE TYPE phase_status  AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED');
CREATE TYPE shipment_status AS ENUM ('IN_TRANSIT','DELIVERED','CANCELLED');
CREATE TYPE ledger_dir    AS ENUM ('DEBIT','CREDIT');
CREATE TYPE currency_t    AS ENUM ('TRY','USD');
```

---

## 1. IDENTITY

```sql
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  locale         TEXT NOT NULL DEFAULT 'tr',
  is_admin       BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  device_id    TEXT,
  push_token   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- Mobil çift-dokunma / retry koruması (EK — istek listesinde yoktu)
CREATE TABLE idempotency_keys (
  key          TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_body JSONB,
  status_code  SMALLINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON idempotency_keys (created_at);   -- 24s sonra temizlenir
```

---

## 2. WORLD (config verisi — admin panelden yönetilir)

```sql
CREATE TABLE cities (
  id                    SMALLINT PRIMARY KEY,
  code                  TEXT UNIQUE NOT NULL,          -- 'IST'
  name                  TEXT NOT NULL,
  population_index      DOUBLE PRECISION NOT NULL,
  income_index          DOUBLE PRECISION NOT NULL,
  land_cost_index       DOUBLE PRECISION NOT NULL,
  industrial_bonus      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  agriculture_bonus     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  consumer_demand_index DOUBLE PRECISION NOT NULL,
  logistics_modifier    DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  has_port              BOOLEAN NOT NULL DEFAULT FALSE, -- Liman kurulabilir mi (İST/İZM/BRS)
  is_active             BOOLEAN NOT NULL DEFAULT TRUE  -- 81 ile genişleme için
);

CREATE TABLE city_distances (
  origin_city_id      SMALLINT NOT NULL REFERENCES cities(id),
  destination_city_id SMALLINT NOT NULL REFERENCES cities(id),
  distance_index      DOUBLE PRECISION NOT NULL,
  transit_ticks       SMALLINT NOT NULL DEFAULT 1,     -- EK: mesafe = maliyet + SÜRE
  PRIMARY KEY (origin_city_id, destination_city_id),
  CHECK (origin_city_id <> destination_city_id OR distance_index = 0)
);

CREATE TABLE product_categories (
  id               SMALLINT PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,               -- 'STAPLE_FOOD','ELECTRONICS','AUTOMOTIVE'
  name             TEXT NOT NULL,
  price_weight     DOUBLE PRECISION NOT NULL,          -- madde 20 kategori katsayıları
  quality_weight   DOUBLE PRECISION NOT NULL,
  brand_weight     DOUBLE PRECISION NOT NULL
);

CREATE TABLE products (
  id                     SMALLINT PRIMARY KEY,
  code                   TEXT UNIQUE NOT NULL,
  name                   TEXT NOT NULL,
  category_id            SMALLINT NOT NULL REFERENCES product_categories(id),
  unit                   TEXT NOT NULL,                -- 'kg','L','adet','m','paket'
  base_reference_price   money_amt NOT NULL,
  base_demand            DOUBLE PRECISION NOT NULL,    -- birim/tick/1.0 nüfus indeksi
  price_sensitivity      DOUBLE PRECISION NOT NULL,
  quality_sensitivity    DOUBLE PRECISION NOT NULL,
  brand_sensitivity      DOUBLE PRECISION NOT NULL,
  reservation_price_mult DOUBLE PRECISION NOT NULL DEFAULT 3.0, -- EK: bkz. R10
  shelf_life_ticks       INTEGER,                      -- NULL = bozulmaz
  quality_decay_rate     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- %/tick
  weight_per_unit        DOUBLE PRECISION NOT NULL,    -- nakliye için
  unlock_level           SMALLINT NOT NULL DEFAULT 1,
  is_raw_material        BOOLEAN NOT NULL DEFAULT FALSE,
  is_intermediate        BOOLEAN NOT NULL DEFAULT FALSE,
  is_retail_product      BOOLEAN NOT NULL DEFAULT FALSE,
  npc_min_liquidity      DOUBLE PRECISION NOT NULL DEFAULT 0,
  npc_target_market_share DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE facility_types (
  id                  SMALLINT PRIMARY KEY,
  code                TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  category            facility_cat NOT NULL,
  base_cost           money_amt NOT NULL,
  base_capacity       DOUBLE PRECISION NOT NULL,       -- birim/tick
  maintenance_cost    money_amt NOT NULL,              -- ₺/tick
  employee_slots      SMALLINT NOT NULL DEFAULT 0,
  storage_capacity    qty_amt NOT NULL,
  construction_ticks  SMALLINT NOT NULL DEFAULT 1,
  upgrade_multiplier  DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  unlock_level        SMALLINT NOT NULL DEFAULT 1,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE facility_level_curve (          -- madde 12 kapasite katsayıları — hard-code YOK
  level             SMALLINT PRIMARY KEY CHECK (level BETWEEN 1 AND 30),
  capacity_multiplier DOUBLE PRECISION NOT NULL,
  cost_exponent     DOUBLE PRECISION NOT NULL DEFAULT 1.55
);

CREATE TABLE production_recipes (
  id                SERIAL PRIMARY KEY,
  facility_type_id  SMALLINT NOT NULL REFERENCES facility_types(id),
  output_product_id SMALLINT NOT NULL REFERENCES products(id),
  output_quantity   qty_amt NOT NULL,
  cycle_ticks       SMALLINT NOT NULL DEFAULT 1,
  labor_cost        money_amt NOT NULL DEFAULT 0,
  energy_cost       money_amt NOT NULL DEFAULT 0,
  unlock_level      SMALLINT NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (facility_type_id, output_product_id)
);

CREATE TABLE recipe_inputs (
  recipe_id     INTEGER NOT NULL REFERENCES production_recipes(id) ON DELETE CASCADE,
  product_id    SMALLINT NOT NULL REFERENCES products(id),
  quantity      qty_amt NOT NULL,
  min_quality   quality_t NOT NULL DEFAULT 0,
  PRIMARY KEY (recipe_id, product_id)
);

-- Denge parametreleri için versiyonlu config deposu (EK — madde 47'nin şartı)
CREATE TABLE game_configs (
  key         TEXT NOT NULL,
  version     INTEGER NOT NULL,
  value       JSONB NOT NULL,
  effective_from_tick BIGINT,       -- NULL = hemen
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, version)
);
CREATE TABLE admin_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   UUID NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  before_val JSONB, after_val JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. ORGANIZATION

```sql
CREATE TABLE companies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,  -- NULL ⇒ NPC/SYSTEM
  kind           company_kind NOT NULL,
  system_code    TEXT UNIQUE,                    -- SYS_CONSUMER|SYS_SINK|SYS_RESERVE|SYS_FX|SYS_BANK|SYS_WORLD
  name           TEXT NOT NULL,
  cash           money_amt NOT NULL DEFAULT 0,   -- ₺ — yurt içi ekonominin TEK para birimi
  usd_balance    money_amt NOT NULL DEFAULT 0,   -- $ — yalnız dış ticaret/döviz; bkz. docs/12
  level          SMALLINT NOT NULL DEFAULT 1,
  experience     BIGINT NOT NULL DEFAULT 0,
  reputation     NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (reputation BETWEEN 0 AND 100),
  home_city_id   SMALLINT NOT NULL REFERENCES cities(id),
  logistics_modifier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  company_value  money_amt NOT NULL DEFAULT 0,   -- türetilmiş, her tick yazılır
  status         company_status NOT NULL DEFAULT 'ACTIVE',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  -- Sistem şirketleri muaf: SYS_CONSUMER musluk olduğu için tanımı gereği negatiftir,
  -- SYS_FX ise dolaşımdaki USD'yi negatif pozisyon olarak taşır.
  CONSTRAINT cash_non_negative CHECK (kind = 'SYSTEM' OR cash >= 0),
  CONSTRAINT usd_non_negative  CHECK (kind = 'SYSTEM' OR usd_balance >= 0),
  CONSTRAINT sys_code_only_for_system CHECK ((kind = 'SYSTEM') = (system_code IS NOT NULL))
);
CREATE INDEX ON companies (kind, status);
CREATE INDEX ON companies (company_value DESC) WHERE kind='PLAYER' AND status='ACTIVE';
CREATE INDEX ON companies (home_city_id);

CREATE TABLE company_levels (          -- madde 42, veri odaklı, hard-cap yok
  level             SMALLINT PRIMARY KEY,
  required_xp       BIGINT NOT NULL,
  required_company_value money_amt NOT NULL DEFAULT 0,
  required_trade_volume  money_amt NOT NULL DEFAULT 0,
  required_units_produced qty_amt NOT NULL DEFAULT 0,
  required_distinct_products SMALLINT NOT NULL DEFAULT 0,
  title             TEXT NOT NULL
);
```

---

## 4. OPERATIONS

```sql
CREATE TABLE facilities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  facility_type_id SMALLINT NOT NULL REFERENCES facility_types(id),
  city_id          SMALLINT NOT NULL REFERENCES cities(id),
  name             TEXT,
  level            SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 30),
  condition        NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  technology_bonus DOUBLE PRECISION NOT NULL DEFAULT 0,
  staff_score      DOUBLE PRECISION NOT NULL DEFAULT 0.5,  -- MVP: sabit; F11'da employees'ten türer
  production_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  active_recipe_id INTEGER REFERENCES production_recipes(id),
  storage_capacity qty_amt NOT NULL,
  construction_complete_at_tick BIGINT,
  halted_reason    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);
-- Tick motorunun taradığı TEK index (madde 54)
CREATE INDEX facilities_active_production ON facilities (city_id, facility_type_id)
  WHERE production_enabled AND closed_at IS NULL;
CREATE INDEX ON facilities (company_id) WHERE closed_at IS NULL;

CREATE TABLE inventories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  facility_id  UUID NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
  used_capacity qty_amt NOT NULL DEFAULT 0     -- denormalize; trigger ile tutarlı
);

CREATE TABLE inventory_batches (
  id                 BIGSERIAL PRIMARY KEY,
  inventory_id       UUID NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  product_id         SMALLINT NOT NULL REFERENCES products(id),
  quantity           qty_amt NOT NULL,
  reserved_quantity  qty_amt NOT NULL DEFAULT 0,
  quality            quality_t NOT NULL,
  unit_cost          money_amt NOT NULL,
  produced_in_tick   BIGINT,
  expires_at_tick    BIGINT,
  source_company_id  UUID REFERENCES companies(id),
  source_facility_id UUID REFERENCES facilities(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reserve_le_qty CHECK (reserved_quantity <= quantity),
  CONSTRAINT qty_positive   CHECK (quantity > 0)
);
-- FEFO tüketim indexi
CREATE INDEX batches_fefo ON inventory_batches (inventory_id, product_id, expires_at_tick NULLS LAST, id);
CREATE INDEX batches_expiring ON inventory_batches (expires_at_tick) WHERE expires_at_tick IS NOT NULL;

CREATE TABLE production_jobs (          -- çok-tick'li üretim döngüleri
  id            BIGSERIAL PRIMARY KEY,
  facility_id   UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  recipe_id     INTEGER NOT NULL REFERENCES production_recipes(id),
  started_tick  BIGINT NOT NULL,
  complete_tick BIGINT NOT NULL,
  planned_output qty_amt NOT NULL,
  input_quality quality_t NOT NULL,
  input_cost    money_amt NOT NULL,
  status        TEXT NOT NULL DEFAULT 'RUNNING'
);
CREATE INDEX ON production_jobs (complete_tick) WHERE status='RUNNING';

-- EK: Lojistik yalnızca maliyet değil, SÜRE de olmalı (bkz. 11-kapsam-degisiklikleri)
CREATE TABLE shipments (
  id                 BIGSERIAL PRIMARY KEY,
  trade_id           BIGINT,
  from_company_id    UUID NOT NULL REFERENCES companies(id),
  to_company_id      UUID NOT NULL REFERENCES companies(id),
  to_facility_id     UUID NOT NULL REFERENCES facilities(id),
  product_id         SMALLINT NOT NULL REFERENCES products(id),
  quantity           qty_amt NOT NULL,
  quality            quality_t NOT NULL,
  unit_cost          money_amt NOT NULL,
  shipping_cost      money_amt NOT NULL,
  dispatched_tick    BIGINT NOT NULL,
  arrival_tick       BIGINT NOT NULL,
  status             shipment_status NOT NULL DEFAULT 'IN_TRANSIT'
);
CREATE INDEX shipments_arriving ON shipments (arrival_tick) WHERE status='IN_TRANSIT';
```

---

## 5. EXCHANGE

```sql
CREATE TABLE market_orders (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  facility_id          UUID REFERENCES facilities(id),  -- SELL: stok kaynağı / BUY: teslim hedefi
  product_id           SMALLINT NOT NULL REFERENCES products(id),
  city_id              SMALLINT NOT NULL REFERENCES cities(id),
  side                 order_side NOT NULL,
  quantity             qty_amt NOT NULL,
  remaining_quantity   qty_amt NOT NULL,
  price_per_unit       money_amt NOT NULL,
  min_quality          quality_t NOT NULL DEFAULT 0,
  max_delivery_distance DOUBLE PRECISION,
  escrow_amount        money_amt NOT NULL DEFAULT 0,    -- BUY emrinde para bloke edilir
  status               order_status NOT NULL DEFAULT 'OPEN',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at_tick      BIGINT NOT NULL,
  CONSTRAINT remaining_valid CHECK (remaining_quantity BETWEEN 0 AND quantity)
);
-- Eşleştirme motorunun ana index'i: emir defteri (product, city, side, fiyat)
CREATE INDEX orders_book ON market_orders (product_id, city_id, side, price_per_unit, id)
  WHERE status IN ('OPEN','PARTIAL');
CREATE INDEX ON market_orders (company_id, status);
CREATE INDEX ON market_orders (expires_at_tick) WHERE status IN ('OPEN','PARTIAL');

CREATE TABLE market_trades (
  id               BIGSERIAL,
  tick_id          BIGINT NOT NULL,
  buy_order_id     BIGINT NOT NULL,
  sell_order_id    BIGINT NOT NULL,
  buyer_company_id UUID NOT NULL,
  seller_company_id UUID NOT NULL,
  product_id       SMALLINT NOT NULL,
  from_city_id     SMALLINT NOT NULL,
  to_city_id       SMALLINT NOT NULL,
  quantity         qty_amt NOT NULL,
  price_per_unit   money_amt NOT NULL,
  quality          quality_t NOT NULL,
  shipping_cost    money_amt NOT NULL,
  is_excluded_from_index BOOLEAN NOT NULL DEFAULT FALSE,  -- wash-trade / outlier
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (tick_id);
CREATE INDEX ON market_trades (product_id, tick_id) WHERE NOT is_excluded_from_index;
CREATE INDEX ON market_trades (buyer_company_id, seller_company_id, tick_id);

CREATE TABLE trade_flags (              -- EK: anti-manipülasyon (madde 48)
  id           BIGSERIAL PRIMARY KEY,
  company_a    UUID NOT NULL REFERENCES companies(id),
  company_b    UUID NOT NULL REFERENCES companies(id),
  product_id   SMALLINT NOT NULL REFERENCES products(id),
  window_start_tick BIGINT NOT NULL,
  bilateral_volume  qty_amt NOT NULL,
  price_deviation_pct DOUBLE PRECISION NOT NULL,
  suspicion_score  DOUBLE PRECISION NOT NULL,
  action_taken     TEXT,                -- 'INDEX_EXCLUDED' | 'REVIEW' | 'SUSPENDED'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- DÖVİZ (bkz. docs/12-doviz-mekanigi.md — mekanik tasarımı ayrı dokümanda)
-- ---------------------------------------------------------------------------
CREATE TABLE fx_rates (                 -- tick başına tek resmi kur
  tick_id        BIGINT PRIMARY KEY,
  rate_try_per_usd money_amt NOT NULL,  -- 1 USD kaç ₺
  source         TEXT NOT NULL,         -- 'ADMIN' | 'MODEL' | 'MARKET'
  trade_balance  money_amt NOT NULL DEFAULT 0,  -- son 96 tick net ihracat−ithalat (₺)
  usd_in_circulation money_amt NOT NULL DEFAULT 0
);

CREATE TABLE world_market (             -- ürün bazlı dış ticaret config'i
  product_id        SMALLINT PRIMARY KEY REFERENCES products(id),
  importable        BOOLEAN NOT NULL DEFAULT FALSE,   -- nihai perakende ürünleri: FALSE
  exportable        BOOLEAN NOT NULL DEFAULT FALSE,
  base_price_usd    money_amt NOT NULL,               -- seed: base_reference_price / fx_rate_0
  world_price_index DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  export_multiplier DOUBLE PRECISION NOT NULL DEFAULT 0.75,  -- oyuncunun aldığı
  import_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.35,  -- oyuncunun ödediği
  export_depth_pct  DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  import_depth_pct  DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  world_quality     quality_t NOT NULL DEFAULT 70
);

CREATE TABLE foreign_trades (
  id             BIGSERIAL,
  tick_id        BIGINT NOT NULL,
  company_id     UUID NOT NULL,
  facility_id    UUID NOT NULL,             -- liman tesisi
  product_id     SMALLINT NOT NULL,
  direction      TEXT NOT NULL,             -- 'IMPORT' | 'EXPORT'
  quantity       qty_amt NOT NULL,
  unit_price_usd money_amt NOT NULL,
  usd_amount     money_amt NOT NULL,
  try_equivalent money_amt NOT NULL,
  quality        quality_t NOT NULL,
  PRIMARY KEY (tick_id, company_id, facility_id, product_id, direction)
) PARTITION BY RANGE (tick_id);

CREATE TABLE fx_trades (
  id             BIGSERIAL PRIMARY KEY,
  tick_id        BIGINT NOT NULL,
  company_id     UUID NOT NULL REFERENCES companies(id),
  side           TEXT NOT NULL,         -- 'BUY_USD' | 'SELL_USD'
  usd_amount     money_amt NOT NULL,
  try_amount     money_amt NOT NULL,
  rate           money_amt NOT NULL,
  spread_paid    money_amt NOT NULL DEFAULT 0,   -- SYS_SINK'e giden komisyon
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON fx_trades (company_id, tick_id);
CREATE INDEX ON fx_trades (tick_id);

CREATE TABLE price_history (            -- tick başına ürün×şehir OHLC + medyan
  tick_id          BIGINT NOT NULL,
  product_id       SMALLINT NOT NULL REFERENCES products(id),
  city_id          SMALLINT REFERENCES cities(id),      -- NULL = ulusal
  weighted_median  money_amt NOT NULL,
  ema_reference    money_amt NOT NULL,
  open_price       money_amt, high_price money_amt,
  low_price        money_amt, close_price money_amt,
  volume           qty_amt NOT NULL DEFAULT 0,
  trade_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tick_id, product_id, city_id)
) PARTITION BY RANGE (tick_id);
```

---

## 6. CONSUMPTION (perakende)

```sql
CREATE TABLE retail_offers (
  facility_id    UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  product_id     SMALLINT NOT NULL REFERENCES products(id),
  selling_price  money_amt NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (facility_id, product_id)
);
CREATE INDEX retail_active ON retail_offers (product_id) WHERE enabled;

CREATE TABLE city_demand (              -- her tick, şehir×ürün talep fotoğrafı
  tick_id        BIGINT NOT NULL,
  city_id        SMALLINT NOT NULL REFERENCES cities(id),
  product_id     SMALLINT NOT NULL REFERENCES products(id),
  demand_units   qty_amt NOT NULL,
  demand_budget  money_amt NOT NULL,     -- EK: bütçe tavanı — bkz. R10
  fulfilled_units qty_amt NOT NULL DEFAULT 0,
  avg_price      money_amt,
  PRIMARY KEY (tick_id, city_id, product_id)
) PARTITION BY RANGE (tick_id);

-- Tick başına facility×product AGREGE satır (tek tek işlem DEĞİL — bkz. R7)
CREATE TABLE retail_sales (
  tick_id      BIGINT NOT NULL,
  facility_id  UUID NOT NULL,
  product_id   SMALLINT NOT NULL,
  company_id   UUID NOT NULL,
  city_id      SMALLINT NOT NULL,
  quantity     qty_amt NOT NULL,
  unit_price   money_amt NOT NULL,
  revenue      money_amt NOT NULL,
  cogs         money_amt NOT NULL,
  avg_quality  quality_t NOT NULL,
  market_share DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (tick_id, facility_id, product_id)     -- ★ idempotency garantisi
) PARTITION BY RANGE (tick_id);
```

---

## 7. FINANCE

```sql
-- EK: Çift taraflı kayıt defteri. Madde 34/35 (para arzı) bunsuz ölçülemez.
CREATE TABLE ledger_entries (
  id                BIGSERIAL,
  tick_id           BIGINT,
  company_id        UUID NOT NULL,
  counterparty_id   UUID,
  direction         ledger_dir NOT NULL,
  currency          currency_t NOT NULL DEFAULT 'TRY',   -- her defter satırı tek para birimi
  amount            money_amt NOT NULL CHECK (amount > 0),
  account           TEXT NOT NULL,     -- 'SALES','COGS','SALARY','MAINTENANCE','SHIPPING',
                                       -- 'INTEREST','TAX','CAPEX','TRADE','LOAN_PRINCIPAL'
  reason            TEXT NOT NULL,
  ref_type          TEXT, ref_id BIGINT,
  rounding_residue  BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (tick_id);
CREATE INDEX ON ledger_entries (company_id, tick_id);
CREATE INDEX ON ledger_entries (account, currency, tick_id);

CREATE TABLE company_financials (       -- tick başına şirket P&L
  tick_id        BIGINT NOT NULL,
  company_id     UUID NOT NULL,
  revenue        money_amt NOT NULL DEFAULT 0,
  cogs           money_amt NOT NULL DEFAULT 0,
  salary_cost    money_amt NOT NULL DEFAULT 0,
  maintenance    money_amt NOT NULL DEFAULT 0,
  shipping_cost  money_amt NOT NULL DEFAULT 0,
  interest_cost  money_amt NOT NULL DEFAULT 0,
  tax            money_amt NOT NULL DEFAULT 0,
  capex          money_amt NOT NULL DEFAULT 0,
  net_profit     money_amt NOT NULL DEFAULT 0,
  cash_close     money_amt NOT NULL,
  inventory_value money_amt NOT NULL DEFAULT 0,
  facility_value money_amt NOT NULL DEFAULT 0,
  debt           money_amt NOT NULL DEFAULT 0,
  company_value  money_amt NOT NULL,
  PRIMARY KEY (tick_id, company_id)
) PARTITION BY RANGE (tick_id);

CREATE TABLE facility_financials (      -- madde 46: tesis bazlı kâr/zarar
  tick_id     BIGINT NOT NULL,
  facility_id UUID NOT NULL,
  revenue money_amt NOT NULL DEFAULT 0, cogs money_amt NOT NULL DEFAULT 0,
  salary money_amt NOT NULL DEFAULT 0, rent money_amt NOT NULL DEFAULT 0,
  shipping money_amt NOT NULL DEFAULT 0, maintenance money_amt NOT NULL DEFAULT 0,
  net_profit money_amt NOT NULL DEFAULT 0,
  PRIMARY KEY (tick_id, facility_id)
) PARTITION BY RANGE (tick_id);

CREATE TABLE loans (
  id               BIGSERIAL PRIMARY KEY,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  principal        money_amt NOT NULL,
  interest_rate    DOUBLE PRECISION NOT NULL,     -- tick başına
  remaining_balance money_amt NOT NULL,
  payment_per_tick money_amt NOT NULL,
  missed_payments  SMALLINT NOT NULL DEFAULT 0,
  company_value_at_open money_amt NOT NULL,       -- limit denetimi ve audit için
  leverage_at_open DOUBLE PRECISION NOT NULL,
  opened_tick      BIGINT NOT NULL,
  due_tick         BIGINT NOT NULL,
  defaulted_at_tick BIGINT,
  status           TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE|PAID|DEFAULTED|LIQUIDATED
  CONSTRAINT balance_non_negative CHECK (remaining_balance >= 0)
);
CREATE INDEX ON loans (company_id) WHERE status='ACTIVE';
-- Taksit tahsilatı P4'te; idempotency defter satırının doğal anahtarından gelir:
-- ledger_entries UNIQUE (tick_id, company_id, account, ref_type, ref_id)

-- Kredi limiti kod içine gömülmez (madde 58.7):
CREATE TABLE loan_terms (
  level_min       SMALLINT PRIMARY KEY,
  leverage_ratio  DOUBLE PRECISION NOT NULL,      -- max_loan = company_value × bu − mevcut borç
  interest_rate   DOUBLE PRECISION NOT NULL,      -- tick başına
  max_term_ticks  INTEGER NOT NULL,
  default_after_missed SMALLINT NOT NULL DEFAULT 3
);
```

---

## 8. SIMULATION / OTORİTE

```sql
CREATE TABLE economic_ticks (
  id            BIGSERIAL PRIMARY KEY,
  seq           BIGINT UNIQUE NOT NULL,          -- monoton, boşluksuz
  scheduled_at  TIMESTAMPTZ NOT NULL,
  started_at    TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  status        tick_status NOT NULL DEFAULT 'PENDING',
  is_catch_up   BOOLEAN NOT NULL DEFAULT FALSE,
  config_version JSONB NOT NULL,                 -- bu tick'te geçerli config anlık görüntüsü
  rng_seed      BIGINT NOT NULL,                 -- deterministik tekrar için
  season        SMALLINT NOT NULL,
  duration_ms   INTEGER,
  metrics       JSONB
);

CREATE TABLE tick_phase_runs (
  tick_id     BIGINT NOT NULL REFERENCES economic_ticks(id) ON DELETE CASCADE,
  phase       SMALLINT NOT NULL,
  phase_code  TEXT NOT NULL,
  shard_total SMALLINT NOT NULL DEFAULT 1,
  shard_done  SMALLINT NOT NULL DEFAULT 0,
  status      phase_status NOT NULL DEFAULT 'PENDING',
  started_at  TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  error       TEXT,
  PRIMARY KEY (tick_id, phase)
);

CREATE TABLE npc_profiles (
  company_id             UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  archetype              TEXT NOT NULL,       -- 'DISCOUNTER','PREMIUM','VOLUME','SPECULATOR',...
  risk_tolerance         DOUBLE PRECISION NOT NULL,
  target_margin          DOUBLE PRECISION NOT NULL,
  quality_target         DOUBLE PRECISION NOT NULL,
  inventory_target_ticks SMALLINT NOT NULL,
  price_aggressiveness   DOUBLE PRECISION NOT NULL,
  investment_aggressiveness DOUBLE PRECISION NOT NULL,
  preferred_sectors      SMALLINT[] NOT NULL DEFAULT '{}',
  max_debt_ratio         DOUBLE PRECISION NOT NULL,
  cash_reserve_ratio     DOUBLE PRECISION NOT NULL,
  strategy_interval_ticks SMALLINT NOT NULL DEFAULT 96,
  last_strategy_tick     BIGINT
);

CREATE TABLE market_health (
  tick_id         BIGINT NOT NULL,
  product_id      SMALLINT NOT NULL REFERENCES products(id),
  city_id         SMALLINT REFERENCES cities(id),
  score           NUMERIC(5,2) NOT NULL,
  supply_ratio    DOUBLE PRECISION NOT NULL,
  seller_count    INTEGER NOT NULL,
  buyer_count     INTEGER NOT NULL,
  inventory_depth_ticks DOUBLE PRECISION NOT NULL,
  price_volatility DOUBLE PRECISION NOT NULL,
  player_share    DOUBLE PRECISION NOT NULL,
  npc_share       DOUBLE PRECISION NOT NULL,
  band            TEXT NOT NULL,            -- 'HEALTHY','WATCH','ADJUST','STIMULATE','EMERGENCY'
  PRIMARY KEY (tick_id, product_id, city_id)
) PARTITION BY RANGE (tick_id);

-- ★ Economic Director'ın NPC'ye TEK yazma kanalı (bkz. 07-npc-ve-economic-director.md)
CREATE TABLE npc_directives (
  id              BIGSERIAL PRIMARY KEY,
  issued_tick     BIGINT NOT NULL,
  expires_tick    BIGINT NOT NULL,
  scope           TEXT NOT NULL,            -- 'PRODUCT' | 'SECTOR' | 'CITY' | 'GLOBAL'
  product_id      SMALLINT REFERENCES products(id),
  city_id         SMALLINT REFERENCES cities(id),
  lever           TEXT NOT NULL,            -- 'INVENTORY_TARGET','PRODUCTION_BIAS',
                                            -- 'BUY_BIAS','INVESTMENT_BIAS','CAPACITY_CAP'
  magnitude       DOUBLE PRECISION NOT NULL CHECK (magnitude BETWEEN -1 AND 1),
  reason          TEXT NOT NULL,
  health_score_at_issue NUMERIC(5,2)
);
CREATE INDEX ON npc_directives (product_id, expires_tick);

CREATE TABLE world_events (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL, description TEXT,
  scope        TEXT NOT NULL,
  product_id   SMALLINT REFERENCES products(id),
  city_id      SMALLINT REFERENCES cities(id),
  demand_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  supply_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  cost_multiplier   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  start_tick   BIGINT NOT NULL, end_tick BIGINT NOT NULL,
  created_by   UUID REFERENCES users(id)
);
CREATE INDEX ON world_events (start_tick, end_tick);

CREATE TABLE economy_snapshots (        -- admin dashboard (madde 47)
  tick_id             BIGINT PRIMARY KEY,
  total_money_supply  NUMERIC(38,4) NOT NULL,
  player_money        NUMERIC(38,4) NOT NULL,
  npc_money           NUMERIC(38,4) NOT NULL,
  faucet_in           NUMERIC(38,4) NOT NULL,
  sink_out            NUMERIC(38,4) NOT NULL,
  game_cpi            DOUBLE PRECISION NOT NULL,
  median_company_value money_amt NOT NULL,
  p99_to_median_ratio DOUBLE PRECISION NOT NULL,
  gini                DOUBLE PRECISION NOT NULL,
  active_companies    INTEGER NOT NULL,
  bankruptcies_24h    INTEGER NOT NULL
);
```

---

## 9. NOTIFICATION / RANKING / OUTBOX

```sql
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,       -- 'STOCK','PRODUCTION','MARKET','FINANCE','SYSTEM'
  severity    TEXT NOT NULL DEFAULT 'INFO',
  title       TEXT NOT NULL, body TEXT NOT NULL,
  payload     JSONB,
  tick_id     BIGINT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON notifications (company_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  push_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  inapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (company_id, category)
);

-- EK: transactional outbox — tick transaction'ı ile push/WS teslimi ayrışır
CREATE TABLE outbox (
  id          BIGSERIAL PRIMARY KEY,
  topic       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  tick_id     BIGINT,
  dedupe_key  TEXT UNIQUE,
  published_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON outbox (id) WHERE published_at IS NULL;

CREATE TABLE rankings (
  tick_id     BIGINT NOT NULL,
  board       TEXT NOT NULL,        -- 'VALUE','WEEKLY_GROWTH','PRODUCER','RETAILER',...
  scope_key   TEXT NOT NULL DEFAULT 'GLOBAL',   -- sektör/şehir kodu
  rank        INTEGER NOT NULL,
  company_id  UUID NOT NULL,
  metric_value NUMERIC(38,4) NOT NULL,
  PRIMARY KEY (tick_id, board, scope_key, rank)
) PARTITION BY RANGE (tick_id);

CREATE TABLE company_stats (        -- kümülatif, seviye atlama kriterleri için
  company_id           UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  total_units_produced qty_amt NOT NULL DEFAULT 0,
  total_trade_volume   money_amt NOT NULL DEFAULT 0,
  total_retail_revenue money_amt NOT NULL DEFAULT 0,
  distinct_products_produced SMALLINT NOT NULL DEFAULT 0,
  distinct_cities      SMALLINT NOT NULL DEFAULT 1,
  facilities_built     INTEGER NOT NULL DEFAULT 0,
  peak_company_value   money_amt NOT NULL DEFAULT 0
);
```

## 10. Partitioning ve saklama politikası

| Tablo | Bölümleme | Sıcak saklama | Sonrası |
|---|---|---|---|
| `retail_sales` | `tick_id` aralığı, 1 bölüm = 1 gün (96 tick) | 7 gün | günlük rollup → detay DROP |
| `market_trades` | aynı | 30 gün | rollup → DROP |
| `ledger_entries` | aynı | 30 gün | aylık rollup, detay arşive |
| `price_history` | aynı | 90 gün | saatlik rollup kalıcı |
| `company_financials` | aynı | 30 gün | günlük rollup kalıcı |
| `city_demand`, `market_health`, `rankings` | aynı | 14 gün | agregat kalıcı |

`pg_partman` veya basit bir cron job ile bölüm oluşturma/düşürme otomatikleştirilir.
Bu politika olmadan sistem **3 ay içinde disk sorunu yaşar** — bkz. `10-riskler.md` R7.
