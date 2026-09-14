-- ★ ALIŞ EMRİNİN NAVLUN PAYI AYRI TUTULUR (R93).
--
-- Alıcının teklifi `referans × (1 + prim) + navlun_payı` olarak kuruluyor:
-- navlun payı şehrin MEDYAN mesafesine göre hesaplanan bir tahmindir ve
-- amacı, alıcının başka şehirdeki satıcılara da ERİŞEBİLMESİDİR (R20).
--
-- Eşleşme fiyatı ise satıcının isteği ile alıcının tavanının orta noktasıdır.
-- Satıcı AYNI ŞEHİRDE ise gerçek nakliye sıfırdır, yani o navlun payı hiç
-- harcanmaz — ama tavanın içinde durduğu için yarısı satıcıya prim olarak
-- gider ve `price_history` üzerinden FİYAT ENDEKSİNE yazılır. Endeks de bir
-- sonraki turun referansıdır: fiyat kendi kendini besler.
--
-- ÖLÇÜLDÜ (tohum 20260904): navlun payının fiyat seviyesine etkisi
--   WHEAT %24,2 · COAL %20,8 · TOMATO %19,3 · FURNITURE %12,5 · FLOUR %8,5
-- En çok AĞIR VE UCUZ malları vuruyor, çünkü navlun ağırlıkla ölçeklenir ama
-- fiyatla ölçeklenmez.
--
-- Bunu düzeltmek için eşleştiricinin, teklifin ne kadarının mala ne kadarının
-- navluna ayrıldığını BİLMESİ gerekir. Fiyattan geri hesaplanamaz.
--
-- Emir fiyatının kendisine DOKUNULMAZ: uygunluk kuralı (`satış + nakliye <=
-- teklif`) aynı kalır, yani navlun payı erişim işlevini sürdürür. Değişen tek
-- şey, kullanılmayan payın FİYATA karışmaması.

ALTER TABLE market_orders
  ADD COLUMN freight_allowance bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN market_orders.freight_allowance IS
  'Alış emrinde teklifin navluna ayrılmış kısmı (R93). Uygunlukta sayılır, '
  'fiyat oluşumunda sayılmaz; satış emirlerinde 0.';
