-- =============================================================================
-- 0003 · Perakende, piyasa ve tur çıktıları — F2 (MVP-0)
-- docs/03 §5–§7 · docs/05 (tick fazları)
-- =============================================================================

CREATE TYPE order_side   AS ENUM ('BUY','SELL');
CREATE TYPE order_status AS ENUM ('OPEN','PARTIAL','FILLED','CANCELLED','EXPIRED');

-- --------------------------------------------------------------------------
-- Toptan piyasa. F2'de yalnız NPC SELL emirleri + anında doldurma kullanılır;
-- tam emir defteri eşleştirmesi, escrow ve sevkiyat F4'te gelir.
-- --------------------------------------------------------------------------
CREATE TABLE market_orders (
  id                    BIGSERIAL PRIMARY KEY,
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  facility_id           UUID REFERENCES facilities(id) ON DELETE CASCADE,
  product_id            SMALLINT NOT NULL REFERENCES products(id),
  city_id               SMALLINT NOT NULL REFERENCES cities(id),
  side                  order_side NOT NULL,
  quantity              BIGINT NOT NULL CHECK (quantity > 0),
  remaining_quantity    BIGINT NOT NULL,
  price_per_unit        BIGINT NOT NULL CHECK (price_per_unit > 0),
  quality               NUMERIC(6,3) NOT NULL DEFAULT 70,
  min_quality           NUMERIC(6,3) NOT NULL DEFAULT 0,
  max_delivery_distance DOUBLE PRECISION,
  escrow_amount         BIGINT NOT NULL DEFAULT 0,
  status                order_status NOT NULL DEFAULT 'OPEN',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at_tick       BIGINT NOT NULL,
  CONSTRAINT remaining_valid CHECK (remaining_quantity BETWEEN 0 AND quantity)
);
-- Eşleştirme motorunun ana index'i: emir defteri (ürün, şehir, taraf, fiyat)
CREATE INDEX orders_book ON market_orders (product_id, city_id, side, price_per_unit, id)
  WHERE status IN ('OPEN','PARTIAL');
CREATE INDEX orders_by_company ON market_orders (company_id, status);
CREATE INDEX orders_expiring ON market_orders (expires_at_tick)
  WHERE status IN ('OPEN','PARTIAL');

CREATE TABLE market_trades (
  id                BIGSERIAL,
  tick_id           BIGINT NOT NULL,
  buy_order_id      BIGINT,
  sell_order_id     BIGINT,
  buyer_company_id  UUID NOT NULL,
  seller_company_id UUID NOT NULL,
  product_id        SMALLINT NOT NULL,
  from_city_id      SMALLINT NOT NULL,
  to_city_id        SMALLINT NOT NULL,
  quantity          BIGINT NOT NULL,
  price_per_unit    BIGINT NOT NULL,
  quality           NUMERIC(6,3) NOT NULL,
  shipping_cost     BIGINT NOT NULL DEFAULT 0,
  -- Wash trade / aşırı uç işlem: ticaret İPTAL EDİLMEZ, yalnız endeksi kirletemez (madde 48)
  is_excluded_from_index BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tick_id, id)
) PARTITION BY RANGE (tick_id);
CREATE INDEX trades_for_index ON market_trades (product_id, tick_id) WHERE NOT is_excluded_from_index;
CREATE INDEX trades_bilateral ON market_trades (buyer_company_id, seller_company_id, tick_id);

-- --------------------------------------------------------------------------
-- PERAKENDE — mağazalar NPC tüketicilere satar (madde 18)
-- --------------------------------------------------------------------------
CREATE TABLE retail_offers (
  facility_id   UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  product_id    SMALLINT NOT NULL REFERENCES products(id),
  selling_price BIGINT NOT NULL CHECK (selling_price > 0),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (facility_id, product_id)
);
CREATE INDEX retail_active ON retail_offers (product_id) WHERE enabled;

-- Tur başına şehir×ürün talep fotoğrafı. demand_budget R10'un uygulama noktası.
CREATE TABLE city_demand (
  tick_id         BIGINT NOT NULL,
  city_id         SMALLINT NOT NULL REFERENCES cities(id),
  product_id      SMALLINT NOT NULL REFERENCES products(id),
  demand_units    BIGINT NOT NULL,
  demand_budget   BIGINT NOT NULL,
  fulfilled_units BIGINT NOT NULL DEFAULT 0,
  budget_limited_units BIGINT NOT NULL DEFAULT 0,
  avg_price       BIGINT,
  PRIMARY KEY (tick_id, city_id, product_id)
) PARTITION BY RANGE (tick_id);

-- ★ Tek tek tüketici işlemi ASLA saklanmaz: tur×tesis×ürün başına TEK satır.
--   10.000 aktif şirket × 3 tesis × 3 ürün × 96 tur = günde 8,6M satır olurdu (R7).
--   Bu PK aynı zamanda idempotency'nin 2. katmanıdır (docs/05 §3).
CREATE TABLE retail_sales (
  tick_id      BIGINT NOT NULL,
  facility_id  UUID NOT NULL,
  product_id   SMALLINT NOT NULL,
  company_id   UUID NOT NULL,
  city_id      SMALLINT NOT NULL,
  quantity     BIGINT NOT NULL,
  unit_price   BIGINT NOT NULL,
  revenue      BIGINT NOT NULL,
  cogs         BIGINT NOT NULL,
  avg_quality  NUMERIC(6,3) NOT NULL,
  market_share DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (tick_id, facility_id, product_id)
) PARTITION BY RANGE (tick_id);
CREATE INDEX retail_sales_company ON retail_sales (company_id, tick_id);

-- --------------------------------------------------------------------------
-- TUR ÇIKTILARI
-- --------------------------------------------------------------------------
CREATE TABLE price_history (
  tick_id         BIGINT NOT NULL,
  product_id      SMALLINT NOT NULL REFERENCES products(id),
  city_id         SMALLINT,                       -- NULL = ulusal
  weighted_median BIGINT NOT NULL,
  ema_reference   BIGINT NOT NULL,
  open_price      BIGINT, high_price BIGINT, low_price BIGINT, close_price BIGINT,
  volume          BIGINT NOT NULL DEFAULT 0,
  trade_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tick_id, product_id, city_id)
) PARTITION BY RANGE (tick_id);

CREATE TABLE company_financials (
  tick_id         BIGINT NOT NULL,
  company_id      UUID NOT NULL,
  revenue         BIGINT NOT NULL DEFAULT 0,
  cogs            BIGINT NOT NULL DEFAULT 0,
  salary_cost     BIGINT NOT NULL DEFAULT 0,
  maintenance     BIGINT NOT NULL DEFAULT 0,
  shipping_cost   BIGINT NOT NULL DEFAULT 0,
  interest_cost   BIGINT NOT NULL DEFAULT 0,
  tax             BIGINT NOT NULL DEFAULT 0,
  capex           BIGINT NOT NULL DEFAULT 0,
  net_profit      BIGINT NOT NULL DEFAULT 0,
  cash_close      BIGINT NOT NULL,
  inventory_value BIGINT NOT NULL DEFAULT 0,
  facility_value  BIGINT NOT NULL DEFAULT 0,
  debt            BIGINT NOT NULL DEFAULT 0,
  company_value   BIGINT NOT NULL,
  PRIMARY KEY (tick_id, company_id)
) PARTITION BY RANGE (tick_id);

-- Madde 46: oyuncu hangi tesisten para kazandığını görebilmeli
CREATE TABLE facility_financials (
  tick_id     BIGINT NOT NULL,
  facility_id UUID NOT NULL,
  company_id  UUID NOT NULL,
  revenue     BIGINT NOT NULL DEFAULT 0,
  cogs        BIGINT NOT NULL DEFAULT 0,
  salary      BIGINT NOT NULL DEFAULT 0,
  rent        BIGINT NOT NULL DEFAULT 0,
  shipping    BIGINT NOT NULL DEFAULT 0,
  maintenance BIGINT NOT NULL DEFAULT 0,
  net_profit  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tick_id, facility_id)
) PARTITION BY RANGE (tick_id);
CREATE INDEX facility_financials_company ON facility_financials (company_id, tick_id);

CREATE TABLE economy_snapshots (
  tick_id              BIGINT PRIMARY KEY,
  total_money_supply   NUMERIC(38,4) NOT NULL,
  player_money         NUMERIC(38,4) NOT NULL,
  npc_money            NUMERIC(38,4) NOT NULL,
  faucet_in            NUMERIC(38,4) NOT NULL,
  sink_out             NUMERIC(38,4) NOT NULL,
  game_cpi             DOUBLE PRECISION NOT NULL DEFAULT 1,
  median_company_value BIGINT NOT NULL DEFAULT 0,
  active_companies     INTEGER NOT NULL DEFAULT 0,
  bankruptcies_24h     INTEGER NOT NULL DEFAULT 0
);

-- İlk 14 günlük bölümler + taşma için DEFAULT (R7)
SELECT ensure_tick_partition(t, d)
FROM   unnest(ARRAY['market_trades','city_demand','retail_sales','price_history',
                    'company_financials','facility_financials']) AS t,
       generate_series(0, 13) AS d;

CREATE TABLE market_trades_default       PARTITION OF market_trades       DEFAULT;
CREATE TABLE city_demand_default         PARTITION OF city_demand         DEFAULT;
CREATE TABLE retail_sales_default        PARTITION OF retail_sales        DEFAULT;
CREATE TABLE price_history_default       PARTITION OF price_history       DEFAULT;
CREATE TABLE company_financials_default  PARTITION OF company_financials  DEFAULT;
CREATE TABLE facility_financials_default PARTITION OF facility_financials DEFAULT;
