-- 0013 — Şirket seviye ilerleyişi (F8)
--
-- `company_levels` F0'da tohumlandı ve şirket ekranında gösteriliyordu, ama
-- `companies.level` hiçbir yerde ARTMIYORDU: yalnız testler elle set ediyordu.
-- Oyuncular kalıcı olarak seviye 1'de kalıyor, dolayısıyla ürünlerin ve
-- tesislerin çoğu hiç açılmıyordu. F8 denge kapısı bunu ortaya çıkardı:
-- 30 oyuncunun 60 turda 69 eylemi LEVEL_LOCKED ile reddedildi.
--
-- Deneyim `company_stats` içinde tutulur: orada zaten üretim, ticaret ve
-- perakende sayaçları var ve seviye şartları bunlara bakıyor.

ALTER TABLE company_stats
  ADD COLUMN experience BIGINT NOT NULL DEFAULT 0;

ALTER TABLE company_stats
  ADD CONSTRAINT company_stats_experience_positive CHECK (experience >= 0);

COMMENT ON COLUMN company_stats.experience IS
  'Toplam deneyim puanı — seviye atlama şartlarından biri (madde 11).';

-- Seviye atlama anı bildirime ve denetime düşsün.
ALTER TABLE company_stats
  ADD COLUMN last_level_up_tick BIGINT;

COMMENT ON COLUMN company_stats.last_level_up_tick IS
  'Son seviye atlama turu — bildirimi tekrarlamamak için.';

-- ---------------------------------------------------------------------------
-- Şirketin ürettiği farklı ürünler.
--
-- `company_stats.distinct_products_produced` bir seviye şartıydı ama HİÇBİR
-- YERDE güncellenmiyordu — kalıcı olarak 0'dı. Tüm zamanların ayrık ürün
-- sayısını her turda `production_records` üzerinden saymak 90 günlük veride
-- pahalı olur; bu küçük tablo sayımı O(1) yapar ve "bu şirket neler üretti"
-- ekranı için de doğru kaynaktır.
-- ---------------------------------------------------------------------------
CREATE TABLE company_products (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id  SMALLINT NOT NULL REFERENCES products(id),
  first_tick  BIGINT NOT NULL,
  PRIMARY KEY (company_id, product_id)
);

COMMENT ON TABLE company_products IS
  'Şirketin ürettiği farklı ürünler — seviye şartı ve üretim geçmişi için.';
