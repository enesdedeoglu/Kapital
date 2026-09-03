-- =============================================================================
-- 0004 · price_history.city_id: NULL yerine 0 = ULUSAL
--
-- Tasarım hatası düzeltmesi: `city_id` birincil anahtarın parçası, dolayısıyla
-- PostgreSQL onu zorunlu olarak NOT NULL yapıyor. "NULL = ulusal fiyat" niyeti
-- bu yüzden çalışamaz. Sentinel değere geçiliyor.
--
-- 0 numaralı gerçek bir şehir yoktur ve `cities`'e FK bulunmaz; 0 yalnız
-- "şehirden bağımsız, ulusal referans" anlamına gelir.
-- =============================================================================

UPDATE price_history SET city_id = 0 WHERE city_id IS NULL;
ALTER TABLE price_history ALTER COLUMN city_id SET DEFAULT 0;
ALTER TABLE price_history ALTER COLUMN city_id SET NOT NULL;

COMMENT ON COLUMN price_history.city_id IS
  '0 = ulusal referans fiyat; >0 = şehir bazlı (cities.id). FK yoktur.';
