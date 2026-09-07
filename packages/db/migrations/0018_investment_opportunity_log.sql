-- NPC yatırım kararının GİRDİLERİNİ kaydeder (R61 teşhisi).
--
-- Sermayenin neden bir ürüne akıp ötekine akmadığını üç kez dolaylı
-- sinyallerden okumaya çalıştım ve üçünde de yanlış okudum (R54, R59, R60).
-- Bu tablo tahmini bitirir: kararın kullandığı sayılar, karar anında,
-- oldukları gibi yazılır.
--
-- ★ Model BURADA YENİDEN YAZILMAZ. Satırlar `loadOpportunities` çıktısından
--   ve gerçek `investmentScore` çağrısından gelir. Teşhis sorgusunun kendi
--   kopyasını hesaplaması, testin kendi modelini doğrulamasıyla aynı hataydı
--   (R46) — o yüzden burada yalnız SAKLAMA var, hesap yok.
--
-- Yalnız teşhis içindir: hiçbir oyun mekaniği bu tabloyu OKUMAZ.
CREATE TABLE investment_opportunities (
  tick_id         BIGINT   NOT NULL,
  product_id      SMALLINT NOT NULL REFERENCES products(id),
  -- investmentScore bileşenleri — ağırlıklandırılmamış ham değerler
  margin          DOUBLE PRECISION NOT NULL,
  demand_gap      DOUBLE PRECISION NOT NULL,
  price_trend     DOUBLE PRECISION NOT NULL,
  strategic_need  DOUBLE PRECISION NOT NULL,
  competition     DOUBLE PRECISION NOT NULL,
  -- NPC iştahı uygulanmamış temel skor ve eşik
  score           DOUBLE PRECISION NOT NULL,
  threshold       DOUBLE PRECISION NOT NULL,
  -- Açık ve yoldaki kapasite: skor yetse bile bu kapı yatırımı durdurabilir
  gap_per_tick    DOUBLE PRECISION NOT NULL,
  pipeline_per_tick DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (tick_id, product_id)
);

COMMENT ON TABLE investment_opportunities IS
  'NPC yatırım kararının ham girdileri — yalnız teşhis, mekanik okumaz (R61).';
