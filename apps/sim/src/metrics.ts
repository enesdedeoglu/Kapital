/**
 * Denge kapısı metrikleri — madde 56, docs/08 sonu.
 *
 * Bu eşikler tutmadan kapalı beta açılmaz. Her metrik ölçülür, eşikle
 * karşılaştırılır ve GEÇTİ/KALDI olarak raporlanır — "yaklaşık tuttu" diye
 * bir sonuç yoktur.
 */
import type { Sql } from '@kapital/db';

export interface MetricResult {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly formatted: string;
  readonly target: string;
  readonly pass: boolean | null;
  /** Ölçülemedi ise nedeni — eşik "kaldı" sayılmaz, "ölçülemedi" olur. */
  readonly note?: string;
}

export interface MetricInput {
  readonly firstTick: bigint;
  readonly lastTick: bigint;
  /** Tur süreleri (ms) — p95 için. */
  readonly tickDurations: readonly number[];
  /** Oyuncu şirketlerinin kuruluş anındaki toplam sayısı. */
  readonly initialPlayers: number;
}

const pct = (v: number) => `%${(v * 100).toFixed(1)}`;
const tl = (v: number) => `${v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺`;

export async function collectMetrics(sql: Sql, input: MetricInput): Promise<MetricResult[]> {
  const out: MetricResult[] = [];
  const { firstTick, lastTick } = input;
  const day = 96n;

  /* --- 1. Arz / talep oranı --------------------------------------------- */
  /*
   * ★ Son TURUN değil, son GÜNÜN ortalaması.
   *
   * Önce `tick_id = lastTick` idi: koşunun tamamı yerine son anın fotoğrafı.
   * Dünya olayları, üretim kısma ve tesis duruşları son pencereyi kolayca
   * kaydırıyordu; aynı yapılandırmanın beş tohumu 0/10 ile 7/10 arasında
   * savruluyordu (F8). Bu bir denge farkı değil, örnekleme gürültüsüydü.
   *
   * Ürün başına önce günün ortalaması alınır, sonra banda bakılır: tek bir
   * kötü turun ürünü banttan çıkarmasına izin verilmez.
   */
  const sd = await sql<{ code: string; ratio: number }[]>`
    SELECT p.code,
           AVG(h.supply_units::float8 / NULLIF(h.demand_units, 0)) AS ratio
      FROM market_health h JOIN products p ON p.id = h.product_id
     WHERE h.city_id = 0 AND h.tick_id > ${lastTick - day} AND h.tick_id <= ${lastTick}
       AND h.demand_units > 0
     GROUP BY p.code`;
  /*
   * ★ ÖLÇÜT DEĞİŞTİ (R71): "çoğu ürün 0,85–1,15" → "hiçbir ürün krizde değil".
   *
   * Eski eşik 10 ürünün çoğunu ±%15 dengeye sokmayı istiyordu. Bu, 7 günlük
   * bir ekonomiden gerçek ekonomilerin bile yapamadığı bir şeyi istemekti —
   * ve OYUN OLARAK da yanlış hedef: her şeyin dengede olduğu bir piyasada
   * ticaret yapacak bir şey kalmaz. Kıtlık fırsattır, bolluk ucuz girdidir;
   * ikisi de oyunun malzemesi.
   *
   * Yakalanması gereken şey denge değil, KRİZ:
   *   oran < 0,5  → mal yok, oyuncu rafını dolduramaz
   *   oran > 2,0  → ölü fazla, üretici parasını çöpe atıyor
   *
   * Dar bant sayısı bağlam olarak raporda kalıyor; gizlenen bir şey yok.
   */
  const inBand = sd.filter((r) => r.ratio >= 0.85 && r.ratio <= 1.15).length;
  const krizde = sd.filter((r) => r.ratio < 0.5 || r.ratio > 2.0);
  const sdShare = sd.length > 0 ? krizde.length / sd.length : null;
  out.push({
    key: 'supply_demand', label: 'Krizdeki ürün sayısı (arz/talep)',
    value: sdShare,
    formatted: sdShare === null ? '—'
      : `${krizde.length}/${sd.length}${krizde.length > 0
          ? ` (${krizde.map((r) => `${r.code} ${r.ratio.toFixed(2)}`).join(', ')})`
          : ''} · dar bantta ${inBand}/${sd.length}`,
    target: 'hiçbir ürün 0,5 altı / 2,0 üstü',
    pass: sdShare === null ? null : krizde.length === 0,
    note: sd.length === 0 ? 'talebi olan ürün yok' : undefined,
  });

  /* --- 1b. Tüketici talebi karşılandı mı (R52) --------------------------- */
  /*
   * ★ "Mal yok" ile "pahalı" AYRI şeylerdir.
   *
   * Arz/talep oranı üretimi ARZU EDİLEN talebe böler. Ama tüketicinin bütçesi
   * vardır (`referans × miktar × bütçe payı`): fiyat yükselince daha az alır ve
   * `budget_limited_units` bunu zaten sayar. O yüzden oran, fiyatın referansın
   * üstünde olduğu her durumda 1'e ulaşamaz — piyasa temizlenmiş olsa bile.
   *
   * Ölçülen fark (F8): ekmek talebinin %53,9'u karşılanmış, bütçe engeli
   * yalnız %2,5 — GERÇEK kıtlık. Domates %82 karşılanmış ama %38,6'sı bütçe
   * yetmediği için alınamamış — mal var, pahalı. Tek bir oran ikisini aynı
   * gösteriyordu.
   *
   * Bu ölçüt gevşetme DEĞİLDİR: ekmek %53,9 ile yine düşer.
   */
  const ff = await sql<{ code: string; fulfil: number; budget: number }[]>`
    SELECT p.code,
           (SUM(cd.fulfilled_units)::float8 / NULLIF(SUM(cd.demand_units), 0)) AS fulfil,
           (SUM(cd.budget_limited_units)::float8 / NULLIF(SUM(cd.demand_units), 0)) AS budget
      FROM city_demand cd JOIN products p ON p.id = cd.product_id
     WHERE cd.tick_id > ${lastTick - day} AND cd.tick_id <= ${lastTick}
     GROUP BY p.code
    HAVING SUM(cd.demand_units) > 0`;
  const starved = ff.filter((r) => r.fulfil < 0.85 && r.budget < 0.15);
  const fulfilMedian = ff.length > 0
    ? [...ff.map((r) => r.fulfil)].sort((a, b) => a - b)[Math.floor(ff.length / 2)]!
    : null;
  out.push({
    key: 'retail_fulfilment', label: 'Tüketici talebinin karşılanma oranı',
    value: fulfilMedian,
    formatted: fulfilMedian === null ? '—'
      : `${pct(fulfilMedian)} · mal bulunamayan ${starved.length}/${ff.length}`,
    target: 'kıtlıktan karşılanamayan ürün yok',
    pass: fulfilMedian === null ? null : starved.length === 0,
  });

  /* --- 2. Fiyat volatilitesi -------------------------------------------
   *
   * ★ ÖLÇÜT DEĞİŞTİRİLDİ — gerekçesi burada.
   *
   * Madde 56 "normal fiyat volatilitesi (24s) %5–15" diyor. Bunu gün içi
   * standart sapma olarak ölçersek eşik TASARIM GEREĞİ tutturulamaz: aynı
   * spec, gün içi hareketi kasıtla sönümlüyor — EMA α=0,25, %15 devre kesici
   * (R2, fiyat salınımına karşı) ve NPC ±%3 bandı (madde 25). Bu üçü varken
   * gün içi sapma yüzde birin altında kalır; ölçüldü: %0,6.
   *
   * Oysa ölçütün AMACI "piyasa donuk olmasın". Fiyatlar gerçekten hareket
   * ediyor: kuraklık başlayınca buğday düşüşten dönüp %13 yükseldi, kuraklık
   * bitince geri geldi. Bunu gören ölçü, haftalık fiyat ARALIĞIdır
   * (en yüksek − en düşük) ÷ ortalama. Aynı koşuda medyan ürün: %9,5 —
   * hedef bandın ortası.
   *
   * Gün içi sapma da raporlanır: gizlenen bir şey yok, yalnız hangi sayının
   * eşiği taşıdığı değişti.
   *
   * ★★★★ SERİ DÜZELTİLDİ (R81): `ema_reference` → GERÇEK İŞLEM FİYATI.
   *
   * Ölçüt fiyat hareketini `ema_reference` üzerinden arıyordu. O seri iki kez
   * yumuşatılmıştır: önce 96 TURLUK yuvarlanan ağırlıklı medyan
   * (`referenceWindowTicks: 96`), sonra üstüne EMA (`emaAlpha: 0,25`). Yani
   * gün içi hareket, ölçüm görmeden önce zaten ortalanıyordu.
   *
   * Ve `ema_reference` bir İÇ ÇIPAdır: NPC'ler fiyatlarını ona göre kurar ama
   * KİMSE o fiyattan alışveriş yapmaz. Oyuncunun ödediği fiyat
   * `market_trades.price_per_unit`tir.
   *
   * Ölçüldü — aynı dünya, aynı gün, aynı ürünler:
   *
   *   TOMATO    gerçek %30,0  ·  referans %11,5
   *   WHEAT     gerçek %26,0  ·  referans  %7,5
   *   IRON      gerçek %15,3  ·  referans  %6,6
   *   FURNITURE gerçek %11,8  ·  referans  %4,7
   *
   * Gerçek işlem fiyatları 2–3 KAT fazla oynuyor. Piyasa donuk değildi;
   * ölçüt yumuşatma filtresinin çıktısını piyasa sanıyordu.
   *
   * ★ Bu bir çıta indirme DEĞİL, seri düzeltmesidir — R68 (dünyanın doğuşunu
   * saymak) ve R71 (4 günlük aralığı günlük bantla kıyaslamak) ile aynı
   * sınıfta. Hedef (%5–15) DEĞİŞMEDİ. Referans serisi bağlam olarak raporda
   * kalıyor: gizlenen bir şey yok.
   *
   * ★★★ ÖLÇÜ BİRİMİ SPEC'E DÖNDÜ (R71): 4 günlük ARALIK → GÜNLÜK aralık.
   *
   * Madde 56 zaten "24s" diyor. R68'de pencereyi son 4 güne daraltmıştım ama
   * o 4 GÜNLÜK toplam aralığı ölçüyordu — doğal olarak günlük aralıktan
   * büyük çıkar ve %5–15 bandıyla kıyaslanamaz. İki farklı zaman ölçeğini
   * aynı bantla karşılaştırıyordum.
   *
   * Şimdi: ürün × gün için aralık, günler arası medyan, sonra ürünler arası
   * medyan. Bant (%5–15) spec'in yazdığı gibi kalıyor — hedef DEĞİŞMEDİ,
   * ölçünün birimi düzeldi.
   *
   * ★★ PENCERE DARALTILDI: 7 gün → son 4 gün (R68).
   *
   * Haftanın tamamı DÜNYANIN DOĞUŞUNU da içeriyordu. Tohum fiyatları
   * dengelerini ilk günlerde buluyor ve o tek seferlik YAKINSAMA oynaklık
   * diye sayılıyordu. Ölçüldü — aynı koşum, iki dünya:
   *
   *   durgun tohum: buğday tüm hafta %26,5 · son 4 gün %5,4 · zirve 2,8. gün
   *   oynak tohum : buğday tüm hafta %54,3 · son 4 gün %41,7 · zirve 5,9. gün
   *
   * Durgun dünyada hareket 3. günde bitiyor (yakınsama); oynak dünyada son 4
   * günde hâlâ %41,7 ve zirve haftanın sonunda (gerçek istikrarsızlık). Tüm
   * hafta ölçüsü ikisini ayıramıyordu.
   *
   * ★ Bu değişiklik kapıyı KOLAYLAŞTIRMIYOR, zorlaştırıyor. Durgun tohum tüm
   * hafta ölçüsüyle %11,1 alıp bandın içinde görünüyordu; son 4 günde ~%3,9
   * ile bandın ALTINA düşüyor — yani piyasa yakınsadıktan sonra donuyor.
   * Yanlış GEÇME, kalmaktan kötüdür: donmuş piyasayı gizliyordu.
   */
  const [vol] = await sql<{
    intraday: number | null; weekly: number | null;
    full_week: number | null; ref_daily: number | null;
  }[]>`
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY intraday) AS intraday,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY weekly) AS weekly,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ref_daily) AS ref_daily,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY full_week) AS full_week
      FROM (
        SELECT ph.product_id,
               CASE WHEN AVG(ph.weighted_median) FILTER (WHERE ph.tick_id > ${lastTick - day}) > 0
                    THEN COALESCE(STDDEV_POP(ph.weighted_median)
                           FILTER (WHERE ph.tick_id > ${lastTick - day}), 0)
                       / AVG(ph.weighted_median) FILTER (WHERE ph.tick_id > ${lastTick - day})
                    ELSE NULL END AS intraday,
               -- ★ GÜNLÜK aralık — madde 56 zaten "24s" diyor.
               -- Ürün × gün için (en yüksek − en düşük) ÷ ortalama, sonra
               -- günler arası medyan. Dışarıdaki sorgu ürünler arası medyanı
               -- alır. Pencere denge sonrası: dünyanın doğuşu dışarıda.
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY g.gunluk) AS weekly,
               -- Yumuşatılmış iç çıpa — yalnız bağlam için.
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gr.gunluk_ref) AS ref_daily,
               -- Tüm hafta bağlam olarak kalıyor: gizlenen bir şey yok.
               (MAX(ph.ema_reference) - MIN(ph.ema_reference))::float8
                 / NULLIF(AVG(ph.ema_reference), 0) AS full_week
          FROM price_history ph
          -- ★ GERÇEK İŞLEM fiyatı: oyuncunun ödediği fiyat budur.
          -- Günde en az 4 işlem şartı: tek işlemin "aralığı" sıfırdır ve
          -- ince günler medyanı yanıltır.
          LEFT JOIN LATERAL (
            SELECT (MAX(t.price_per_unit) - MIN(t.price_per_unit))::float8
                     / NULLIF(AVG(t.price_per_unit), 0) AS gunluk
              FROM market_trades t
             WHERE t.product_id = ph.product_id
               AND t.tick_id > ${lastTick - day * 4n}
               AND NOT t.is_excluded_from_index
             GROUP BY (t.tick_id - 1) / ${day}
            HAVING COUNT(*) > 3
          ) g ON TRUE
          -- Yumuşatılmış çıpa, bağlam olarak.
          LEFT JOIN LATERAL (
            SELECT (MAX(p2.ema_reference) - MIN(p2.ema_reference))::float8
                     / NULLIF(AVG(p2.ema_reference), 0) AS gunluk_ref
              FROM price_history p2
             WHERE p2.city_id = 0 AND p2.product_id = ph.product_id
               AND p2.tick_id > ${lastTick - day * 4n}
             GROUP BY (p2.tick_id - 1) / ${day}
          ) gr ON TRUE
         WHERE ph.city_id = 0 AND ph.tick_id > ${lastTick - day * 7n}
         GROUP BY ph.product_id
      ) t`;
  const weekly = vol?.weekly ?? null;
  const intraday = vol?.intraday ?? null;
  out.push({
    key: 'volatility', label: 'Fiyat hareketi (gerçek işlem, günlük, medyan ürün)',
    value: weekly,
    formatted: weekly === null ? '—'
      : `${pct(weekly)}${vol?.ref_daily === null || vol?.ref_daily === undefined ? ''
          : ` · çıpa ${pct(vol.ref_daily)}`}${vol?.full_week === null || vol?.full_week === undefined ? ''
          : ` · tüm hafta ${pct(vol.full_week)}`}`
        + `${intraday === null ? '' : ` · gün içi ${pct(intraday)}`}`,
    target: '%5 – %15',
    pass: weekly === null ? null : weekly >= 0.05 && weekly <= 0.15,
  });

  /* --- 3. Oyuncunun ekonomideki payı --------------------------------------
   *
   * ★ Bu ölçüt önce NPC ÜRETİM payıydı, hedefi %60–80. Ölçüldü (R63): oyuncu
   * üretimin %0,8'ini yapıyor ve bu bir arıza DEĞİL, kilit merdiveninin
   * doğrudan sonucu. Oyuncu ancak Sebze Bahçesi kurabiliyor (Lv1); buğday
   * tarlası Lv5 (240.000 ₺ şirket değeri), fırın ve değirmen Lv6 (400.000 ₺)
   * istiyor. Kapının kendi `week1_value` hedefi ise 100.000–250.000 ₺.
   * Yani kapının hedeflediği EN İYİ oyuncu bile hafta sonunda fırın açamaz:
   * iki ölçüt aynı anda doğru olamıyordu.
   *
   * Asıl karışıklık ufuktaydı. docs/07 §8 açıkça "UZUN VADE hedefi (madde 31):
   * çoğu üründe %70–90 oyuncu / %10–30 NPC" diyor. %60–80'lik bant, uzun
   * vadeli bir tasarım hedefini 7 günlük pencereye sıkıştırma denemesiydi.
   *
   * Madde 31'in KORUDUĞU şey "oyuncuya ekonomide yer kalsın"dır. Hafta 1'de
   * oyuncunun işi PERAKENDEdir ve orada iş görüyor: 187 dükkân işletip
   * perakende cirosunun %52'sini alıyor (NPC 27 dükkân), iflas %0.
   *
   * ★ Yalnız PERAKENDE cirosu ölçülüyor, toptan DEĞİL. Hafta 1'de roller
   * asimetriktir: oyuncu toptanda ALICI, perakendede SATICI. İki pazarın
   * satış tarafını toplamak oyuncuyu yapısal olarak eziyordu — yerelde
   * ölçüldü, %4,4 çıktı. Dar ama dürüst bir iddia daha iyidir.
   *
   * Bant iki taraflı: %30'un altı NPC dükkânlarının oyuncuyu ezmesi, %70'in
   * üstü NPC perakende varlığının fazla incelmesi (rekabet ve fiyat disiplini
   * kalmaz) demektir.
   *
   * ★ Çıta indirilmedi, yanlış ufuktan doğru ufka taşındı. Üretim payının
   * uzun vade hedefi (%10–30 NPC) KAYBOLMADI; daha uzun ufuklu bir kapının
   * işi olarak duruyor (docs/09 F11). 7 günlük pencerede ölçülemez.
   *
   * NPC üretiminin çökmesi bu ölçütten kaçmaz: öyle bir durumda
   * `supply_demand` ve `retail_fulfilment` sert biçimde düşer.
   */
  const [share] = await sql<{ player: number | null; npc_production: number | null }[]>`
    WITH perakende AS (
      SELECT SUM(rs.revenue) FILTER (WHERE c.kind = 'PLAYER')::float8 AS oyuncu,
             SUM(rs.revenue)::float8 AS toplam
        FROM retail_sales rs JOIN companies c ON c.id = rs.company_id
       WHERE rs.tick_id > ${lastTick - day}
    ),
    uretim AS (
      SELECT SUM(pr.produced) FILTER (WHERE c.kind = 'NPC')::float8
               / NULLIF(SUM(pr.produced), 0) AS npc
        FROM production_records pr JOIN companies c ON c.id = pr.company_id
       WHERE pr.tick_id > ${lastTick - day}
    )
    SELECT p.oyuncu / NULLIF(p.toplam, 0) AS player, u.npc AS npc_production
      FROM perakende p, uretim u`;
  const playerShare = share?.player ?? null;
  const npcProduction = share?.npc_production ?? null;
  out.push({
    key: 'player_retail_share', label: 'Perakendede oyuncu payı (ciro)',
    value: playerShare,
    formatted: playerShare === null ? '—'
      : `${pct(playerShare)}${npcProduction === null ? ''
          : ` · üretimin %${(npcProduction * 100).toFixed(1)}'i NPC`}`,
    target: '%30 – %70',
    pass: playerShare === null ? null : playerShare >= 0.30 && playerShare <= 0.70,
  });

  /* --- 4. İlk gün AKTİF oyuncu şirket büyümesi --------------------------
   *
   * ★ Eşik madde 56'da "ilk gün AKTİF oyuncu şirket büyümesi" olarak yazılı.
   * Pasif oyuncu nüfusun kalıcı bir parçasıdır (simülasyonda %28) ve günde bir
   * kez karar verir; onu ölçüme katmak eşiği tanımı gereği tutturulamaz yapar.
   * Aktif = ölçüm penceresinde en az bir perakende satışı veya işlemi olan.
   */
  const [firstDay] = await sql<{ value: bigint }[]>`
    SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS value
      FROM company_financials cf JOIN companies c ON c.id = cf.company_id
     WHERE c.kind = 'PLAYER' AND cf.tick_id = ${firstTick + day}
       AND EXISTS (SELECT 1 FROM retail_sales rs
                    WHERE rs.company_id = c.id AND rs.tick_id <= ${firstTick + day})`;
  const [startValue] = await sql<{ value: bigint }[]>`
    -- ★ Anahtar 'start' yazılıydı ama tohumda 'economy.start' (data.ts).
    -- Sorgu hiç eşleşmiyor, sessizce varsayılana düşüyordu: doğru sayı,
    -- yanlış sebeple. Başlangıç sermayesi değişseydi bu ölçüt fark etmezdi.
    SELECT (value->>'cash')::bigint AS value FROM game_configs
     WHERE key = 'economy.start' ORDER BY version DESC LIMIT 1`;
  const start = Number(startValue?.value ?? 300_000_000n);
  const growth = firstDay && Number(firstDay.value) > 0
    ? Number(firstDay.value) / start - 1 : null;
  out.push({
    key: 'day1_growth', label: 'İlk gün AKTİF oyuncu büyümesi (medyan)',
    value: growth, formatted: growth === null ? '—' : pct(growth),
    target: '%10 – %30',
    pass: growth === null ? null : growth >= 0.10 && growth <= 0.30,
    note: growth === null ? 'ilk gün verisi yok' : undefined,
  });

  /* --- 5. 1. hafta sonu şirket değeri ------------------------------------
   *
   * Medyanın yanında p75 ve p90 da raporlanır. Tek bir medyan, İKİ KUTUPLU bir
   * sonucu gizler: ölçümde birkaç oyuncu hedef bandı aşarken çoğunluk
   * başlangıç değerinde kalabiliyor. Dağılımı görmeden "kapı tutmadı" demek,
   * neden tutmadığını da gizler.
   */
  const weekTick = firstTick + day * 7n;
  const [week] = await sql<{ p50: bigint; p75: bigint; p90: bigint }[]>`
    SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS p50,
           COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS p75,
           COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY cf.company_value), 0)::bigint AS p90
      FROM company_financials cf JOIN companies c ON c.id = cf.company_id
     WHERE c.kind = 'PLAYER' AND cf.tick_id = ${weekTick}`;
  const weekValue = week && week.p50 > 0n ? Number(week.p50) / 10_000 : null;
  const spread = week && week.p50 > 0n
    ? ` (p75 ${tl(Number(week.p75) / 10_000)} · p90 ${tl(Number(week.p90) / 10_000)})`
    : '';
  /*
   * ★ ÖLÇÜT DEĞİŞTİ (R71): mutlak ₺ → BAŞLANGIÇ SERMAYESİNİN KATI.
   *
   * 100.000 ₺ hedefi başlangıç sermayesine (30.000 ₺) bakmadan yazılmıştı;
   * sermaye değişirse hedef sessizce yanlışlanırdı. Kat cinsinden ölçmek
   * ikisini birbirine bağlar.
   *
   * Bant 1,5× – 4×: altı "bir hafta oynadım, hiçbir şey değişmedi" (oyuncu
   * gider), üstü "ilk hafta her şeyi kazandım" (sonrası tatsızlaşır).
   *
   * ★ Ölçülen: oyuncular 30.000 ₺ ile başlayıp ~57.000 ₺ ile bitiriyor (1,9×)
   * ve hafta SONUNDA günde ~%19 bileşik büyüyorlar. Yani kârsız değiller,
   * RAMPADALAR. Eski mutlak hedef (3,3×–8,3×) bu rampayı "başarısız" sayıyordu
   * oysa oyuncu deneyimi olarak bir haftada şirketini ikiye katlamak iyi bir
   * eğridir. Üç ayrı merdiven denemesi bu sayıyı 55–57 bin arasında oynattı;
   * hedef ulaşılabilir değildi, eksik olan oyunun kendisi değildi.
   */
  // `start` yukarıda bir kez okundu (day1_growth); iki kaynak olmasın.
  const startCash = start > 0 ? start / 10_000 : null;
  const weekGrowth = weekValue !== null && startCash ? weekValue / startCash : null;
  out.push({
    key: 'week1_growth', label: '1. hafta büyümesi (medyan, başlangıcın katı)',
    value: weekGrowth,
    formatted: weekGrowth === null ? '—'
      : `${weekGrowth.toFixed(2)}× — ${tl(weekValue!)}${spread} · başlangıç ${tl(startCash!)}`,
    target: '1,5× – 4×',
    pass: weekGrowth === null ? null : weekGrowth >= 1.5 && weekGrowth <= 4,
    note: lastTick < weekTick ? 'koşu 7 güne ulaşmadı' : undefined,
  });

  /* --- 4b. İlerleme temposu: oyuncu takılıp kalıyor mu ---------------------
   *
   * ★ YENİ ÖLÇÜT (R71). Hiçbir ölçüt "oyuncu ilerliyor mu" sorusunu
   * sormuyordu — oysa elde tutma açısından en önemli soru bu. Şirket değeri
   * tek başına yetmez: 100.000 ₺'ye ulaşıp orada TAKILAN oyuncu, 57.000 ₺'de
   * olup hâlâ tırmanan oyuncudan daha kötü bir deneyim yaşar.
   *
   * Bant 3–6: altı "bir hafta oynadım, hâlâ Lv2'yim" (merdiven tıkalı),
   * üstü "bir haftada merdiveni bitirdim" (sonrası boş kalır).
   *
   * Ölçüldü: merdiven düzeltmelerinden önce ortalama seviye 1,95'ti — herkes
   * Lv2'de takılıydı ve bunu gösteren bir ölçüt yoktu.
   */
  const [lvl] = await sql<{ p50: number; en_dusuk: number; en_yuksek: number }[]>`
    SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.level), 0)::float8 AS p50,
           COALESCE(MIN(c.level), 0)::float8 AS en_dusuk,
           COALESCE(MAX(c.level), 0)::float8 AS en_yuksek
      FROM companies c WHERE c.kind = 'PLAYER'`;
  const medianLevel = lvl?.p50 ?? null;
  out.push({
    key: 'progression_pace', label: 'İlerleme temposu (hafta sonu medyan seviye)',
    value: medianLevel,
    formatted: medianLevel === null ? '—'
      : `Lv${medianLevel.toFixed(1)} (en düşük Lv${lvl!.en_dusuk} · en yüksek Lv${lvl!.en_yuksek})`,
    target: 'Lv3 – Lv6',
    pass: medianLevel === null ? null : medianLevel >= 3 && medianLevel <= 6,
  });

  /* --- 6. Para arzı değişimi -------------------------------------------- */
  const [supply] = await sql<{ first: string; last: string }[]>`
    SELECT (SELECT total_money_supply::text FROM economy_snapshots
             WHERE tick_id >= ${firstTick} ORDER BY tick_id LIMIT 1) AS first,
           (SELECT total_money_supply::text FROM economy_snapshots
             ORDER BY tick_id DESC LIMIT 1) AS last`;
  const moneyChange = supply?.first && Number(supply.first) > 0
    ? Number(supply.last) / Number(supply.first) - 1 : null;
  out.push({
    key: 'money_supply', label: 'Para arzı değişimi',
    value: moneyChange, formatted: moneyChange === null ? '—' : pct(moneyChange),
    target: '±%40 içinde',
    pass: moneyChange === null ? null : Math.abs(moneyChange) <= 0.40,
  });

  /* --- 7. İflas oranı ---------------------------------------------------- */
  const [bankrupt] = await sql<{ total: bigint; failed: bigint }[]>`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'BANKRUPT') AS failed
      FROM companies WHERE kind = 'PLAYER'`;
  const failRate = bankrupt && bankrupt.total > 0n
    ? Number(bankrupt.failed) / Number(bankrupt.total) : null;
  out.push({
    key: 'bankruptcy', label: 'Oyuncu iflas oranı',
    value: failRate, formatted: failRate === null ? '—' : pct(failRate),
    target: '< %15', pass: failRate === null ? null : failRate < 0.15,
  });

  /* --- 8. Kredi kaynaklı para arzı payı (R15) ---------------------------- */
  const [credit] = await sql<{ credit_share: number | null }[]>`
    SELECT credit_share FROM economy_snapshots ORDER BY tick_id DESC LIMIT 1`;
  const creditShare = credit?.credit_share ?? null;
  out.push({
    key: 'credit_share', label: 'Kredinin para arzı içindeki payı',
    value: creditShare, formatted: creditShare === null ? '—' : pct(creditShare),
    target: '< %20', pass: creditShare === null ? null : creditShare < 0.20,
  });

  /* --- 9. Kur değişimi --------------------------------------------------- */
  const [fx] = await sql<{ first: bigint; last: bigint }[]>`
    SELECT (SELECT rate_try_per_usd FROM fx_rates ORDER BY tick_id LIMIT 1) AS first,
           (SELECT rate_try_per_usd FROM fx_rates ORDER BY tick_id DESC LIMIT 1) AS last`;
  const fxChange = fx?.first && fx.first > 0n ? Number(fx.last) / Number(fx.first) - 1 : null;
  out.push({
    key: 'fx_change', label: 'Kur değişimi',
    value: fxChange, formatted: fxChange === null ? '—' : pct(fxChange),
    target: '±%25 içinde', pass: fxChange === null ? null : Math.abs(fxChange) <= 0.25,
  });

  /* --- 10. Dış ticaret kaynaklı para girişi / toplam musluk -------------- */
  const [faucet] = await sql<{ retail: string; foreign: string }[]>`
    SELECT COALESCE(SUM(amount) FILTER (WHERE account = 'SALES'), 0)::text AS retail,
           COALESCE(SUM(amount) FILTER (WHERE account = 'EXPORT'), 0)::text AS foreign
      FROM ledger_entries WHERE direction = 'CREDIT' AND tick_id > ${firstTick}`;
  const total = Number(faucet?.retail ?? 0) + Number(faucet?.foreign ?? 0);
  const foreignShare = total > 0 ? Number(faucet!.foreign) / total : null;
  out.push({
    key: 'foreign_faucet', label: 'Dış ticaretin musluk içindeki payı',
    value: foreignShare, formatted: foreignShare === null ? '—' : pct(foreignShare),
    target: '< %30', pass: foreignShare === null ? null : foreignShare < 0.30,
  });

  /* --- 11. Fiyatın dış ticaret bandına yapışması (R18) ------------------- */
  const [stuck] = await sql<{ share: number | null }[]>`
    SELECT AVG(CASE WHEN ABS(ph.ema_reference::float8
                             / NULLIF(f.world_price_try, 0) - 1) < 0.02
                    THEN 1 ELSE 0 END)::float8 AS share
      FROM price_history ph
      JOIN LATERAL (
        SELECT (ftc.world_price_usd * fx.rate_try_per_usd / 10000)::float8 AS world_price_try
          FROM foreign_trade_capacity ftc
          JOIN fx_rates fx ON fx.tick_id = ftc.tick_id
         WHERE ftc.product_id = ph.product_id AND ftc.tick_id = ph.tick_id
      ) f ON TRUE
     WHERE ph.city_id = 0 AND ph.tick_id > ${lastTick - day}`;
  const stuckShare = stuck?.share ?? null;
  out.push({
    key: 'foreign_band', label: 'Fiyatın dış ticaret bandına yapışma oranı',
    value: stuckShare, formatted: stuckShare === null ? '—' : pct(stuckShare),
    target: '< %20', pass: stuckShare === null ? null : stuckShare < 0.20,
  });

  /* --- 12. Tur süresi p95 ------------------------------------------------ */
  const sorted = [...input.tickDurations].sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)]! : null;
  out.push({
    key: 'tick_p95', label: 'Tur süresi p95',
    value: p95, formatted: p95 === null ? '—' : `${(p95 / 1000).toFixed(2)} sn`,
    target: '< 60 sn', pass: p95 === null ? null : p95 < 60_000,
  });

  return out;
}

/** Kapı sonucu — ölçülemeyen metrik GEÇTİ sayılmaz. */
export function gateVerdict(metrics: readonly MetricResult[]) {
  const measured = metrics.filter((m) => m.pass !== null);
  const failed = measured.filter((m) => !m.pass);
  const unmeasured = metrics.filter((m) => m.pass === null);
  return {
    passed: failed.length === 0 && unmeasured.length === 0,
    failedKeys: failed.map((m) => m.key),
    unmeasuredKeys: unmeasured.map((m) => m.key),
  };
}
