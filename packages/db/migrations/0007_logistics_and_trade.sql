-- =============================================================================
-- 0007 · Sevkiyat, anti-manipülasyon, döviz ve dış ticaret — F4
-- docs/03 §5 · docs/12 (döviz spesifikasyonu)
-- =============================================================================

CREATE TYPE shipment_status AS ENUM ('IN_TRANSIT', 'DELIVERED', 'PARTIAL', 'CANCELLED');
CREATE TYPE trade_direction AS ENUM ('IMPORT', 'EXPORT');

/*
 * SEVKİYAT — A3 kararının uygulama noktası.
 *
 * Mesafe yalnız maliyet değil SÜREdir: mal yola çıkınca satıcının stoğundan
 * düşer, alıcıya `arrival_tick`'te ulaşır. Arada hiçbir envanterde değildir.
 * Bu olmadan lojistik bir vergiden ibaret kalır ve "şehirler arası ticaret
 * stratejik olmalıdır" hedefi karşılanmaz.
 */
CREATE TABLE shipments (
  id                 BIGSERIAL PRIMARY KEY,
  tick_id            BIGINT NOT NULL,
  trade_tick_id      BIGINT,
  trade_id           BIGINT,
  from_company_id    UUID NOT NULL REFERENCES companies(id),
  to_company_id      UUID NOT NULL REFERENCES companies(id),
  from_facility_id   UUID REFERENCES facilities(id) ON DELETE SET NULL,
  to_facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  product_id         SMALLINT NOT NULL REFERENCES products(id),
  quantity           BIGINT NOT NULL CHECK (quantity > 0),
  delivered_quantity BIGINT NOT NULL DEFAULT 0,
  quality            NUMERIC(6,3) NOT NULL,
  unit_cost          BIGINT NOT NULL,
  shipping_cost      BIGINT NOT NULL DEFAULT 0,
  expires_at_tick    BIGINT,
  dispatched_tick    BIGINT NOT NULL,
  arrival_tick       BIGINT NOT NULL,
  status             shipment_status NOT NULL DEFAULT 'IN_TRANSIT',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivered_within_quantity CHECK (delivered_quantity BETWEEN 0 AND quantity)
);
-- Tick motorunun taradığı tek index: vadesi gelmiş sevkiyatlar (madde 54)
CREATE INDEX shipments_arriving ON shipments (arrival_tick) WHERE status IN ('IN_TRANSIT', 'PARTIAL');
CREATE INDEX shipments_by_buyer ON shipments (to_company_id, arrival_tick);

/*
 * ANTİ-MANİPÜLASYON — madde 48, risk R8.
 *
 * İşlem İPTAL EDİLMEZ: oyuncular ticaretini yapar, yalnız referans fiyat
 * endeksini kirletemez. `market_trades.is_excluded_from_index` bayrağı
 * buradaki tespite göre set edilir.
 */
CREATE TABLE trade_flags (
  id                  BIGSERIAL PRIMARY KEY,
  tick_id             BIGINT NOT NULL,
  company_a           UUID NOT NULL REFERENCES companies(id),
  company_b           UUID NOT NULL REFERENCES companies(id),
  product_id          SMALLINT NOT NULL REFERENCES products(id),
  window_start_tick   BIGINT NOT NULL,
  bilateral_volume    BIGINT NOT NULL,
  market_volume       BIGINT NOT NULL,
  bilateral_share     DOUBLE PRECISION NOT NULL,
  price_deviation_pct DOUBLE PRECISION NOT NULL,
  suspicion_score     DOUBLE PRECISION NOT NULL,
  action_taken        TEXT NOT NULL DEFAULT 'INDEX_EXCLUDED',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX trade_flags_pair ON trade_flags (company_a, company_b, tick_id);

-- --------------------------------------------------------------------------
-- DÖVİZ — docs/12. Yurt içi ekonominin tamamı ₺; USD yalnız üç yerde görünür:
-- cüzdan (companies.usd_balance), kur işlemi (fx_trades), dış ticaret.
-- --------------------------------------------------------------------------
CREATE TABLE fx_rates (
  tick_id            BIGINT PRIMARY KEY,
  rate_try_per_usd   BIGINT NOT NULL CHECK (rate_try_per_usd > 0),
  source             TEXT NOT NULL DEFAULT 'MODEL',
  trade_balance      BIGINT NOT NULL DEFAULT 0,
  usd_in_circulation BIGINT NOT NULL DEFAULT 0,
  game_cpi           DOUBLE PRECISION NOT NULL DEFAULT 1
);

CREATE TABLE fx_trades (
  id          BIGSERIAL PRIMARY KEY,
  tick_id     BIGINT NOT NULL,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  side        TEXT NOT NULL CHECK (side IN ('BUY_USD', 'SELL_USD')),
  usd_amount  BIGINT NOT NULL CHECK (usd_amount > 0),
  try_amount  BIGINT NOT NULL CHECK (try_amount > 0),
  rate        BIGINT NOT NULL,
  spread_paid BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX fx_trades_company ON fx_trades (company_id, tick_id);

/*
 * DIŞ TİCARET — docs/12 §3.
 *
 * Fiyatı OYUNCU BELİRLEMEZ: dünya fiyatı USD'de çıpalıdır ve tur başına
 * derinlik tavanlıdır. Bu iki şart olmadan ihracat, R10'un döviz kılığında
 * geri dönmesi demektir (R17).
 */
CREATE TABLE foreign_trades (
  tick_id        BIGINT NOT NULL,
  company_id     UUID NOT NULL,
  facility_id    UUID NOT NULL,
  product_id     SMALLINT NOT NULL,
  direction      trade_direction NOT NULL,
  quantity       BIGINT NOT NULL CHECK (quantity > 0),
  unit_price_usd BIGINT NOT NULL,
  usd_amount     BIGINT NOT NULL,
  try_equivalent BIGINT NOT NULL,
  quality        NUMERIC(6,3) NOT NULL,
  PRIMARY KEY (tick_id, company_id, facility_id, product_id, direction)
) PARTITION BY RANGE (tick_id);
CREATE INDEX foreign_trades_product ON foreign_trades (product_id, tick_id);

-- Tur başına ürün dış ticaret derinliği — pro-rata paylaşımın kaynağı
CREATE TABLE foreign_trade_capacity (
  tick_id         BIGINT NOT NULL,
  product_id      SMALLINT NOT NULL REFERENCES products(id),
  import_capacity BIGINT NOT NULL,
  import_used     BIGINT NOT NULL DEFAULT 0,
  export_capacity BIGINT NOT NULL,
  export_used     BIGINT NOT NULL DEFAULT 0,
  world_price_usd BIGINT NOT NULL,
  import_quota_mult DOUBLE PRECISION NOT NULL DEFAULT 1,
  PRIMARY KEY (tick_id, product_id)
) PARTITION BY RANGE (tick_id);

SELECT ensure_tick_partition(t, d)
FROM   unnest(ARRAY['foreign_trades','foreign_trade_capacity']) AS t,
       generate_series(0, 13) AS d;
CREATE TABLE foreign_trades_default        PARTITION OF foreign_trades        DEFAULT;
CREATE TABLE foreign_trade_capacity_default PARTITION OF foreign_trade_capacity DEFAULT;

COMMENT ON TABLE shipments IS
  'Mesafe = maliyet + SÜRE. Yoldaki mal hiçbir envanterde değildir (A3).';
COMMENT ON TABLE trade_flags IS
  'Wash trade tespiti. İşlem iptal edilmez, yalnız referans endeksinden çıkarılır (madde 48).';
