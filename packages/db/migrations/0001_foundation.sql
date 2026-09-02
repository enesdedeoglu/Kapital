-- =============================================================================
-- 0001 · Temel şema — F0
-- Kaynak doğruluk: docs/03-veritabani-semasi.md
-- Para: BIGINT, 1 ₺ = 10.000 (scale 4). Miktar: BIGINT, 1 birim = 1.000 (scale 3).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- --------------------------------------------------------------------------
-- Enum'lar
-- --------------------------------------------------------------------------
CREATE TYPE company_kind    AS ENUM ('PLAYER','NPC','SYSTEM');
CREATE TYPE company_status  AS ENUM ('ACTIVE','BANKRUPT','SUSPENDED','DELETED');
CREATE TYPE facility_cat    AS ENUM ('RETAIL','AGRICULTURE','LIVESTOCK','MINING','INDUSTRY','LOGISTICS');
CREATE TYPE tick_status     AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED');
CREATE TYPE phase_status    AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED');
CREATE TYPE ledger_dir      AS ENUM ('DEBIT','CREDIT');
CREATE TYPE currency_t      AS ENUM ('TRY','USD');

-- --------------------------------------------------------------------------
-- IDENTITY
-- --------------------------------------------------------------------------
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  locale            TEXT NOT NULL DEFAULT 'tr',
  is_admin          BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_id  TEXT,
  push_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX refresh_tokens_active ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- Mobilde çift dokunma / ağ retry koruması — docs/06 §6
CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_body JSONB,
  status_code   SMALLINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idempotency_keys_created ON idempotency_keys (created_at);

-- --------------------------------------------------------------------------
-- WORLD (config — admin panelden yönetilir, kod içine gömülmez)
-- --------------------------------------------------------------------------
CREATE TABLE cities (
  id                    SMALLINT PRIMARY KEY,
  code                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  population_index      DOUBLE PRECISION NOT NULL,
  income_index          DOUBLE PRECISION NOT NULL,
  land_cost_index       DOUBLE PRECISION NOT NULL,
  industrial_bonus      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  agriculture_bonus     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  consumer_demand_index DOUBLE PRECISION NOT NULL,
  logistics_modifier    DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  has_port              BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE city_distances (
  origin_city_id      SMALLINT NOT NULL REFERENCES cities(id),
  destination_city_id SMALLINT NOT NULL REFERENCES cities(id),
  distance_index      DOUBLE PRECISION NOT NULL CHECK (distance_index >= 0),
  transit_ticks       SMALLINT NOT NULL DEFAULT 1 CHECK (transit_ticks >= 0),
  PRIMARY KEY (origin_city_id, destination_city_id),
  CONSTRAINT self_distance_zero CHECK (origin_city_id <> destination_city_id OR distance_index = 0)
);

CREATE TABLE product_categories (
  id             SMALLINT PRIMARY KEY,
  code           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  price_weight   DOUBLE PRECISION NOT NULL,
  quality_weight DOUBLE PRECISION NOT NULL,
  brand_weight   DOUBLE PRECISION NOT NULL
);

CREATE TABLE products (
  id                      SMALLINT PRIMARY KEY,
  code                    TEXT UNIQUE NOT NULL,
  name                    TEXT NOT NULL,
  category_id             SMALLINT NOT NULL REFERENCES product_categories(id),
  unit                    TEXT NOT NULL,
  base_reference_price    BIGINT NOT NULL CHECK (base_reference_price > 0),
  base_demand             DOUBLE PRECISION NOT NULL DEFAULT 0,
  price_sensitivity       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  quality_sensitivity     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  brand_sensitivity       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  reservation_price_mult  DOUBLE PRECISION NOT NULL DEFAULT 3.0 CHECK (reservation_price_mult > 1),
  shelf_life_ticks        INTEGER,
  quality_decay_rate      DOUBLE PRECISION NOT NULL DEFAULT 0,
  weight_per_unit         DOUBLE PRECISION NOT NULL DEFAULT 1,
  unlock_level            SMALLINT NOT NULL DEFAULT 1,
  is_raw_material         BOOLEAN NOT NULL DEFAULT FALSE,
  is_intermediate         BOOLEAN NOT NULL DEFAULT FALSE,
  is_retail_product       BOOLEAN NOT NULL DEFAULT FALSE,
  npc_min_liquidity       DOUBLE PRECISION NOT NULL DEFAULT 0,
  npc_target_market_share DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE
);

-- Dış ticaret config'i — docs/12 §3
CREATE TABLE world_market (
  product_id        SMALLINT PRIMARY KEY REFERENCES products(id),
  importable        BOOLEAN NOT NULL DEFAULT FALSE,
  exportable        BOOLEAN NOT NULL DEFAULT FALSE,
  base_price_usd    BIGINT NOT NULL CHECK (base_price_usd > 0),
  world_price_index DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  export_multiplier DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  import_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.35,
  export_depth_pct  DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  import_depth_pct  DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  world_quality     NUMERIC(6,3) NOT NULL DEFAULT 70,
  -- Band daralırsa yurt içi fiyat keşfi ölür (R18)
  CONSTRAINT band_wide_enough CHECK (import_multiplier - export_multiplier >= 0.40)
);

CREATE TABLE facility_types (
  id                 SMALLINT PRIMARY KEY,
  code               TEXT UNIQUE NOT NULL,
  name               TEXT NOT NULL,
  category           facility_cat NOT NULL,
  base_cost          BIGINT NOT NULL CHECK (base_cost > 0),
  base_capacity      DOUBLE PRECISION NOT NULL DEFAULT 0,
  maintenance_cost   BIGINT NOT NULL DEFAULT 0,
  employee_slots     SMALLINT NOT NULL DEFAULT 0,
  storage_capacity   BIGINT NOT NULL DEFAULT 0,
  construction_ticks SMALLINT NOT NULL DEFAULT 1,
  upgrade_multiplier DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  unlock_level       SMALLINT NOT NULL DEFAULT 1,
  requires_port      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE facility_level_curve (
  level               SMALLINT PRIMARY KEY CHECK (level BETWEEN 1 AND 30),
  capacity_multiplier DOUBLE PRECISION NOT NULL,
  cost_exponent       DOUBLE PRECISION NOT NULL DEFAULT 1.55
);

CREATE TABLE production_recipes (
  id                SERIAL PRIMARY KEY,
  facility_type_id  SMALLINT NOT NULL REFERENCES facility_types(id),
  output_product_id SMALLINT NOT NULL REFERENCES products(id),
  output_quantity   BIGINT NOT NULL CHECK (output_quantity > 0),
  cycle_ticks       SMALLINT NOT NULL DEFAULT 1 CHECK (cycle_ticks > 0),
  labor_cost        BIGINT NOT NULL DEFAULT 0,
  energy_cost       BIGINT NOT NULL DEFAULT 0,
  unlock_level      SMALLINT NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (facility_type_id, output_product_id)
);

CREATE TABLE recipe_inputs (
  recipe_id   INTEGER NOT NULL REFERENCES production_recipes(id) ON DELETE CASCADE,
  product_id  SMALLINT NOT NULL REFERENCES products(id),
  quantity    BIGINT NOT NULL CHECK (quantity > 0),
  min_quality NUMERIC(6,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (recipe_id, product_id)
);

-- Kredi limiti/faizi kod içine gömülmez — docs/09 F5
CREATE TABLE loan_terms (
  level_min            SMALLINT PRIMARY KEY,
  leverage_ratio       DOUBLE PRECISION NOT NULL CHECK (leverage_ratio > 0 AND leverage_ratio <= 1),
  interest_rate        DOUBLE PRECISION NOT NULL CHECK (interest_rate >= 0),
  max_term_ticks       INTEGER NOT NULL CHECK (max_term_ticks > 0),
  default_after_missed SMALLINT NOT NULL DEFAULT 3
);

-- Versiyonlu denge config'i — R12 (config değişikliği koşan turu bozmasın)
CREATE TABLE game_configs (
  key                 TEXT NOT NULL,
  version             INTEGER NOT NULL,
  value               JSONB NOT NULL,
  effective_from_tick BIGINT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, version)
);

CREATE TABLE admin_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   UUID NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  before_val JSONB,
  after_val  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- ORGANIZATION
-- --------------------------------------------------------------------------
CREATE TABLE company_levels (
  level                      SMALLINT PRIMARY KEY,
  required_xp                BIGINT NOT NULL DEFAULT 0,
  required_company_value     BIGINT NOT NULL DEFAULT 0,
  required_trade_volume      BIGINT NOT NULL DEFAULT 0,
  required_units_produced    BIGINT NOT NULL DEFAULT 0,
  required_distinct_products SMALLINT NOT NULL DEFAULT 0,
  title                      TEXT NOT NULL
);

CREATE TABLE companies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  kind               company_kind NOT NULL,
  system_code        TEXT UNIQUE,
  name               TEXT NOT NULL,
  cash               BIGINT NOT NULL DEFAULT 0,
  usd_balance        BIGINT NOT NULL DEFAULT 0,
  level              SMALLINT NOT NULL DEFAULT 1,
  experience         BIGINT NOT NULL DEFAULT 0,
  reputation         NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (reputation BETWEEN 0 AND 100),
  home_city_id       SMALLINT NOT NULL REFERENCES cities(id),
  logistics_modifier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  company_value      BIGINT NOT NULL DEFAULT 0,
  status             company_status NOT NULL DEFAULT 'ACTIVE',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at     TIMESTAMPTZ,
  -- Sistem şirketleri muaf: SYS_CONSUMER musluk olduğu için tanımı gereği negatiftir,
  -- SYS_FX/SYS_WORLD dolaşımdaki USD'yi negatif pozisyon olarak taşır.
  CONSTRAINT cash_non_negative CHECK (kind = 'SYSTEM' OR cash >= 0),
  CONSTRAINT usd_non_negative  CHECK (kind = 'SYSTEM' OR usd_balance >= 0),
  CONSTRAINT sys_code_only_for_system CHECK ((kind = 'SYSTEM') = (system_code IS NOT NULL)),
  CONSTRAINT player_has_user CHECK (kind <> 'PLAYER' OR user_id IS NOT NULL)
);
CREATE INDEX companies_kind_status ON companies (kind, status);
CREATE INDEX companies_leaderboard ON companies (company_value DESC)
  WHERE kind = 'PLAYER' AND status = 'ACTIVE';
CREATE INDEX companies_home_city ON companies (home_city_id);

CREATE TABLE company_stats (
  company_id                 UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  total_units_produced       BIGINT NOT NULL DEFAULT 0,
  total_trade_volume         BIGINT NOT NULL DEFAULT 0,
  total_retail_revenue       BIGINT NOT NULL DEFAULT 0,
  distinct_products_produced SMALLINT NOT NULL DEFAULT 0,
  distinct_cities            SMALLINT NOT NULL DEFAULT 1,
  facilities_built           INTEGER NOT NULL DEFAULT 0,
  peak_company_value         BIGINT NOT NULL DEFAULT 0
);

-- --------------------------------------------------------------------------
-- SIMULATION — tick durum makinesi
-- --------------------------------------------------------------------------
CREATE TABLE economic_ticks (
  id             BIGSERIAL PRIMARY KEY,
  seq            BIGINT UNIQUE NOT NULL,
  scheduled_at   TIMESTAMPTZ NOT NULL,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  status         tick_status NOT NULL DEFAULT 'PENDING',
  is_catch_up    BOOLEAN NOT NULL DEFAULT FALSE,
  config_version JSONB NOT NULL DEFAULT '{}'::jsonb,
  rng_seed       BIGINT NOT NULL,
  season         SMALLINT NOT NULL DEFAULT 0,
  duration_ms    INTEGER,
  metrics        JSONB
);
CREATE INDEX economic_ticks_status ON economic_ticks (status) WHERE status <> 'COMPLETED';

CREATE TABLE tick_phase_runs (
  tick_id      BIGINT NOT NULL REFERENCES economic_ticks(id) ON DELETE CASCADE,
  phase        SMALLINT NOT NULL,
  phase_code   TEXT NOT NULL,
  shard_total  SMALLINT NOT NULL DEFAULT 1,
  shard_done   SMALLINT NOT NULL DEFAULT 0,
  status       phase_status NOT NULL DEFAULT 'PENDING',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error        TEXT,
  PRIMARY KEY (tick_id, phase)
);

-- --------------------------------------------------------------------------
-- FINANCE — çift taraflı defter (para arzının tek doğruluk kaynağı)
-- --------------------------------------------------------------------------
CREATE TABLE ledger_entries (
  tick_id          BIGINT   NOT NULL,
  tx_id            UUID     NOT NULL,
  company_id       UUID     NOT NULL,
  counterparty_id  UUID,
  direction        ledger_dir NOT NULL,
  currency         currency_t NOT NULL DEFAULT 'TRY',
  amount           BIGINT   NOT NULL CHECK (amount > 0),
  account          TEXT     NOT NULL,
  reason           TEXT     NOT NULL,
  ref_type         TEXT,
  ref_id           TEXT,
  rounding_residue BIGINT   NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ★ Idempotency: aynı tx aynı turda iki kez yazılamaz (docs/05 §3 katman 2)
  PRIMARY KEY (tick_id, tx_id, company_id, direction)
) PARTITION BY RANGE (tick_id);

CREATE INDEX ledger_company_tick ON ledger_entries (company_id, tick_id);
CREATE INDEX ledger_account_tick ON ledger_entries (account, currency, tick_id);

-- --------------------------------------------------------------------------
-- OUTBOX — tick transaction'ı içinde push gönderme yasağının uygulama noktası
-- --------------------------------------------------------------------------
CREATE TABLE outbox (
  id           BIGSERIAL PRIMARY KEY,
  topic        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  tick_id      BIGINT,
  dedupe_key   TEXT UNIQUE,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX outbox_pending ON outbox (id) WHERE published_at IS NULL;

-- --------------------------------------------------------------------------
-- Partition yardımcısı — 1 bölüm = 1 gün (96 tick). R7: sonradan eklemek
-- tablo yeniden yazımı demek, o yüzden ilk migration'da.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_tick_partition(p_table TEXT, p_day BIGINT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_from BIGINT := p_day * 96;
  v_to   BIGINT := (p_day + 1) * 96;
  v_name TEXT   := format('%s_d%s', p_table, p_day);
BEGIN
  IF to_regclass(v_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%s) TO (%s)',
      v_name, p_table, v_from, v_to);
  END IF;
  RETURN v_name;
END $$;

-- İlk 14 günlük bölümler + taşma için DEFAULT
SELECT ensure_tick_partition('ledger_entries', d) FROM generate_series(0, 13) AS d;
CREATE TABLE ledger_entries_default PARTITION OF ledger_entries DEFAULT;
