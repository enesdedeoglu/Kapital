-- Tesisin ne zamandan beri kısma tabanında olduğunu izler (R58).
--
-- Yatırımdan çıkış kararı "uzun süre tabanda VE stoğu birikmiş" der; ilk şart
-- için tarihçe gerekiyordu. Kullanım oranı tabana inince damgalanır, tabandan
-- çıkınca temizlenir. NULL = tesis tabanda değil.
--
-- Tur numarası tutulur, zaman damgası değil: zaman `tick.seq`'tir (ADR-0003).
ALTER TABLE facilities
  ADD COLUMN idle_since_tick BIGINT;

COMMENT ON COLUMN facilities.idle_since_tick IS
  'Kısma tabanına inildiği tur; tabandan çıkınca NULL. Çıkış kararı bunu okur.';
