-- 0015 — Kalıcı emirler: oyuncu yokken de şirket çalışsın
--
-- docs/00'ın 3. ilkesi "oyuncu offline'ken ekonomi devam eder" diyor. Motor
-- gerçekten devam ediyor — ama OYUNCUYA offline'ken katılma yolu verilmemişti.
-- Sonuç: girmeyen oyuncunun rafı boşalıyor, satışı duruyor, bakımı işlemeye
-- devam ediyor. Ekonomi devam ediyor, oyuncu geriliyor.
--
-- Ölçüldü (F8): 60 oyuncunun medyan şirket değeri 38.103 ₺, p75 ise
-- 147.661 ₺. Aradaki farkı yaratan şey yetenek değil, GİRİŞ SIKLIĞI.
--
-- Spec'in cevabı çalışan sistemi (madde 38) ama o F11'e ertelendi (docs/11 B2).
-- Kalıcı emir daha küçük ve daha dürüst bir çözümdür: oyuncu KURALI kendisi
-- tanımlar, motor yalnız uygular. Gizli bir sübvansiyon değil, delege edilmiş
-- bir karardır — NPC'lerin yaptığının aynısını oyuncu kendi şirketine
-- söyleyebilir.

CREATE TABLE standing_orders (
  id              BIGSERIAL PRIMARY KEY,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  product_id      SMALLINT NOT NULL REFERENCES products(id),
  kind            TEXT NOT NULL,
  -- Elde tutulmak istenen miktar. RESTOCK bunun altına düşünce alır,
  -- SELL_SURPLUS bunun üstünü satar.
  target_quantity BIGINT NOT NULL,
  -- RESTOCK: bu fiyatın üstüne teklif verilmez. NULL ise referanstan türetilir.
  max_price       BIGINT,
  -- SELL_SURPLUS: bu fiyatın altına satılmaz. NULL ise maliyet+marj kullanılır.
  min_price       BIGINT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_tick   BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT standing_orders_kind CHECK (kind IN ('RESTOCK', 'SELL_SURPLUS')),
  CONSTRAINT standing_orders_target_positive CHECK (target_quantity > 0),
  CONSTRAINT standing_orders_prices_positive CHECK (
    (max_price IS NULL OR max_price > 0) AND (min_price IS NULL OR min_price > 0)
  ),
  -- Aynı tesiste aynı ürün için aynı türden tek kural.
  CONSTRAINT standing_orders_unique UNIQUE (facility_id, product_id, kind)
);

CREATE INDEX standing_orders_active ON standing_orders (company_id) WHERE enabled;

COMMENT ON TABLE standing_orders IS
  'Oyuncunun önceden tanımladığı kural — motor her tur uygular. Offline oyuncunun şirketi durmasın diye.';
