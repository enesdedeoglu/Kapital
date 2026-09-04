-- 0014 — Dünya olayları (F8 devamı)
--
-- ★ F7'de `world_events` adıyla bir DUYURU akışı kurulmuştu (kind, severity,
-- title, body). Oysa docs/03'teki spec tanımı bambaşka bir şey: süresi ve
-- çarpanları olan bir ETKİ tablosu (demand/supply/cost multiplier,
-- start_tick/end_tick). Doğru isim altında yanlış şey kurulmuştu.
--
-- İkisi de gerekli ama ayrı kavramlar:
--   • world_notices — oyuncuya görünen duyuru akışı (ED müdahaleleri dahil)
--   • world_events  — ekonomiye ETKİ EDEN olay (spec'teki tanım)
--
-- Bir ED müdahalesi duyurudur ama etki değildir: etkisi `npc_directives`te.
-- Bir kuraklık ise hem etkidir hem duyurulur.

ALTER TABLE world_events RENAME TO world_notices;
ALTER INDEX world_events_dedupe RENAME TO world_notices_dedupe;
ALTER INDEX world_events_recent RENAME TO world_notices_recent;

COMMENT ON TABLE world_notices IS
  'Oyuncuya görünen duyuru akışı — ED müdahaleleri ve dünya olayları buraya düşer.';

-- ---------------------------------------------------------------------------
-- Dünya olayları — docs/03, madde 30/45.
--
-- Kuraklık, bayram, enerji krizi, sağlık uyarısı... Ekonominin havasıdır.
-- Onsuz arz-talep öğütmesinden ibaret, tepki verilecek hiçbir şeyi olmayan
-- bir simülasyon kalır: spekülatörün var olma sebebi, stok tutmanın anlamı ve
-- fiyat oynaklığı (hedef %5–15, ölçülen %0,1) bu olaylardan doğar.
--
-- `created_by` NULL ise olay sistem tarafından üretilmiştir; dolu ise admin
-- panelden girilmiştir (F10).
-- ---------------------------------------------------------------------------
CREATE TABLE world_events (
  id                BIGSERIAL PRIMARY KEY,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  scope             TEXT NOT NULL,
  product_id        SMALLINT REFERENCES products(id),
  city_id           SMALLINT REFERENCES cities(id),
  -- Kategori kapsamı: 'SECTOR' olaylarında tesis kategorisi veya ürün kategorisi
  category          TEXT,
  demand_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  supply_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  cost_multiplier   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  start_tick        BIGINT NOT NULL,
  end_tick          BIGINT NOT NULL,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT world_events_scope_known
    CHECK (scope IN ('PRODUCT','SECTOR','CITY','GLOBAL')),
  CONSTRAINT world_events_window CHECK (end_tick > start_tick),
  -- Çarpanlar makul aralıkta: bir olay ekonomiyi katlayarak kıramaz.
  CONSTRAINT world_events_multipliers CHECK (
    demand_multiplier BETWEEN 0.1 AND 5
    AND supply_multiplier BETWEEN 0.1 AND 5
    AND cost_multiplier BETWEEN 0.1 AND 5
  ),
  -- Kapsam ile alan tutarlı olmalı: ürün olayının ürünü, şehir olayının şehri olur.
  CONSTRAINT world_events_scope_fields CHECK (
    (scope = 'PRODUCT' AND product_id IS NOT NULL)
    OR (scope = 'CITY' AND city_id IS NOT NULL)
    OR (scope = 'SECTOR' AND category IS NOT NULL)
    OR scope = 'GLOBAL'
  )
);

CREATE INDEX world_events_window ON world_events (start_tick, end_tick);
CREATE INDEX world_events_active ON world_events (end_tick) WHERE end_tick > 0;

-- Aynı olay aynı anda iki kez başlamasın (aynı kod + aynı kapsam + açık pencere).
CREATE UNIQUE INDEX world_events_no_overlap
  ON world_events (code, COALESCE(product_id, 0), COALESCE(city_id, 0), start_tick);

-- ---------------------------------------------------------------------------
-- Spec'te (docs/03) `economy_snapshots` içinde tanımlıydı ama eklenmemişti.
-- Medyan tek başına dağılımı anlatmaz: F8 ölçümünde p50 30.000 ₺ iken
-- p90 165.926 ₺ çıktı. Bu oran o iki kutupluluğu tek sayıda gösterir.
-- ---------------------------------------------------------------------------
ALTER TABLE economy_snapshots ADD COLUMN p99_to_median_ratio DOUBLE PRECISION;

COMMENT ON COLUMN economy_snapshots.p99_to_median_ratio IS
  'En üst %1 / medyan şirket değeri — servet yoğunlaşmasının tek sayılık özeti.';
