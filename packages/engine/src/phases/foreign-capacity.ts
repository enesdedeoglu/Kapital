import type { Sql } from '@kapital/db';
import { foreignPrices, worldPriceUsd } from '@kapital/economy';
import { asMoney, qtyFromNumber, TICKS_PER_DAY } from '@kapital/shared';
import type { EngineTick } from '../context.js';

export interface ForeignCapacityResult {
  products: number;
  importCapacity: bigint;
  exportCapacity: bigint;
}

/**
 * Tur başına dış ticaret derinliği — docs/12 §3.3, risk R17.
 *
 * ★ Bu tavan, ihracatın ikinci bir para musluğuna dönüşmesini engelleyen
 * mekanizmadır. Fiyatı oyuncu belirleyemez (dünya fiyatı USD'de çıpalı) VE
 * miktar sınırlıdır; iki şart birlikte olmadan R10 döviz kılığında geri döner.
 *
 * Derinlik yurt içi talebin bir oranıdır ve TÜM oyuncular arasında pro-rata
 * paylaşılır — ilk gelen kapmaz, tur zamanlaması yarışı oluşmaz.
 *
 * Economic Director `IMPORT_QUOTA` kaldıracıyla ithalat derinliğini büyütebilir
 * (F7); arz krizinde `SYS_RESERVE`'den önce denenecek çözüm budur (docs/12 §6).
 */
export async function computeForeignCapacity(
  sql: Sql, tick: EngineTick,
): Promise<ForeignCapacityResult> {
  const [cityScale] = await sql<{ scale: number }[]>`
    SELECT COALESCE(SUM(population_index * income_index * consumer_demand_index), 1) AS scale
    FROM cities WHERE is_active`;

  const rows = await sql<{
    product_id: number; base_demand: number; base_price_usd: bigint;
    world_price_index: number; import_depth_pct: number; export_depth_pct: number;
    importable: boolean; exportable: boolean;
  }[]>`
    SELECT w.product_id, p.base_demand, w.base_price_usd, w.world_price_index,
           w.import_depth_pct, w.export_depth_pct, w.importable, w.exportable
    FROM world_market w JOIN products p ON p.id = w.product_id
    WHERE p.is_active`;

  // Economic Director direktifi (F7'de dolacak; şimdilik yok = 1,0)
  const quotas = await loadImportQuotas(sql, tick);
  const zincirTalebi = await loadChainDemand(sql, tick);

  let importTotal = 0n;
  let exportTotal = 0n;

  for (const row of rows) {
    // Talebi olmayan ara ürünlerde de ticaret olmalı: taban bir derinlik verilir.
    const demandPerTick = Math.max(row.base_demand * cityScale!.scale, 25);
    const quota = quotas.get(row.product_id) ?? 1;

    /*
     * ★★★★ İTHALAT TABANI ZİNCİR TALEBİNİ DE GÖRÜR. Ara malların tüketici
     * talebi (`base_demand`) sıfırdır; formül yalnız ona baktığı için buğday,
     * un, çelik gibi dokuz ithal malın dokuzu 25 × %15 = 3,75 birimlik tabana
     * yapışıyordu — yurt içinde turda ~400 buğday el değiştirirken. Spec
     * "yurt içi talep" diyor (docs/12 §3.3); ara malın yurt içi talebi,
     * Director'ın tüketiciden zincirle türettiği taleptir (R43).
     *
     * ★ YALNIZ İTHALAT. İhracat derinliği R17'nin para musluğu freni; onu
     * büyütmek dışarıdan ₺ basmak olur, dokunulmaz.
     */
    const ithalatTabani = Math.max(demandPerTick, zincirTalebi.get(row.product_id) ?? 0);
    const importCapacity = row.importable
      ? qtyFromNumber(ithalatTabani * row.import_depth_pct * quota)
      : 0n;
    const exportCapacity = row.exportable
      ? qtyFromNumber(demandPerTick * row.export_depth_pct)
      : 0n;

    const world = worldPriceUsd(asMoney(row.base_price_usd), row.world_price_index);

    await sql`
      INSERT INTO foreign_trade_capacity (tick_id, product_id, import_capacity,
                                          export_capacity, world_price_usd, import_quota_mult)
      VALUES (${tick.seq}, ${row.product_id}, ${importCapacity}, ${exportCapacity},
              ${world}, ${quota})
      ON CONFLICT (tick_id, product_id) DO NOTHING`;

    importTotal += importCapacity as bigint;
    exportTotal += exportCapacity as bigint;
  }

  return { products: rows.length, importCapacity: importTotal, exportCapacity: exportTotal };
}

/**
 * Ürün başına tur başı yurt içi talep — Director'ın son ölçümünden.
 *
 * `market_health.demand_units` ölçüm penceresinin (bir gün) toplamıdır ve
 * ara mallarda zincirle türetilmiştir. Tüketici talebinden türediği için
 * ithalattan geri beslenmez: ithalat kapasiteyi kendi kendine büyütemez.
 * P0, Director'dan (P6) önce koşar; okunan önceki turun ölçümüdür.
 */
async function loadChainDemand(sql: Sql, tick: EngineTick): Promise<Map<number, number>> {
  const rows = await sql<{ product_id: number; demand_units: bigint }[]>`
    SELECT product_id, demand_units FROM market_health
     WHERE city_id = 0
       AND tick_id = (SELECT MAX(tick_id) FROM market_health WHERE tick_id < ${tick.seq})
     ORDER BY product_id`;
  return new Map(rows.map((r) => [r.product_id, Number(r.demand_units) / 1000 / TICKS_PER_DAY]));
}

/** `IMPORT_QUOTA` direktifi: derinlik 0,5×–4× arası ölçeklenir (docs/12 §6). */
async function loadImportQuotas(sql: Sql, tick: EngineTick): Promise<Map<number, number>> {
  const rows = await sql<{ product_id: number | null; magnitude: number }[]>`
    SELECT product_id, magnitude FROM npc_directives
    WHERE lever = 'IMPORT_QUOTA' AND issued_tick <= ${tick.seq} AND expires_tick > ${tick.seq}`
    .catch(() => [] as { product_id: number | null; magnitude: number }[]);
  const map = new Map<number, number>();
  for (const row of rows) {
    if (row.product_id !== null) map.set(row.product_id, 1 + row.magnitude * 3);
  }
  return map;
}

/** Dünya fiyatı ve sürtünme bandı — UI ve servis katmanı için. */
export function foreignQuote(
  worldUsd: bigint, exportMultiplier: number, importMultiplier: number,
) {
  return foreignPrices(asMoney(worldUsd), exportMultiplier, importMultiplier);
}
