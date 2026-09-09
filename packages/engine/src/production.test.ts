import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBatch, runInTransaction, type Sql } from '@kapital/db';
import { makeFacility, makePlayer, prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { money, qty } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;
const WHEAT = 1, FLOUR = 2;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, retail_offers, retail_sales, city_demand,
             price_history, company_financials, facility_financials, economy_snapshots,
             production_jobs, production_records RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

/** Reçetesi atanmış, üretime hazır bir tesis kurar. */
async function producer(opts: {
  typeCode: string; outputCode: string; cityId?: number; companyCash?: bigint;
}) {
  const player = await makePlayer(sql, opts.companyCash ?? money(200_000), 'Üretici A.Ş.');
  const facility = await makeFacility(sql, player.id, {
    typeCode: opts.typeCode, cityId: opts.cityId ?? 4, // varsayılan Konya (tarım 1,20)
  });
  const [recipe] = await sql<{ id: number }[]>`
    SELECT r.id FROM production_recipes r
    JOIN facility_types ft ON ft.id = r.facility_type_id AND ft.code = ${opts.typeCode}
    JOIN products p ON p.id = r.output_product_id AND p.code = ${opts.outputCode}`;
  await sql`UPDATE facilities SET active_recipe_id = ${recipe!.id} WHERE id = ${facility.id}::uuid`;
  return { player, facility, recipeId: recipe!.id };
}

const stockOf = async (inventoryId: string, productId: number) => {
  const [row] = await sql<{ total: bigint; quality: string }[]>`
    SELECT COALESCE(SUM(quantity), 0)::bigint AS total,
           COALESCE(SUM(quantity * quality) / NULLIF(SUM(quantity), 0), 0)::text AS quality
    FROM inventory_batches WHERE inventory_id = ${inventoryId}::uuid AND product_id = ${productId}`;
  return { total: row!.total, quality: Number(row!.quality) };
};

describe('hammadde üretimi (girdisiz reçete)', () => {
  it('buğday tarlası her tur buğday üretir', async () => {
    const { facility } = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    const tick = await runTick(sql);
    const produce = tick.phases.PRODUCE!.result as { produced: bigint; jobsCompleted: number };

    expect(produce.jobsCompleted).toBe(1);
    expect(produce.produced).toBeGreaterThan(0n);

    const stock = await stockOf(facility.inventoryId, WHEAT);
    expect(stock.total).toBe(produce.produced);
    expect(stock.quality).toBeGreaterThan(0);
  });

  it('Konya tarımda İstanbul\'dan verimli (şehir bonusu)', async () => {
    const konya = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: 4 });
    await runTick(sql);
    const konyaStock = await stockOf(konya.facility.inventoryId, WHEAT);

    await truncateGameState(sql);
    await sql.unsafe(`TRUNCATE production_jobs, production_records RESTART IDENTITY CASCADE;
                      DELETE FROM tick_phase_runs; DELETE FROM economic_ticks WHERE seq > 0;`);

    const istanbul = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: 1 });
    await runTick(sql);
    const istanbulStock = await stockOf(istanbul.facility.inventoryId, WHEAT);

    // Konya tarım 1,20 · İstanbul 0,85 → hem miktar hem kalite yüksek
    expect(konyaStock.total).toBeGreaterThan(istanbulStock.total);
    expect(konyaStock.quality).toBeGreaterThan(istanbulStock.quality);
  });

  it('işçilik ve enerji gideri SYS_SINK\'e gider', async () => {
    const { player } = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    await runTick(sql);
    const [row] = await sql<{ amount: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS amount FROM ledger_entries
      WHERE company_id = ${player.id}::uuid AND account = 'SALARY' AND direction = 'DEBIT'`;
    expect(row!.amount).toBeGreaterThan(0n);
  });

  it('★ işçilik gideri fiyat seviyesiyle birlikte hareket eder (R75)', async () => {
    // Musluk (tüketici harcaması) bütçe sınırlıdır: fiyat artınca tüketici
    // daha az ADET alır, aynı parayı harcar. Gider ise reçeteden gelen SABİT
    // NOMİNAL bir sayıydı ve adede göre ödeniyordu — adet düşünce gider
    // küçülüyor, musluk sabit kalıyor ve para birikiyordu.
    //
    // Ölçüldü (tohum 1, gün 2→5): musluk 5.216.518 → 4.890.158 sabit iken
    // maaş 2.972.499 → 2.263.230; günlük para yaratımı 1.592.144'ten
    // 2.400.087'ye ÇIKTI.
    const maas = async (companyId: string) => {
      const [row] = await sql<{ amount: bigint }[]>`
        SELECT COALESCE(SUM(amount), 0)::bigint AS amount FROM ledger_entries
        WHERE company_id = ${companyId}::uuid AND account = 'SALARY' AND direction = 'DEBIT'`;
      return row!.amount;
    };

    const taban = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    await runTick(sql);
    const ucuz = await maas(taban.player.id);
    expect(ucuz).toBeGreaterThan(0n);

    // Fiyat seviyesini iki katına çıkar: aynı üretim, daha yüksek gider.
    await truncateGameState(sql);
    await sql.unsafe(`
      TRUNCATE price_history, production_jobs, production_records,
               economic_ticks RESTART IDENTITY CASCADE;
    `);
    const pahali = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    await sql`
      INSERT INTO price_history (tick_id, product_id, city_id, weighted_median, ema_reference)
      SELECT 0, p.id, 0, p.base_reference_price * 2, p.base_reference_price * 2
        FROM products p WHERE p.base_reference_price > 0
      ON CONFLICT DO NOTHING`;
    await runTick(sql);
    const yuksek = await maas(pahali.player.id);

    // Reel ücret sabit: nominal gider fiyatla birlikte artar.
    expect(yuksek).toBeGreaterThan(ucuz);
  });

  it('depo dolduğunda üretim durur ve nedeni kaydedilir', async () => {
    const { facility } = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    // Depoyu doldur
    const [inv] = await sql<{ capacity: bigint }[]>`
      SELECT capacity FROM inventories WHERE id = ${facility.inventoryId}::uuid`;
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: facility.inventoryId, productId: WHEAT, quantity: inv!.capacity,
      quality: 60, unitCost: money(9), producedInTick: 0n, expiresAtTick: null,
    }));

    const tick = await runTick(sql);
    const produce = tick.phases.PRODUCE!.result as { halted: number };
    expect(produce.halted).toBe(1);

    const [record] = await sql<{ halted_reason: string }[]>`
      SELECT halted_reason FROM production_records WHERE tick_id = ${tick.seq}`;
    expect(record!.halted_reason).toMatch(/depo dolu/i);
  });
});

describe('zincir üretimi', () => {
  it('değirmen buğdayı una çevirir — 4 kg → 3 kg', async () => {
    const { facility } = await producer({ typeCode: 'MILL', outputCode: 'FLOUR' });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: facility.inventoryId, productId: WHEAT, quantity: qty(1000),
      quality: 80, unitCost: money(10), producedInTick: 0n, expiresAtTick: null,
    }));

    await runTick(sql);
    const flour = await stockOf(facility.inventoryId, FLOUR);
    const wheat = await stockOf(facility.inventoryId, WHEAT);

    expect(flour.total).toBeGreaterThan(0n);
    // 4 kg buğday → 3 kg un: tüketilen buğday ≈ un × 4/3.
    // Tam sayı bölmesinden en fazla 1 mili-birim (0,001 kg) sapma olur ve yönü
    // "biraz fazla girdi" tarafındadır — asla yoktan çıktı üretilmez.
    const consumed = qty(1000) - wheat.total;
    const expected = (flour.total * 4n) / 3n;
    expect(consumed - expected).toBeGreaterThanOrEqual(0n);
    expect(consumed - expected).toBeLessThanOrEqual(2n);
    // Çıktı kalitesi girdiden türer: 80×0,70 + 50×0,10 + 100×0,05 ≈ 66
    expect(flour.quality).toBeGreaterThan(60);
    expect(flour.quality).toBeLessThan(72);
  });

  it('girdi yetersizse kısmi üretir ve nedenini yazar', async () => {
    const { facility } = await producer({ typeCode: 'MILL', outputCode: 'FLOUR' });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: facility.inventoryId, productId: WHEAT, quantity: qty(4),
      quality: 80, unitCost: money(10), producedInTick: 0n, expiresAtTick: null,
    }));

    const tick = await runTick(sql);
    const flour = await stockOf(facility.inventoryId, FLOUR);
    expect(flour.total).toBe(qty(3)); // 4 kg buğday tam olarak 3 kg un verir

    const [record] = await sql<{ halted_reason: string | null }[]>`
      SELECT halted_reason FROM production_records WHERE tick_id = ${tick.seq}`;
    expect(record!.halted_reason).toMatch(/girdi yetersiz/);
  });

  it('girdi yoksa hiç üretmez', async () => {
    const { facility } = await producer({ typeCode: 'MILL', outputCode: 'FLOUR' });
    const tick = await runTick(sql);
    expect((await stockOf(facility.inventoryId, FLOUR)).total).toBe(0n);
    const [record] = await sql<{ halted_reason: string | null }[]>`
      SELECT halted_reason FROM production_records WHERE tick_id = ${tick.seq}`;
    expect(record!.halted_reason).toBeTruthy();
  });

  it('minimum kalite altındaki girdiyi kullanmaz (sigara %40 ister)', async () => {
    const { facility } = await producer({ typeCode: 'CIG_FACTORY', outputCode: 'CIGARETTE' });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: facility.inventoryId, productId: 5, quantity: qty(50), // Tütün
      quality: 20, unitCost: money(25), producedInTick: 0n, expiresAtTick: null,
    }));
    await runTick(sql);
    const [row] = await sql<{ total: bigint }[]>`
      SELECT COALESCE(SUM(quantity), 0)::bigint AS total FROM inventory_batches
      WHERE inventory_id = ${facility.inventoryId}::uuid AND product_id = 6`;
    expect(row!.total).toBe(0n); // düşük kaliteli tütün kullanılmadı
  });

  it('çok girdili reçete: 3 kg kömür + 2 kg demir → 2 kg çelik', async () => {
    const { facility } = await producer({ typeCode: 'STEEL_MILL', outputCode: 'STEEL', cityId: 5 });
    await runInTransaction(sql, async (tx) => {
      await addBatch(tx, { inventoryId: facility.inventoryId, productId: 8, quantity: qty(300), quality: 70, unitCost: money(18), producedInTick: 0n, expiresAtTick: null });
      await addBatch(tx, { inventoryId: facility.inventoryId, productId: 7, quantity: qty(200), quality: 70, unitCost: money(28), producedInTick: 0n, expiresAtTick: null });
    });
    await runTick(sql);
    const steel = await stockOf(facility.inventoryId, 9);
    expect(steel.total).toBeGreaterThan(0n);

    const coal = await stockOf(facility.inventoryId, 8);
    const iron = await stockOf(facility.inventoryId, 7);
    // Kömür : Demir tüketimi 3 : 2
    const usedCoal = qty(300) - coal.total;
    const usedIron = qty(200) - iron.total;
    expect(usedCoal * 2n).toBe(usedIron * 3n);
  });

  it('bir girdi bitince üretim o girdiyle sınırlanır', async () => {
    const { facility } = await producer({ typeCode: 'STEEL_MILL', outputCode: 'STEEL', cityId: 5 });
    await runInTransaction(sql, async (tx) => {
      await addBatch(tx, { inventoryId: facility.inventoryId, productId: 8, quantity: qty(300), quality: 70, unitCost: money(18), producedInTick: 0n, expiresAtTick: null });
      await addBatch(tx, { inventoryId: facility.inventoryId, productId: 7, quantity: qty(4), quality: 70, unitCost: money(28), producedInTick: 0n, expiresAtTick: null });
    });
    await runTick(sql);
    // 4 kg demir → en fazla 4 kg çelik (2 demir : 2 çelik)
    expect((await stockOf(facility.inventoryId, 9)).total).toBe(qty(4));
  });
});

describe('tesis durumu', () => {
  it('her tur aşınır', async () => {
    const { facility } = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    await runTick(sql);
    const [after] = await sql<{ condition: string }[]>`
      SELECT condition::text FROM facilities WHERE id = ${facility.id}::uuid`;
    expect(Number(after!.condition)).toBeCloseTo(99.95, 3);
  });

  it('durum 30\'un altına inince üretim durur ama tesis kapatılmaz', async () => {
    const { facility } = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    await sql`UPDATE facilities SET condition = 30.01 WHERE id = ${facility.id}::uuid`;
    const tick = await runTick(sql);

    const upkeep = tick.phases.UPKEEP!.result as { criticalCondition: number };
    expect(upkeep.criticalCondition).toBe(1);

    const [row] = await sql<{ production_enabled: boolean; halted_reason: string; closed_at: Date | null }[]>`
      SELECT production_enabled, halted_reason, closed_at FROM facilities WHERE id = ${facility.id}::uuid`;
    expect(row!.production_enabled).toBe(false);
    expect(row!.halted_reason).toMatch(/kritik/);
    expect(row!.closed_at).toBeNull();
  });
});

describe('idempotency', () => {
  it('aynı tur iki kez koşarsa üretim tekrarlanmaz', async () => {
    const { facility } = await producer({ typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT' });
    const tick = await runTick(sql);
    const first = await stockOf(facility.inventoryId, WHEAT);

    await sql`UPDATE tick_phase_runs SET status = 'PENDING' WHERE tick_id = ${tick.tickId}`;
    await sql`UPDATE economic_ticks SET status = 'RUNNING' WHERE id = ${tick.tickId}`;
    await runTick(sql);

    expect((await stockOf(facility.inventoryId, WHEAT)).total).toBe(first.total);
    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM production_jobs WHERE facility_id = ${facility.id}::uuid`;
    expect(count).toBe(1n);
  });
});
