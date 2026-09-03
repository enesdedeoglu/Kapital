-- 0011 — Tesis kapasite kullanım oranı (F6)
--
-- NPC'ler (ve F9'dan sonra oyuncular) üretimi talebe göre kısabilmeli.
-- Bu kolon olmadan her tesis her tur %100 kapasiteyle üretir; satılmayan mal
-- depoya yığılır, işçilik gideri ödenmeye devam eder ve para arzı sızar.
-- 500 turluk oyuncusuz koşuda ölçülen sızıntı: tur başına -1.996 ₺.
--
-- 1 = tam kapasite (varsayılan, mevcut davranış). Taban 0,10: tesis tamamen
-- durmaz, çünkü sıfır üretim fiyat sinyalini de yok eder.

ALTER TABLE facilities
  ADD COLUMN utilization double precision NOT NULL DEFAULT 1;

ALTER TABLE facilities
  ADD CONSTRAINT facilities_utilization_range
  CHECK (utilization > 0 AND utilization <= 1);

COMMENT ON COLUMN facilities.utilization IS
  'Kapasite kullanım oranı 0..1 — üretim bununla çarpılır. NPC''lerde P6 fazı ayarlar.';
