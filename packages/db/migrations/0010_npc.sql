-- =============================================================================
-- 0010 · NPC ajanları — F6
-- docs/07 §9 (arketipler) · madde 24–27
--
-- NPC'ler gerçek şirketlerdir: aynı tablolar, aynı kurallar, aynı defter.
-- Ayrıcalıkları yoktur — yalnız kararlarını insan yerine kod verir.
-- =============================================================================

CREATE TABLE npc_profiles (
  company_id              UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  archetype               TEXT NOT NULL,
  risk_tolerance          DOUBLE PRECISION NOT NULL,
  target_margin           DOUBLE PRECISION NOT NULL,
  quality_target          DOUBLE PRECISION NOT NULL,
  /** Kaç turluk stok hedefleniyor (madde 26). */
  inventory_target_ticks  SMALLINT NOT NULL,
  /** 0 = maliyet+marj fiyatlar · 1 = tamamen piyasayı takip eder. */
  price_aggressiveness    DOUBLE PRECISION NOT NULL,
  investment_aggressiveness DOUBLE PRECISION NOT NULL,
  preferred_sectors       SMALLINT[] NOT NULL DEFAULT '{}',
  max_debt_ratio          DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  cash_reserve_ratio      DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  /** Stratejik kararlar her turda değil, bu aralıkla verilir (maliyet). */
  strategy_interval_ticks SMALLINT NOT NULL DEFAULT 96,
  last_strategy_tick      BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX npc_profiles_strategy ON npc_profiles (last_strategy_tick);

/*
 * Economic Director'ın NPC'ye TEK yazma kanalı (docs/07 §2, ADR-0004).
 * F6'da tablo oluşturulur ve NPC'ler direktifleri okumaya başlar;
 * direktifleri ÜRETEN Economic Director F7'de gelir.
 */
CREATE TABLE npc_directives (
  id                    BIGSERIAL PRIMARY KEY,
  issued_tick           BIGINT NOT NULL,
  expires_tick          BIGINT NOT NULL,
  scope                 TEXT NOT NULL,
  product_id            SMALLINT REFERENCES products(id),
  city_id               SMALLINT REFERENCES cities(id),
  lever                 TEXT NOT NULL,
  magnitude             DOUBLE PRECISION NOT NULL CHECK (magnitude BETWEEN -1 AND 1),
  reason                TEXT NOT NULL,
  health_score_at_issue NUMERIC(5,2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lever_known CHECK (lever IN (
    'INVENTORY_TARGET','PRODUCTION_BIAS','BUY_BIAS','INVESTMENT_BIAS',
    'CAPACITY_CAP','IMPORT_QUOTA'))
);
CREATE INDEX npc_directives_active ON npc_directives (product_id, expires_tick);

-- Tur başına NPC karar günlüğü — "NPC neden böyle davrandı" sorusunun cevabı
CREATE TABLE npc_decisions (
  tick_id     BIGINT NOT NULL,
  company_id  UUID NOT NULL,
  product_id  SMALLINT NOT NULL,
  kind        TEXT NOT NULL,          -- 'PRICE' | 'BUY' | 'SELL' | 'INVEST'
  old_value   BIGINT,
  new_value   BIGINT,
  reason      TEXT NOT NULL,
  PRIMARY KEY (tick_id, company_id, product_id, kind)
) PARTITION BY RANGE (tick_id);
CREATE INDEX npc_decisions_company ON npc_decisions (company_id, tick_id);

SELECT ensure_tick_partition('npc_decisions', d) FROM generate_series(0, 13) AS d;
CREATE TABLE npc_decisions_default PARTITION OF npc_decisions DEFAULT;

COMMENT ON TABLE npc_profiles IS
  'NPC karakteri. Hepsi aynı davranmaz — 8 arketip, parametreler ±%15 dağıtılır (madde 24).';
COMMENT ON TABLE npc_directives IS
  'Economic Director''ın NPC''ye TEK yazma kanalı. ED fiyat belirleyemez, emir veremez (ADR-0004).';
