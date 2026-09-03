import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBatch, runInTransaction, type Sql } from '@kapital/db';
import { makeNpc, prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { money, qty } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;
const WHEAT = 1, FLOUR = 2, BREAD = 3, TOMATO = 4;
const KONYA = 4, ANKARA = 2; // medyan mesafe: Konya 5,10 · Ankara 4,20

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, retail_offers, retail_sales, city_demand,
             price_history, company_financials, facility_financials, economy_snapshots,
             production_jobs, production_records, npc_profiles, npc_decisions
      RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

const ordersOf = (facilityId: string, side: 'BUY' | 'SELL') =>
  sql<{ product_id: number; price_per_unit: bigint; quantity: bigint }[]>`
    SELECT product_id, price_per_unit, quantity FROM market_orders
    WHERE facility_id = ${facilityId}::uuid AND side = ${side}::order_side`;

const utilizationOf = async (facilityId: string) => {
  const [row] = await sql<{ utilization: number }[]>`
    SELECT utilization FROM facilities WHERE id = ${facilityId}::uuid`;
  return row!.utilization;
};

const referenceOf = async (productId: number) => {
  const [row] = await sql<{ ema: bigint }[]>`
    SELECT ema_reference AS ema FROM price_history
    WHERE product_id = ${productId} AND city_id = 0
    ORDER BY tick_id DESC LIMIT 1`;
  return row?.ema ?? null;
};

describe('NPC operasyonel kararları (P6)', () => {
  it('üretici, reçetesinin girdisi için alış emri açar', async () => {
    const mill = await makeNpc(sql, { typeCode: 'MILL', outputCode: 'FLOUR', cityId: ANKARA });
    await runTick(sql);

    const buys = await ordersOf(mill.facilityId, 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0]!.product_id).toBe(WHEAT);
    expect(buys[0]!.quantity).toBeGreaterThan(0n);
  });

  it('alış teklifi navlun payı içerir — uzak satıcı erişilebilir olsun diye (R20)', async () => {
    // Aynı ürün, iki şehir. Medyan mesafeleri farklı olduğu için teklifler de
    // farklı olmalı; navlun payı olmasaydı ikisi de referans × 1,02 olurdu.
    const ankara = await makeNpc(sql, { typeCode: 'MILL', outputCode: 'FLOUR', cityId: ANKARA });
    const konya = await makeNpc(sql, { typeCode: 'MILL', outputCode: 'FLOUR', cityId: KONYA });
    await runTick(sql);

    const [ankaraBid] = await ordersOf(ankara.facilityId, 'BUY');
    const [konyaBid] = await ordersOf(konya.facilityId, 'BUY');
    const reference = (await referenceOf(WHEAT))!;

    // İkisi de referansın (ve dolayısıyla saf %2 payın) üstünde olmalı
    expect(ankaraBid!.price_per_unit).toBeGreaterThan((reference * 102n) / 100n);
    expect(konyaBid!.price_per_unit).toBeGreaterThan((reference * 102n) / 100n);
    // Konya daha uzak bir medyana sahiptir → payı daha büyüktür
    expect(konyaBid!.price_per_unit).toBeGreaterThan(ankaraBid!.price_per_unit);
  });

  it('üretici, stoğundaki çıktı için satış emri açar', async () => {
    const field = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: field.inventoryId, productId: WHEAT,
      quantity: qty(500), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));
    await runTick(sql);

    const sells = await ordersOf(field.facilityId, 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0]!.product_id).toBe(WHEAT);
    expect(sells[0]!.price_per_unit).toBeGreaterThan(0n);
  });

  it('perakendeci rafındaki ürüne satış fiyatı koyar', async () => {
    const shop = await makeNpc(sql, { typeCode: 'GREENGROCER', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: shop.inventoryId, productId: TOMATO,
      quantity: qty(200), unitCost: money(8), quality: 70, producedAtTick: 0n,
    }));
    await runTick(sql);

    const [offer] = await sql<{ product_id: number; selling_price: bigint; enabled: boolean }[]>`
      SELECT product_id, selling_price, enabled FROM retail_offers
      WHERE facility_id = ${shop.facilityId}::uuid`;
    expect(offer).toBeDefined();
    expect(offer!.enabled).toBe(true);
    expect(offer!.selling_price).toBeGreaterThan(money(8));
  });

  it('kararlar npc_decisions defterine yazılır', async () => {
    const field = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: field.inventoryId, productId: WHEAT,
      quantity: qty(500), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));
    await runTick(sql);

    const [row] = await sql<{ kind: string; reason: string }[]>`
      SELECT kind, reason FROM npc_decisions WHERE company_id = ${field.companyId}::uuid`;
    expect(row!.kind).toBe('SELL');
    expect(row!.reason.length).toBeGreaterThan(0);
  });

  it('nakit rezervi alış bütçesini sınırlar', async () => {
    const poor = await makeNpc(sql, {
      typeCode: 'MILL', outputCode: 'FLOUR', cityId: ANKARA,
      cash: money(300), cashReserveRatio: 0.5,
    });
    await runTick(sql);

    const buys = await ordersOf(poor.facilityId, 'BUY');
    if (buys.length > 0) {
      const spend = (buys[0]!.price_per_unit * buys[0]!.quantity) / 1000n;
      expect(spend).toBeLessThanOrEqual(money(150)); // nakdin yarısı rezervde
    }
  });
});

describe('üretim kısma — satılmayan stok (madde 31)', () => {
  it('çıktı stoğu birikince kapasite kullanımı düşer', async () => {
    const field = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    // WHEAT_FIELD kapasitesi 30/tur; 8 turluk hedefin çok üstünde stok koyalım
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: field.inventoryId, productId: WHEAT,
      quantity: qty(3000), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));
    expect(await utilizationOf(field.facilityId)).toBe(1);

    await runTick(sql);
    const afterOne = await utilizationOf(field.facilityId);
    expect(afterOne).toBeLessThan(1);
    expect(afterOne).toBeGreaterThanOrEqual(0.94); // tek turda en fazla %5 iner
  });

  it('kısma kademelidir — arz tek turda çökmez', async () => {
    const field = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: field.inventoryId, productId: WHEAT,
      quantity: qty(5000), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));

    const path: number[] = [];
    for (let i = 0; i < 5; i++) {
      await runTick(sql);
      path.push(await utilizationOf(field.facilityId));
    }
    expect(path.every((u, i) => i === 0 || u <= path[i - 1]!)).toBe(true);
    expect(path.at(-1)!).toBeGreaterThan(0.10); // tabana bir turda çakılmaz
  });

  it('stoğu olmayan tesis tam kapasitede kalır', async () => {
    const field = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runTick(sql);
    expect(await utilizationOf(field.facilityId)).toBe(1);
  });

  it('kısma üretimi gerçekten azaltır', async () => {
    const full = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    const half = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await sql`UPDATE facilities SET utilization = 0.5 WHERE id = ${half.facilityId}::uuid`;
    await runTick(sql);

    const rows = await sql<{ facility_id: string; produced: bigint }[]>`
      SELECT facility_id, produced FROM production_records WHERE tick_id = 1`;
    const fullOut = rows.find((r) => r.facility_id === full.facilityId)!.produced;
    const halfOut = rows.find((r) => r.facility_id === half.facilityId)!.produced;
    expect(halfOut * 2n).toBe(fullOut);
  });
});
