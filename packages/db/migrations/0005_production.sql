-- =============================================================================
-- 0005 · Üretim işleri — F3
-- docs/03 §4 · docs/05 P1 (PRODUCE fazı)
-- =============================================================================

CREATE TYPE production_status AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED');

/*
 * Çok turlu üretim döngüleri.
 *
 * Girdiler işin BAŞINDA tüketilir, çıktı BİTİŞİNDE eklenir. `cycle_ticks = 1`
 * olan reçeteler aynı turda başlayıp biter — tek kod yolu, özel durum yok.
 *
 * `UNIQUE (facility_id, started_tick)` idempotency anahtarıdır: P1 fazı tekrar
 * koşarsa aynı tesis aynı turda ikinci kez üretime başlayamaz (docs/05 §3).
 */
CREATE TABLE production_jobs (
  id             BIGSERIAL PRIMARY KEY,
  facility_id    UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipe_id      INTEGER NOT NULL REFERENCES production_recipes(id),
  started_tick   BIGINT NOT NULL,
  complete_tick  BIGINT NOT NULL,
  planned_output BIGINT NOT NULL CHECK (planned_output > 0),
  input_quality  NUMERIC(6,3) NOT NULL,
  output_quality NUMERIC(6,3) NOT NULL,
  input_cost     BIGINT NOT NULL DEFAULT 0,
  unit_cost      BIGINT NOT NULL DEFAULT 0,
  status         production_status NOT NULL DEFAULT 'RUNNING',
  CONSTRAINT one_job_per_facility_per_tick UNIQUE (facility_id, started_tick)
);
CREATE INDEX production_jobs_pending ON production_jobs (complete_tick)
  WHERE status = 'RUNNING';
CREATE INDEX production_jobs_company ON production_jobs (company_id, started_tick);

-- Tur başına tesis üretim özeti — raporlama ve "neden durdu" teşhisi
CREATE TABLE production_records (
  tick_id       BIGINT NOT NULL,
  facility_id   UUID NOT NULL,
  company_id    UUID NOT NULL,
  recipe_id     INTEGER NOT NULL,
  product_id    SMALLINT NOT NULL,
  capacity      BIGINT NOT NULL,
  produced      BIGINT NOT NULL,
  output_quality NUMERIC(6,3) NOT NULL,
  input_cost    BIGINT NOT NULL DEFAULT 0,
  overhead_cost BIGINT NOT NULL DEFAULT 0,
  halted_reason TEXT,
  PRIMARY KEY (tick_id, facility_id)
) PARTITION BY RANGE (tick_id);
CREATE INDEX production_records_company ON production_records (company_id, tick_id);

SELECT ensure_tick_partition('production_records', d) FROM generate_series(0, 13) AS d;
CREATE TABLE production_records_default PARTITION OF production_records DEFAULT;

-- Üretim yapan tesis hangi reçeteyi koşuyor — F1'de alan vardı, artık kullanılıyor.
COMMENT ON COLUMN facilities.active_recipe_id IS
  'Tesisin o an koştuğu reçete. NULL ise üretim yapmaz (perakende/lojistik tesisleri).';
