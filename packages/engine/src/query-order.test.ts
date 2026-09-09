import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ★ Motor fazlarındaki her SELECT ya SIRALI olmalı ya da sırasının önemsiz
 * olduğu AÇIKÇA işaretlenmelidir.
 *
 * Bu testin sebebi ölçülmüş bir maliyet: determinizm avında bulunan on bir
 * kaynağın DOKUZU aynı sınıftandı — Postgres'ten sıra garantisi olmadan satır
 * okuyup o sırayı sonuca çeviren kod. Aynı tohumla iki koşum farklı ekonomi
 * üretiyordu ve bu, bir düzeltmenin işe yarayıp yaramadığını ölçülemez
 * kılıyordu (kıtlık primi genliği %20 artırıldığında ölçüt AŞAĞI gitmişti).
 *
 * R56'da bu iş "bitirilmişti" ama el yordamıyla arandığı için iki sorgu
 * atlanmıştı (`loadOpportunities`, `loadFacilities`). Denetleyen bir şey
 * olmadığı sürece on birincisi eklenir.
 *
 * ★ Gözle eleme YETMEZ: `p5-settle`in işlem sorgusu "toplama fonksiyonu,
 * zararsız" diye elenmişti. Değildi — `weightedMedian` eşit fiyatta girdi
 * sırasını koruyor ve kırpma taraması o sırayla miktar biriktiriyordu.
 * Zararsızlık sorguya değil, sonucu TÜKETEN kodun sıraya duyarlılığına bağlı.
 */
const SIRA_ONEMSIZ = 'sira-onemsiz';

/**
 * KABUL EDİLMİŞ TABAN — bu sorgular sıralamasız ve determinizm YİNE DE tutuyor.
 *
 * Ölçüldü: aynı tohumla iki koşum, fiyat geçmişi / toptan işlemler / tüm
 * ölçütler BİREBİR aynı. Yani bunlar bugün zarar vermiyor.
 *
 * ★ Ama "bugün zarar vermiyor" ile "sırası önemsiz" aynı şey DEĞİLDİR:
 * sonucu tüketen kod değişirse sıra anlam kazanabilir. Bu liste bir onay
 * değil, bir SINIRdır — yeni eklenen sıralamasız sorgu testi kırar ve
 * gerekçelendirilmesini zorunlu kılar.
 *
 * Listeden bir madde silmek her zaman doğrudur (sorguyu sıralamak).
 * Listeye madde EKLEMEK, o sorgunun sırasının neden önemsiz olduğunu
 * bilerek söylemektir.
 */
const KABUL_EDILMIS_TABAN = new Set([
  'SELECT AVG(ph.ema_reference::float8 / NULLIF(p.base_reference_price, 0',
  'SELECT COALESCE( SUM(COALESCE(ph.ema_reference, p.base_reference_price',
  'SELECT COALESCE(SUM(cash) FILTER (WHERE kind <> \'SYSTEM\'), 0)::text AS',
  'SELECT COALESCE(SUM(population_index * income_index * consumer_demand_',
  'SELECT COALESCE(SUM(produced), 0)::bigint AS produced FROM production_',
  'SELECT COALESCE(SUM(remaining_balance) FILTER (WHERE status = \'ACTIVE\'',
  'SELECT COALESCE(SUM(try_equivalent) FILTER (WHERE direction = \'EXPORT\'',
  'SELECT COALESCE(SUM(usd_balance), 0)::text AS total FROM companies WHE',
  'SELECT COUNT(*) AS count FROM companies WHERE kind <> \'SYSTEM\' AND sta',
  'SELECT COUNT(*) AS count FROM companies WHERE kind = \'PLAYER\' AND stat',
  'SELECT COUNT(*) AS count FROM facilities WHERE company_id = ${npc.comp',
  'SELECT COUNT(*) AS count FROM npc_profiles',
  'SELECT COUNT(*) AS count FROM world_events WHERE end_tick = ${tick.seq',
  'SELECT COUNT(*)::int AS count FROM companies WHERE status = \'BANKRUPT\'',
  'SELECT code, MAX(end_tick) AS ended FROM world_events WHERE end_tick <',
  'SELECT company_id, SUM(revenue)::bigint AS revenue, SUM(quantity)::big',
  'SELECT company_value FROM companies WHERE kind <> \'SYSTEM\' AND status ',
  'SELECT f.company_id, ro.facility_id, ro.product_id FROM retail_offers ',
  'SELECT f.id, f.utilization, ft.base_capacity, COALESCE(lc.capacity_mul',
  'SELECT facility_id, product_id, (SUM(quantity) / 1000.0 / 96)::float8 ',
  'SELECT facility_id, product_id, side::text FROM market_orders WHERE fa',
  'SELECT game_cpi FROM fx_rates WHERE tick_id = ${tick.seq}',
  'SELECT id FROM companies WHERE system_code = \'SYS_BANK\'',
  'SELECT id FROM companies WHERE system_code = \'SYS_CONSUMER\'',
  'SELECT id FROM companies WHERE system_code = \'SYS_RESERVE\'',
  'SELECT id FROM companies WHERE system_code = \'SYS_SINK\'',
  'SELECT id FROM market_orders WHERE company_id = ${reserve.id}::uuid AN',
  'SELECT id, facility_id, product_id, side::text, price_per_unit FROM ma',
  'SELECT id, land_cost_index FROM cities WHERE id = ${npc.home_city_id}',
  'SELECT id, magnitude FROM npc_directives WHERE lever = \'CAPACITY_CAP\' ',
  'SELECT id, weight_per_unit FROM products',
  'SELECT op.code AS output_code, r.output_quantity, ip.code AS input_cod',
  'SELECT origin_city_id AS o, destination_city_id AS d, distance_index, ',
  'SELECT origin_city_id, distance_index FROM city_distances',
  'SELECT product_id, (supply_units::float8 / NULLIF(demand_units, 0)) AS',
  'SELECT product_id, band, streak_band, streak_count FROM market_health ',
  'SELECT product_id, magnitude FROM npc_directives WHERE lever = \'IMPORT',
  'SELECT product_id, score::text FROM market_health WHERE tick_id = (SEL',
  'SELECT product_id, weighted_median AS median, ema_reference AS ema FRO',
  'SELECT recipe_id, product_id, quantity FROM recipe_inputs WHERE recipe',
  'SELECT scope, product_id AS "productId", city_id AS "cityId", category',
  'SELECT storage_capacity FROM facility_types WHERE id = ${best.opportun',
  'SELECT w.product_id, p.base_demand, w.base_price_usd, w.world_price_in',
]);


function tsDosyalari(kok: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(kok)) {
    const yol = join(kok, ad);
    if (statSync(yol).isDirectory()) out.push(...tsDosyalari(yol));
    else if (ad.endsWith('.ts') && !ad.includes('.test.')) out.push(yol);
  }
  return out;
}

/**
 * YAPISI GEREĞİ tek satır döndüren sorgular muaftır: benzersiz bir sütuna
 * eşitlik koyan aramalar. Bunlarda sıra diye bir şey yoktur.
 *
 * ★ Muafiyet DAR tutuldu. Bu avda `p5-settle`in işlem sorgusunu "toplama
 * fonksiyonu, zararsız" diye elemiştim ve yanılmıştım — determinizmin kökü
 * oydu. Zararsızlık sorgunun şekline değil, sonucu TÜKETEN kodun sıraya
 * duyarlılığına bağlıdır ve bunu statik olarak bilemeyiz. Şüphede kalırsan
 * sırala ya da gerekçesini yaz.
 */
const BENZERSIZ_ARAMA = [
  /WHERE\s+system_code\s*=/i,
  /WHERE\s+\w*\.?id\s*=\s*\$\{/i,
  /WHERE\s+key\s*=\s*\$\{/i,
];

function muaf(blok: string): boolean {
  // Yazma ifadeleri okunup döngüye beslenmez.
  if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(blok.trim())) return true;
  // Veri okumayan çağrılar (kilit vb.).
  if (/pg_advisory/i.test(blok)) return true;

  if (/\bGROUP\s+BY\b/i.test(blok)) return false;   // toplama: sıra sonucu etkileyebilir

  /*
   * SEÇİM LİSTESİ TAMAMEN TOPLAMA ve GROUP BY yok → tanım gereği TEK satır.
   * `SELECT ... FROM` arasında toplama dışı bir sütun varsa muaf değildir.
   */
  const secim = blok.replace(/\s+/g, ' ').match(/SELECT\s+(.*?)\s+FROM\s/i)?.[1];
  if (secim && !/\*/.test(secim)) {
    const toplamasiz = secim
      .replace(/\b(COUNT|SUM|AVG|MIN|MAX|PERCENTILE_CONT|STDDEV_POP|COALESCE)\s*\(/gi, '(')
      .replace(/\([^()]*\)/g, '');
    if (!/[A-Za-z_]\w*\s*(,|$)/.test(toplamasiz.replace(/AS\s+\w+/gi, ''))) return true;
  }

  if (/\bANY\s*\(/i.test(blok)) return false;       // çoklu satır
  return BENZERSIZ_ARAMA.some((r) => r.test(blok));
}

describe('★ motor sorguları sıra garantisi taşımalı (R79)', () => {
  const kok = join(import.meta.dirname, 'phases');
  const ihlaller: string[] = [];

  for (const dosya of tsDosyalari(kok)) {
    const kaynak = readFileSync(dosya, 'utf8');
    for (const m of kaynak.matchAll(/sql(?:<[^>]*>)?`([^`]*)`/g)) {
      const blok = m[1] ?? '';
      if (!/\bSELECT\b/i.test(blok)) continue;
      if (/\bORDER\s+BY\b/i.test(blok)) continue;
      if (blok.includes(SIRA_ONEMSIZ)) continue;
      if (muaf(blok)) continue;
      if (KABUL_EDILMIS_TABAN.has(blok.replace(/\s+/g, ' ').trim().slice(0, 70))) continue;
      const satir = kaynak.slice(0, m.index).split('\n').length;
      ihlaller.push(`${dosya.slice(kok.length + 1)}:${satir}  ${blok.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
    }
  }

  it('sıralaması olmayan her sorgu açıkça işaretlenmiş olmalı', () => {
    // Sıra gerçekten önemsizse sorgunun içine `-- sira-onemsiz: <gerekçe>`
    // yaz. Gerekçe yazmak, sessizce geçmekten farklıdır: bir sonraki okuyan
    // kararın verildiğini görür.
    expect(ihlaller, `sıra garantisi olmayan ${ihlaller.length} sorgu:\n  ${ihlaller.join('\n  ')}`)
      .toEqual([]);
  });
});
