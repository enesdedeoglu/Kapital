import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBatch, runInTransaction, type Sql } from '@kapital/db';
import { makeFacility, makePlayer, prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { money, qty } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;
const TOMATO = 4, STEEL = 9;
const IST = 1;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, retail_offers, retail_sales, city_demand,
             price_history, company_financials, facility_financials, economy_snapshots,
             production_jobs, production_records, market_health, npc_directives,
             world_events, world_notices, fx_rates, standing_orders
      RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

async function shopWithRule(opts: {
  kind: 'RESTOCK' | 'SELL_SURPLUS'; productId: number; target: bigint;
  cash?: bigint; level?: number; maxPrice?: bigint; minPrice?: bigint; onHand?: bigint;
}) {
  const player = await makePlayer(sql, opts.cash ?? money(200_000), 'Kalıcı A.Ş.');
  if (opts.level !== undefined) {
    await sql`UPDATE companies SET level = ${opts.level} WHERE id = ${player.id}::uuid`;
  }
  const facility = await makeFacility(sql, player.id, { typeCode: 'MARKET', cityId: IST });
  if (opts.onHand) {
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: facility.inventoryId, productId: opts.productId,
      quantity: opts.onHand!, unitCost: money(10), quality: 70, producedAtTick: 0n,
    }));
  }
  await sql`
    INSERT INTO standing_orders (company_id, facility_id, product_id, kind,
                                 target_quantity, max_price, min_price)
    VALUES (${player.id}::uuid, ${facility.id}::uuid, ${opts.productId}, ${opts.kind},
            ${opts.target}, ${opts.maxPrice ?? null}, ${opts.minPrice ?? null})`;
  return { player, facility };
}

const ordersOf = (facilityId: string, side: 'BUY' | 'SELL') =>
  sql<{ quantity: bigint; price_per_unit: bigint }[]>`
    SELECT quantity, price_per_unit FROM market_orders
     WHERE facility_id = ${facilityId}::uuid AND side = ${side}::order_side`;

describe('kalıcı emirler — oyuncu yokken şirket çalışsın', () => {
  it('★ raf boşalınca oyuncu girmeden alış emri verilir', async () => {
    const { facility } = await shopWithRule({
      kind: 'RESTOCK', productId: TOMATO, target: qty(400),
    });
    await runTick(sql);

    const [order] = await ordersOf(facility.id, 'BUY');
    expect(order).toBeDefined();
    expect(order!.quantity).toBe(qty(400));
  });

  it('raf doluyken emir verilmez', async () => {
    const { facility } = await shopWithRule({
      kind: 'RESTOCK', productId: TOMATO, target: qty(400), onHand: qty(400),
    });
    await runTick(sql);
    expect(await ordersOf(facility.id, 'BUY')).toHaveLength(0);
  });

  it('açık emir varken ikinci emir verilmez — defter şişmez', async () => {
    const { facility } = await shopWithRule({
      kind: 'RESTOCK', productId: TOMATO, target: qty(400),
    });
    await runTick(sql);
    await runTick(sql);
    await runTick(sql);
    expect(await ordersOf(facility.id, 'BUY')).toHaveLength(1);
  });

  it('★ oyuncunun fiyat tavanı uygulanır', async () => {
    const { facility } = await shopWithRule({
      kind: 'RESTOCK', productId: TOMATO, target: qty(400), maxPrice: money(11),
    });
    await runTick(sql);
    const [order] = await ordersOf(facility.id, 'BUY');
    expect(order!.price_per_unit).toBe(money(11));
  });

  it('★ nakit yetmiyorsa miktar kısılır — kalıcı emir batıramaz', async () => {
    const { facility } = await shopWithRule({
      kind: 'RESTOCK', productId: TOMATO, target: qty(4000), cash: money(2_000),
    });
    await runTick(sql);
    const [order] = await ordersOf(facility.id, 'BUY');
    if (order) {
      const spend = (order.price_per_unit * order.quantity) / 1000n;
      expect(spend).toBeLessThanOrEqual(money(2_000));
    }
  });

  it('★ seviye kilidi kalıcı emirle aşılamaz', async () => {
    // Çelik Lv15'te açılır; oyuncu Lv1.
    const { facility } = await shopWithRule({
      kind: 'RESTOCK', productId: STEEL, target: qty(400), level: 1,
    });
    const tick = await runTick(sql);
    expect(await ordersOf(facility.id, 'BUY')).toHaveLength(0);

    const govern = tick.phases.GOVERN!.result as { standing: { skippedLevelLocked: number } };
    expect(govern.standing.skippedLevelLocked).toBeGreaterThan(0);
  });

  it('fazla stok kalıcı emirle satışa çıkar', async () => {
    const { facility } = await shopWithRule({
      kind: 'SELL_SURPLUS', productId: TOMATO, target: qty(100), onHand: qty(500),
    });
    await runTick(sql);
    const [order] = await ordersOf(facility.id, 'SELL');
    expect(order!.quantity).toBe(qty(400));
  });

  it('★ kalıcı emir maliyetin altına satmaz', async () => {
    const { facility } = await shopWithRule({
      kind: 'SELL_SURPLUS', productId: TOMATO, target: qty(100), onHand: qty(500),
    });
    await runTick(sql);
    const [order] = await ordersOf(facility.id, 'SELL');
    expect(order!.price_per_unit).toBeGreaterThan(money(10)); // birim maliyet
  });

  it('kapalı kural işlenmez', async () => {
    const { facility } = await shopWithRule({
      kind: 'RESTOCK', productId: TOMATO, target: qty(400),
    });
    await sql`UPDATE standing_orders SET enabled = FALSE`;
    await runTick(sql);
    expect(await ordersOf(facility.id, 'BUY')).toHaveLength(0);
  });

  it('★ aynı şirketin iki kuralı aynı parayı iki kez harcayamaz', async () => {
    const player = await makePlayer(sql, money(3_000), 'Dar Bütçe A.Ş.');
    const a = await makeFacility(sql, player.id, { typeCode: 'MARKET', cityId: IST });
    const b = await makeFacility(sql, player.id, { typeCode: 'MARKET', cityId: IST });
    for (const facility of [a, b]) {
      await sql`
        INSERT INTO standing_orders (company_id, facility_id, product_id, kind, target_quantity)
        VALUES (${player.id}::uuid, ${facility.id}::uuid, ${TOMATO}, 'RESTOCK', ${qty(4000)})`;
    }
    await runTick(sql);

    const orders = await sql<{ quantity: bigint; price_per_unit: bigint }[]>`
      SELECT quantity, price_per_unit FROM market_orders
       WHERE company_id = ${player.id}::uuid AND side = 'BUY'`;
    const total = orders.reduce((sum, o) => sum + (o.price_per_unit * o.quantity) / 1000n, 0n);
    expect(total).toBeLessThanOrEqual(money(3_000));
  });

  it('son çalışma turu kaydedilir', async () => {
    await shopWithRule({ kind: 'RESTOCK', productId: TOMATO, target: qty(400) });
    const tick = await runTick(sql);
    const [rule] = await sql<{ last_run_tick: bigint | null }[]>`
      SELECT last_run_tick FROM standing_orders`;
    expect(rule!.last_run_tick).toBe(tick.seq);
  });
});
