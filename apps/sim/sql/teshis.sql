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

\echo '=== R61 — SERMAYE NEDEN ORAYA GİTTİ: yatırım skorunun bileşenleri ==='
-- Kararın kullandığı ham sayılar, karar anında yazıldıkları gibi. Ağırlıklar:
-- marj 0,35 · açık 0,30 · fiyat eğilimi 0,15 · zincir ihtiyacı 0,10 · rekabet -0,10
--
-- "katki_*" sütunları skora yapılan GERÇEK katkıdır (ham × ağırlık): hangi
-- terimin kararı belirlediği doğrudan okunur, tahmin edilmez.
SELECT p.code,
       ROUND(AVG(o.score)::numeric, 3)          AS skor,
       ROUND(AVG(o.threshold)::numeric, 3)      AS esik,
       ROUND(AVG(LEAST(GREATEST(o.margin,0),1)         * 0.35)::numeric, 3) AS katki_marj,
       ROUND(AVG(LEAST(GREATEST(o.demand_gap,0),1)     * 0.30)::numeric, 3) AS katki_acik,
       ROUND(AVG(LEAST(GREATEST(o.price_trend,0),1)    * 0.15)::numeric, 3) AS katki_egilim,
       ROUND(AVG(LEAST(GREATEST(o.strategic_need,0),1) * 0.10)::numeric, 3) AS katki_zincir,
       ROUND(AVG(LEAST(GREATEST(o.competition,0),1)    * -0.10)::numeric, 3) AS katki_rekabet,
       ROUND(AVG(o.gap_per_tick)::numeric, 1)   AS acik_tur,
       ROUND(AVG(o.pipeline_per_tick)::numeric, 1) AS yolda_tur
  FROM investment_opportunities o JOIN products p ON p.id = o.product_id
 WHERE o.tick_id > (SELECT MAX(seq) - 96 FROM economic_ticks)
 GROUP BY 1 ORDER BY skor DESC;

\echo '=== R61 — yatırım kapısı: skor mu yetmedi, açık mı kapalıydı ==='
-- Bir ürüne yatırım yapılmamasının iki ayrı sebebi var ve karıştırılmamalı:
-- (a) skor eşiğin altında kaldı, (b) açık zaten yoldaki kapasiteyle kapanmış.
SELECT p.code,
       COUNT(*) FILTER (WHERE o.score >= o.threshold) AS skor_yetti,
       COUNT(*) FILTER (WHERE o.pipeline_per_tick >= GREATEST(o.gap_per_tick, 0)) AS acik_kapali,
       COUNT(*) FILTER (WHERE o.score >= o.threshold
                          AND o.pipeline_per_tick < GREATEST(o.gap_per_tick, 0)) AS yatirilabilir,
       COUNT(*) AS tur
  FROM investment_opportunities o JOIN products p ON p.id = o.product_id
 WHERE o.tick_id > (SELECT MAX(seq) - 96 FROM economic_ticks)
 GROUP BY 1 ORDER BY yatirilabilir DESC;

\echo '=== R65 — SEVİYE MERDİVENİ: hangi şart bağlıyor? ==='
-- ★ Merdivende DÖRT şart var (XP, değer, hacim, ürün) ve hepsi birden
-- tutmalı. Yanlış olanı indirmek hiçbir şey açmaz; hangisinin bağladığı
-- tahmin edilmeyecek, ölçülecek.
--
-- Her oyuncunun BİR SONRAKİ seviyesi için her şartın karşılanma oranı.
-- Oran < 1 olan şart bağlayandır; en küçüğü asıl darboğazdır.
WITH oyuncu AS (
  SELECT c.id, c.level, c.experience,
         GREATEST(cs.peak_company_value, COALESCE(cf.company_value, 0)) AS deger,
         cs.total_trade_volume AS hacim,
         cs.total_units_produced AS uretim,
         cs.distinct_products_produced AS urun
    FROM companies c
    JOIN company_stats cs ON cs.company_id = c.id
    LEFT JOIN LATERAL (
      SELECT company_value FROM company_financials
       WHERE company_id = c.id ORDER BY tick_id DESC LIMIT 1
    ) cf ON TRUE
   WHERE c.kind = 'PLAYER'
),
hedef AS (
  SELECT o.*, l.required_xp, l.required_company_value,
         l.required_trade_volume, l.required_units_produced,
         l.required_distinct_products, l.title
    FROM oyuncu o JOIN company_levels l ON l.level = o.level + 1
)
SELECT level AS su_anki, title AS sonraki, COUNT(*) AS oyuncu,
       ROUND(AVG(LEAST(1, experience::numeric / NULLIF(required_xp,0))), 2)          AS xp,
       ROUND(AVG(LEAST(1, deger::numeric  / NULLIF(required_company_value,0))), 2)   AS deger,
       ROUND(AVG(LEAST(1, hacim::numeric  / NULLIF(required_trade_volume,0))), 2)    AS hacim,
       ROUND(AVG(LEAST(1, uretim::numeric / NULLIF(required_units_produced,0))), 2)  AS uretim,
       ROUND(AVG(LEAST(1, urun::numeric   / NULLIF(required_distinct_products,0))),2) AS urun
  FROM hedef GROUP BY 1,2 ORDER BY 1;

\echo '=== R66 — OYNAKLIK: yakınsama mı, gerçek hareket mi? ==='
-- ★ `volatility` ölçütü HAFTANIN TAMAMINDAKİ en yüksek−en düşük aralığını
-- alıyor. Dünya tohum fiyatlarından başlayıp ilk günlerde dengesini buluyorsa
-- o tek seferlik YAKINSAMA da oynaklık sayılır. İkisi ayrı şeydir:
-- yakınsama bir kez olur ve biter, oynaklık sürer.
--
-- Bu tablo uçların NE ZAMAN oluştuğunu gösterir. Tahmin edilmeyecek.
WITH sinir AS (
  SELECT MAX(seq) AS son, MAX(seq) - 672 AS hafta_basi, MAX(seq) - 480 AS gun3
    FROM economic_ticks
),
hafta AS (
  SELECT ph.product_id,
         (MAX(ph.ema_reference) - MIN(ph.ema_reference))::numeric
           / NULLIF(AVG(ph.ema_reference), 0) AS aralik_tam,
         -- Uç noktaların turu: erkense yakınsama, geçse gerçek hareket.
         (ARRAY_AGG(ph.tick_id ORDER BY ph.ema_reference DESC))[1] AS en_yuksek_tur,
         (ARRAY_AGG(ph.tick_id ORDER BY ph.ema_reference))[1]      AS en_dusuk_tur
    FROM price_history ph, sinir s
   WHERE ph.city_id = 0 AND ph.tick_id > s.hafta_basi
   GROUP BY ph.product_id
),
son4gun AS (
  SELECT ph.product_id,
         (MAX(ph.ema_reference) - MIN(ph.ema_reference))::numeric
           / NULLIF(AVG(ph.ema_reference), 0) AS aralik_son
    FROM price_history ph, sinir s
   WHERE ph.city_id = 0 AND ph.tick_id > s.gun3
   GROUP BY ph.product_id
)
SELECT p.code,
       ROUND(h.aralik_tam * 100, 1)  AS tum_hafta_yuzde,
       ROUND(x.aralik_son * 100, 1)  AS son_4_gun_yuzde,
       ROUND((h.en_yuksek_tur - s.hafta_basi) / 96.0, 1) AS zirve_gun,
       ROUND((h.en_dusuk_tur  - s.hafta_basi) / 96.0, 1) AS dip_gun
  FROM hafta h JOIN son4gun x ON x.product_id = h.product_id
  JOIN products p ON p.id = h.product_id, sinir s
 ORDER BY h.aralik_tam DESC;
