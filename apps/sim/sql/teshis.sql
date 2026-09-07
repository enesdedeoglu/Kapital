-- Kapı koşusundan sonra çalışır: metrikler NEDEN öyle çıktı sorusunu
-- cevaplayacak ham gözlemler. Artefakta yazılır, dünya silinmeden önce.
\pset footer off

\echo '=== Oyuncu dükkânı: raf doluluğu ve teklif çeşitliliği ==='
SELECT c.kind,
       COUNT(DISTINCT f.id)                                   AS dukkan,
       ROUND(AVG(i.used_capacity::numeric / NULLIF(i.capacity,0)) * 100, 1) AS doluluk_yuzde,
       ROUND(AVG((SELECT COUNT(*) FROM retail_offers ro
                   WHERE ro.facility_id = f.id AND ro.enabled)), 2) AS ort_teklif
  FROM facilities f
  JOIN facility_types ft ON ft.id = f.facility_type_id
  JOIN companies c ON c.id = f.company_id
  JOIN inventories i ON i.facility_id = f.id
 WHERE ft.category = 'RETAIL' AND f.closed_at IS NULL
 GROUP BY 1;

\echo '=== Son 96 turda perakende: dükkân başına satış ==='
SELECT c.kind, COUNT(DISTINCT rs.facility_id) AS dukkan,
       ROUND(SUM(rs.quantity)/1000.0/96/NULLIF(COUNT(DISTINCT rs.facility_id),0), 1) AS kg_tur_dukkan,
       ROUND(SUM(rs.revenue)/10000.0) AS ciro
  FROM retail_sales rs
  JOIN facilities f ON f.id = rs.facility_id
  JOIN companies c ON c.id = f.company_id
 WHERE rs.tick_id > (SELECT MAX(tick_id) - 96 FROM retail_sales)
 GROUP BY 1;

\echo '=== Oyuncu alış emirleri doldu mu — MAL BULABİLİYOR MU ==='
-- Bu satır week1_value'nun kökünü ayırır: dolum düşükse oyuncu
-- senaryosu değil ARZ yetersizdir, yüksekse sorun oyuncunun kendisindedir.
SELECT o.status,
       COUNT(*) AS emir,
       ROUND(AVG(1 - o.remaining_quantity::numeric / NULLIF(o.quantity,0)) * 100, 1) AS ort_dolum_yuzde
  FROM market_orders o JOIN companies c ON c.id = o.company_id
 WHERE c.kind = 'PLAYER' AND o.side = 'BUY'
   AND o.expires_at_tick > (SELECT MAX(seq) - 192 FROM economic_ticks)
 GROUP BY 1 ORDER BY 2 DESC;

\echo '=== Zincir aşamalarına yatırım (tohum vs sonradan) ==='
SELECT ft.code,
       COUNT(*) FILTER (WHERE f.construction_complete_at_tick = 0) AS tohumdan,
       COUNT(*) FILTER (WHERE f.construction_complete_at_tick > 0) AS sonradan
  FROM facilities f JOIN facility_types ft ON ft.id = f.facility_type_id
  JOIN companies c ON c.id = f.company_id
 WHERE f.closed_at IS NULL AND c.kind = 'NPC' AND ft.base_capacity > 0
 GROUP BY 1 ORDER BY 3 DESC;

\echo '=== Ürün bazında arz/talep ve bant ==='
SELECT p.code, h.band, ROUND(h.score::numeric, 1) AS skor,
       ROUND(h.supply_units::numeric / NULLIF(h.demand_units,0), 2) AS oran
  FROM market_health h JOIN products p ON p.id = h.product_id
 WHERE h.tick_id = (SELECT MAX(tick_id) FROM market_health) AND h.city_id = 0
 ORDER BY 4;

\echo '=== Oyuncu serveti: nereden geliyor ==='
SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.company_value)/10000.0) AS deger_p50,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.facility_value)/10000.0) AS tesis_p50,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.cash)/10000.0) AS nakit_p50,
       ROUND(AVG(c.level), 2) AS ort_seviye
  FROM company_financials cf JOIN companies c ON c.id = cf.company_id
 WHERE c.kind = 'PLAYER'
   AND cf.tick_id = (SELECT MAX(tick_id) FROM company_financials);

\echo '=== ADAY 2 — oyuncu serveti ne kadar eşitsiz (Gini) ==='
-- week1_value medyanı 58k ama p90 358k. Soru: oyuncular kazanamıyor mu,
-- yoksa kazanç birkaç oyuncuda mı toplanıyor? Gini 0 = tam eşit, 1 = tek elde.
WITH v AS (
  SELECT cf.company_value::numeric AS x,
         ROW_NUMBER() OVER (ORDER BY cf.company_value) AS i,
         COUNT(*) OVER () AS n
    FROM company_financials cf JOIN companies c ON c.id = cf.company_id
   WHERE c.kind = 'PLAYER'
     AND cf.tick_id = (SELECT MAX(tick_id) FROM company_financials)
)
SELECT ROUND((2 * SUM(i * x) / NULLIF(n * SUM(x), 0)) - (n + 1)::numeric / n, 3) AS gini,
       MAX(n) AS oyuncu,
       ROUND(MIN(x)/10000.0) AS en_dusuk,
       ROUND(MAX(x)/10000.0) AS en_yuksek
  FROM v GROUP BY n;

\echo '=== ADAY 2b — servet nereden: tesis mi, nakit mi, stok mu ==='
SELECT ROUND(AVG(cf.company_value)/10000.0) AS ort_deger,
       ROUND(AVG(cf.facility_value)/10000.0) AS tesis,
       ROUND(AVG(c.cash)/10000.0)            AS nakit,
       ROUND(AVG(cf.company_value - cf.facility_value - c.cash)/10000.0) AS stok_vs_diger,
       ROUND(AVG(c.level), 2) AS seviye
  FROM company_financials cf JOIN companies c ON c.id = cf.company_id
 WHERE c.kind = 'PLAYER'
   AND cf.tick_id = (SELECT MAX(tick_id) FROM company_financials);

\echo '=== ADAY 3 — para arzı: musluk ve gider dengesi (son 96 tur) ==='
-- Para arzı haftada %33-42 büyüyor. Hangi hesap yaratıyor, hangisi siliyor?
SELECT account, direction,
       ROUND(SUM(amount)/10000.0) AS tutar
  FROM ledger_entries
 WHERE tick_id > (SELECT MAX(seq) - 96 FROM economic_ticks)
   AND company_id IN (SELECT id FROM companies WHERE kind = 'SYSTEM')
 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12;

\echo '=== ADAY 3b — sistem şirketlerinin bakiyesi ==='
SELECT c.system_code, ROUND(c.cash/10000.0) AS bakiye
  FROM companies c WHERE c.kind = 'SYSTEM' ORDER BY 2;

\echo '=== DENGE — kapasite mi, kısma mı, dağıtım mı? ==='
-- Zincir kısa kalıyor ama kapasite yeterli. Üç aday: tesis kısılmış olabilir,
-- girdi bulamamış olabilir, ya da malı satamamış olabilir. Bu tablo üçünü
-- yan yana koyar; hangisinin bağladığını tahmin etmeye gerek kalmasın.
SELECT p.code AS urun,
       COUNT(*) AS tesis,
       ROUND(AVG(f.utilization)::numeric, 2) AS kullanim,
       -- ★ `base_capacity` ZATEN tur başına çıktı kilogramıdır: p1-produce
       -- `planned = qtyFromNumber(base_capacity × çarpanlar)` der ve
       -- `output_quantity` yalnız GİRDİ oranı için kullanılır. Önce ikisi
       -- çarpılıyordu ve bir çevrimde 1 kg'dan fazla üreten her tesisin
       -- kapasitesi `output_quantity` katı şişiyordu (sigarada 20, ekmekte 4).
       ROUND(SUM(ft.base_capacity)::numeric, 0) AS tam_kap,
       ROUND(SUM(ft.base_capacity * f.utilization)::numeric, 0) AS kisilmis_kap,
       ROUND((SELECT COALESCE(SUM(b.quantity),0)/1000.0 FROM inventory_batches b
               JOIN inventories i ON i.id = b.inventory_id
               JOIN facilities f2 ON f2.id = i.facility_id
               JOIN production_recipes r2 ON r2.id = f2.active_recipe_id
              WHERE b.product_id = p.id AND r2.output_product_id = p.id)::numeric, 0) AS uretici_stogu
  FROM facilities f
  JOIN facility_types ft ON ft.id = f.facility_type_id
  JOIN production_recipes r ON r.id = f.active_recipe_id
  JOIN products p ON p.id = r.output_product_id
 WHERE f.closed_at IS NULL AND f.production_enabled
 GROUP BY p.id, p.code ORDER BY 3;

\echo '=== Üretim neden durdu (son 96 tur) ==='
SELECT p.code, COALESCE(pr.halted_reason, '(üretti)') AS sebep, COUNT(*) AS kayit
  FROM production_records pr JOIN products p ON p.id = pr.product_id
 WHERE pr.tick_id > (SELECT MAX(seq) - 96 FROM economic_ticks)
 GROUP BY 1,2 HAVING COUNT(*) > 20 ORDER BY 1, 3 DESC;

\echo '=== Toptan piyasa temizleniyor mu (son 96 tur) ==='
SELECT p.code,
       COUNT(*) FILTER (WHERE o.side='BUY') AS alis_emri,
       COUNT(*) FILTER (WHERE o.side='SELL') AS satis_emri,
       ROUND(AVG(1 - o.remaining_quantity::numeric/NULLIF(o.quantity,0)) FILTER (WHERE o.side='BUY') * 100, 1) AS alis_dolum,
       ROUND(AVG(1 - o.remaining_quantity::numeric/NULLIF(o.quantity,0)) FILTER (WHERE o.side='SELL') * 100, 1) AS satis_dolum
  FROM market_orders o JOIN products p ON p.id = o.product_id
 WHERE o.expires_at_tick > (SELECT MAX(seq) - 192 FROM economic_ticks)
 GROUP BY 1 ORDER BY 1;
