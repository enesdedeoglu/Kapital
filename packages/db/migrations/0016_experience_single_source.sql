-- 0016 — Deneyim puanı tek yerde tutulur
--
-- `experience` HEM `companies` HEM `company_stats` tablosundaydı. Şirket
-- ekranı `companies.experience`'ı OKUYOR ama oraya hiçbir yerde yazılmıyordu;
-- F8'de eklenen ilerleme ise `company_stats.experience`'a yazıyordu. Sonuç:
-- seviye doğru ilerliyor ama oyuncu XP'sini hep 0 görüyor.
--
-- Doğru yer `companies`: seviye orada, deneyim de yanında durmalı. Kolonu
-- ekleyen ben olduğum için (0013) taşımak da bana düşer.

UPDATE companies c
   SET experience = GREATEST(c.experience, s.experience)
  FROM company_stats s
 WHERE s.company_id = c.id AND s.experience > c.experience;

ALTER TABLE company_stats DROP COLUMN experience;

COMMENT ON COLUMN companies.experience IS
  'Toplam deneyim puanı — seviye atlama şartlarından biri (madde 11). P7 yazar.';
