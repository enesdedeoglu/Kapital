-- 0012 — Ekonomi Direktörü (F7)
--
-- ED ekonomiyi yönetmez, SINIRLARINI korur (ADR-0004). Bu migration onun
-- ölçüm yüzeyini (market_health), müdahale kaydını (world_events) ve
-- eşitsizlik göstergesini (economy_snapshots.gini) ekler.
--
-- Direktiflerin kendisi (`npc_directives`) F0'da kurulmuştu.

-- ---------------------------------------------------------------------------
-- Piyasa sağlık skoru — madde 29
--
-- Ürün × şehir bazında. city_id = 0 ULUSAL demektir (price_history ile aynı
-- sözleşme, 0004'teki karar): NULL bir birincil anahtar kolonunda kullanılamaz.
-- ---------------------------------------------------------------------------
CREATE TABLE market_health (
  tick_id        BIGINT NOT NULL,
  product_id     SMALLINT NOT NULL REFERENCES products(id),
  city_id        SMALLINT NOT NULL DEFAULT 0,
  score          NUMERIC(5,2) NOT NULL,
  band           TEXT NOT NULL,
  -- Ham ölçümler: skor türetilmiş bir sayıdır, kaynağı görünmezse ne ED'nin
  -- kararı ne NPC'nin yatırımı denetlenebilir.
  supply_units   BIGINT NOT NULL DEFAULT 0,
  demand_units   BIGINT NOT NULL DEFAULT 0,
  -- Bileşenler ayrı tutulur: skor düştüğünde HANGİ bileşenin çektiği
  -- görünmezse ED'nin kararı da denetlenemez.
  f_supply       DOUBLE PRECISION NOT NULL,
  f_sellers      DOUBLE PRECISION NOT NULL,
  f_buyers       DOUBLE PRECISION NOT NULL,
  f_depth        DOUBLE PRECISION NOT NULL,
  f_stability    DOUBLE PRECISION NOT NULL,
  f_player_share DOUBLE PRECISION NOT NULL,
  -- Histerezis sayacı: bant değişimi için eşiğin üst üste aşılması gerekir.
  streak_band    TEXT,
  streak_count   SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tick_id, product_id, city_id),
  CONSTRAINT band_known CHECK (band IN ('HEALTHY','WATCH','ADJUST','STIMULATE','EMERGENCY')),
  CONSTRAINT score_range CHECK (score >= 0 AND score <= 100)
) PARTITION BY RANGE (tick_id);

CREATE TABLE market_health_default PARTITION OF market_health DEFAULT;
SELECT ensure_tick_partition('market_health', d) FROM generate_series(0, 13) AS d;

CREATE INDEX market_health_product ON market_health (product_id, tick_id DESC);

-- ---------------------------------------------------------------------------
-- Dünya olayları — ED'nin ve adminin görünür müdahale kaydı
--
-- Her acil müdahale buraya düşer (madde 32). Oyuncu "sistem hile yaptı"
-- demesin diye olay AÇIKÇA duyurulur: ithalat kapısı açıldı, rezerv satışa
-- çıktı, kota değişti.
-- ---------------------------------------------------------------------------
CREATE TABLE world_events (
  id           BIGSERIAL PRIMARY KEY,
  tick_id      BIGINT NOT NULL,
  kind         TEXT NOT NULL,
  product_id   SMALLINT REFERENCES products(id),
  city_id      SMALLINT REFERENCES cities(id),
  severity     TEXT NOT NULL DEFAULT 'INFO',
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Aynı olay her turda tekrar duyurulmasın: doğal anahtar.
  dedupe_key   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT severity_known CHECK (severity IN ('INFO','WARNING','CRITICAL'))
);

CREATE UNIQUE INDEX world_events_dedupe ON world_events (dedupe_key);
CREATE INDEX world_events_recent ON world_events (tick_id DESC);

-- ---------------------------------------------------------------------------
-- Gini katsayısı — servet eşitsizliği (yol haritası F7)
--
-- 0 = tam eşitlik, 1 = tek şirkette toplanma. Ekonominin "sağlıklı" görünüp
-- aslında tek oyuncuya akmasını yakalar; para arzı ve CPI bunu göstermez.
-- ---------------------------------------------------------------------------
ALTER TABLE economy_snapshots ADD COLUMN gini DOUBLE PRECISION;

COMMENT ON COLUMN economy_snapshots.gini IS
  'Şirket değeri dağılımının Gini katsayısı — 0 eşit, 1 tekelleşmiş.';
