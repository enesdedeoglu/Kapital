-- ★ KURULAN TESİSE REÇETESİ KENDİLİĞİNDEN ATANIR (R96).
--
-- `facilities.active_recipe_id` NULL ile kuruluyordu ve üretim fazı
-- (`p1-produce.ts`) tam da o alan üzerinden JOIN yapıyor:
--
--   JOIN production_recipes r ON r.id = f.active_recipe_id AND r.is_active
--
-- Yani reçetesi olmayan tesis sorgunun DIŞINDA kalıyor: hiç üretim kaydı
-- açılmıyor, `halted_reason` da yazılmıyor. Sonuç, tesisin ÇALIŞIR GÖRÜNMESİ.
--
-- ÖLÇÜLDÜ (kapital_dev kopyası, API üzerinden gerçek bir oyuncu gibi):
-- Sebze Bahçesi kuruldu, inşaat bitene kadar 7 tur koşturuldu, ardından
--
--   productionEnabled: true   haltedReason: null
--   capacityPerTick: "15.28"  recipe: null      → üretim 0, depo boş
--
-- Her şey sağlıklı görünürken tesis hiçbir şey üretmiyordu. Tek bir
-- `POST /facilities/:id/recipe` çağrısından sonra üç turda 45,8 kg domates.
-- Mobil uygulamada o ucu çağıran hiçbir ekran yok; yani oyuncunun kurduğu
-- her üretim tesisi sonsuza kadar boş çalışıyordu.
--
-- ★ NEDEN "SEÇTİRMEK" DEĞİL DE ATAMAK:
--
-- Her üretim tesisi türünün TEK reçetesi var (bugün on türün onu da öyle):
--   VEG_GARDEN→TOMATO · WHEAT_FIELD→WHEAT · MILL→FLOUR · BAKERY→BREAD ·
--   TOBACCO_FARM→TOBACCO · CIG_FACTORY→CIGARETTE · IRON_MINE→IRON ·
--   COAL_MINE→COAL · STEEL_MILL→STEEL · FURNITURE_FACTORY→FURNITURE
-- Oyuncuya "bahçende ne yetiştirmek istersin" diye sorup tek seçenek sunmak
-- bir karar değil, bir engeldir. Ekran eklemek boşluğu kapatmaz, boşluğa bir
-- kapı takar.
--
-- ★ SEVİYE KİLİDİ ATLANMIYOR: her reçetenin `unlock_level`i, tesis türünün
-- kendi `unlock_level`inden büyük DEĞİL (on türün onunda da eşit). Kurabilen
-- üretebilir; atama kimseye kapalı bir ürünü açmaz. Aşağıdaki `WHERE` yine de
-- şartı açıkça yazıyor — veri ileride kayarsa atama sessizce kilit aşmasın.
--
-- ★ BİRDEN ÇOK REÇETE VARSA ATAMA YAPILMAZ: o zaman seçim GERÇEK bir karardır
-- ve oyuncuya aittir. `HAVING COUNT(*) = 1` bunu garanti eder; ileride bir
-- türe ikinci reçete eklenirse bu göç ve `facility.service` sessizce yanlış
-- olanı seçmek yerine hiçbir şey seçmez, arayüz de "tarif yok" der.

UPDATE facilities f
   SET active_recipe_id = tek.recipe_id
  FROM (
    SELECT r.facility_type_id, MIN(r.id) AS recipe_id, MIN(r.unlock_level) AS unlock_level
      FROM production_recipes r
     WHERE r.is_active
     GROUP BY r.facility_type_id
    HAVING COUNT(*) = 1
  ) tek
  JOIN facility_types ft ON ft.id = tek.facility_type_id
 WHERE f.facility_type_id = tek.facility_type_id
   AND f.active_recipe_id IS NULL
   AND f.closed_at IS NULL
   AND tek.unlock_level <= ft.unlock_level;
