import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBatch, checkInvariants, runInTransaction, type Sql } from '@kapital/db';
import {
  cashOf, makeFacility, makePlayer, placeOrder, prepareTestDb, truncateGameState,
} from '@kapital/db/testing';
import { money, qty } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;
/**
 * DEMİR seçildi çünkü MVP NPC satıcıları demir satmıyor — emir defteri
 * yalnız testin kurduğu emirleri içerir. NPC arzı olan bir ürün (domates,
 * buğday, un, ekmek) seçilseydi testler NPC eşleşmeleriyle kirlenirdi.
 * Ayrıca demir bozulmaz, dolayısıyla raf ömrü testi etkilemez.
 */
const IRON = 7;
const IST = 1, KON = 4, BRS = 5;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, shipments, trade_flags, retail_offers, retail_sales,
             city_demand, price_history, company_financials, facility_financials,
             economy_snapshots, production_jobs, production_records RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

async function trader(name: string, cityId: number, cash = money(200_000)) {
  const player = await makePlayer(sql, cash, name);
  const facility = await makeFacility(sql, player.id, { typeCode: 'MARKET', cityId });
  return { ...player, facility, cityId };
}

async function stockUp(inventoryId: string, amount: bigint, quality = 80, cost = money(12)) {
  await runInTransaction(sql, (tx) => addBatch(tx, {
    inventoryId, productId: IRON, quantity: amount, quality,
    unitCost: cost, producedInTick: 0n, expiresAtTick: null,
  }));
}

const stockAt = async (facilityId: string) => {
  const [row] = await sql<{ total: bigint }[]>`
    SELECT COALESCE(SUM(b.quantity), 0)::bigint AS total
    FROM inventories i LEFT JOIN inventory_batches b ON b.inventory_id = i.id
    WHERE i.facility_id = ${facilityId}::uuid`;
  return row!.total;
};

describe('aynı şehirde eşleşme', () => {
  it('mal anında teslim edilir, nakliye yoktur', async () => {
    const seller = await trader('Satıcı A.Ş.', IST);
    const buyer = await trader('Alıcı A.Ş.', IST);
    await stockUp(seller.facility.inventoryId, qty(500));

    await placeOrder(sql, {
      companyId: seller.id, facilityId: seller.facility.id, cityId: IST,
      productId: IRON, side: 'SELL', quantity: qty(500), price: money(16), quality: 80,
    });
    await placeOrder(sql, {
      companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST,
      productId: IRON, side: 'BUY', quantity: qty(200), price: money(20),
    });

    const tick = await runTick(sql);
    const ex = tick.phases.EXCHANGE!.result as {
      matches: number; volume: bigint; shippingValue: bigint; shipmentsDelivered: number;
    };

    expect(ex.matches).toBe(1);
    expect(ex.volume).toBe(qty(200));
    expect(ex.shippingValue).toBe(0n);          // aynı şehir
    expect(ex.shipmentsDelivered).toBe(1);      // transit 0 → aynı turda teslim
    expect(await stockAt(buyer.facility.id)).toBe(qty(200));
    expect(await stockAt(seller.facility.id)).toBe(qty(300));
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('fiyat satıcı isteği ile alıcı tavanının ortasıdır', async () => {
    const seller = await trader('S', IST);
    const buyer = await trader('B', IST);
    await stockUp(seller.facility.inventoryId, qty(100));
    await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(100), price: money(16) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(100), price: money(20) });
    await runTick(sql);

    const [trade] = await sql<{ price_per_unit: bigint }[]>`SELECT price_per_unit FROM market_trades`;
    expect(trade!.price_per_unit).toBe(money(18)); // (16+20)/2
  });
});

describe('şehirler arası ticaret (A3)', () => {
  it('★ yoldaki mal hiçbir envanterde değildir', async () => {
    const seller = await trader('Konya Satıcı', KON);
    const buyer = await trader('İstanbul Alıcı', IST);
    await stockUp(seller.facility.inventoryId, qty(300));

    await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: KON, productId: IRON, side: 'SELL', quantity: qty(300), price: money(14) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(300), price: money(30) });

    // Tur 1: eşleşme + sevkiyat yola çıkar (KON→IST transit 3 tur)
    const tick1 = await runTick(sql);
    const ex1 = tick1.phases.EXCHANGE!.result as {
      matches: number; shippingValue: bigint; shipmentsDelivered: number;
    };
    expect(ex1.matches).toBe(1);
    expect(ex1.shippingValue).toBeGreaterThan(0n);
    expect(ex1.shipmentsDelivered).toBe(0);

    // ★ Mal ne satıcıda ne alıcıda
    expect(await stockAt(seller.facility.id)).toBe(0n);
    expect(await stockAt(buyer.facility.id)).toBe(0n);

    const [shipment] = await sql<{ status: string; arrival_tick: bigint; quantity: bigint }[]>`
      SELECT status, arrival_tick, quantity FROM shipments`;
    expect(shipment!.status).toBe('IN_TRANSIT');
    expect(shipment!.arrival_tick).toBe(tick1.seq + 3n);

    // Turlar geçer, mal varır
    await runTick(sql);
    expect(await stockAt(buyer.facility.id)).toBe(0n); // henüz yolda
    await runTick(sql);
    const arrival = await runTick(sql);
    expect(await stockAt(buyer.facility.id)).toBe(qty(300));

    const ex = arrival.phases.EXCHANGE!.result as { shipmentsDelivered: number };
    expect(ex.shipmentsDelivered).toBe(1);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('nakliye SYS_SINK\'e gider — ekonomiden para çıkar', async () => {
    const seller = await trader('S', KON);
    const buyer = await trader('B', IST);
    await stockUp(seller.facility.inventoryId, qty(200));
    await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: KON, productId: IRON, side: 'SELL', quantity: qty(200), price: money(14) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(200), price: money(30) });
    await runTick(sql);

    const [shipping] = await sql<{ amount: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS amount FROM ledger_entries
      WHERE account = 'SHIPPING' AND direction = 'DEBIT'`;
    expect(shipping!.amount).toBeGreaterThan(0n);
  });

  it('★ nakliye dahil tavanı aşan uzak satıcı eşleşmez (madde 16)', async () => {
    const near = await trader('Bursa Satıcı', BRS);   // mesafe 1,5
    const far = await trader('Konya Satıcı', KON);    // mesafe 6,6
    const buyer = await trader('İstanbul Alıcı', IST);
    await stockUp(near.facility.inventoryId, qty(200));
    await stockUp(far.facility.inventoryId, qty(200));

    await placeOrder(sql, { companyId: near.id, facilityId: near.facility.id, cityId: BRS, productId: IRON, side: 'SELL', quantity: qty(200), price: money(17) });
    await placeOrder(sql, { companyId: far.id, facilityId: far.facility.id, cityId: KON, productId: IRON, side: 'SELL', quantity: qty(200), price: money(15) });
    // Nakliye: Bursa (mesafe 1,5) → 0,525 ₺/kg · Konya (mesafe 6,6) → 2,31 ₺/kg
    //   Bursa toplam: 17,00 + 0,525 = 17,525
    //   Konya toplam: 15,00 + 2,310 = 17,310
    // Tavan 17,40 ₺: YAKIN ama pahalı Bursa elenir, UZAK ama ucuz Konya geçer.
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(100), price: money(17.4) });

    await runTick(sql);
    const [trade] = await sql<{ seller_company_id: string }[]>`
      SELECT seller_company_id FROM market_trades`;
    expect(trade!.seller_company_id).toBe(far.id); // toplam maliyeti düşük olan
  });

  it('maksimum teslimat mesafesi uzak satıcıyı eler', async () => {
    const far = await trader('Konya Satıcı', KON);
    const buyer = await trader('İstanbul Alıcı', IST);
    await stockUp(far.facility.inventoryId, qty(200));
    await placeOrder(sql, { companyId: far.id, facilityId: far.facility.id, cityId: KON, productId: IRON, side: 'SELL', quantity: qty(200), price: money(10) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(100), price: money(30), maxDistance: 2 });

    await runTick(sql);
    expect(await sql`SELECT id FROM market_trades`).toHaveLength(0);
  });
});

describe('emir defteri davranışı', () => {
  it('birden çok satıcıdan kısmi doldurur', async () => {
    const s1 = await trader('S1', IST);
    const s2 = await trader('S2', IST);
    const buyer = await trader('B', IST);
    await stockUp(s1.facility.inventoryId, qty(100));
    await stockUp(s2.facility.inventoryId, qty(100));
    await placeOrder(sql, { companyId: s1.id, facilityId: s1.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(100), price: money(14) });
    await placeOrder(sql, { companyId: s2.id, facilityId: s2.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(100), price: money(16) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(150), price: money(25) });

    const tick = await runTick(sql);
    expect((tick.phases.EXCHANGE!.result as { matches: number }).matches).toBe(2);
    expect(await stockAt(buyer.facility.id)).toBe(qty(150));

    const [order] = await sql<{ status: string; remaining_quantity: bigint }[]>`
      SELECT status, remaining_quantity FROM market_orders WHERE side = 'BUY'`;
    expect(order!.status).toBe('FILLED');
  });

  it('satıcının malı yoksa eşleşme olmaz, emir açık kalır', async () => {
    const seller = await trader('S', IST);
    const buyer = await trader('B', IST);
    // stok YOK
    await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(100), price: money(14) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(100), price: money(25) });

    await runTick(sql);
    expect(await sql`SELECT id FROM market_trades`).toHaveLength(0);
    const [buy] = await sql<{ status: string }[]>`SELECT status FROM market_orders WHERE side='BUY'`;
    expect(buy!.status).toBe('OPEN');
  });

  it('★ alıcının parası yetmezse satıcı stoğunu kaybetmez', async () => {
    const seller = await trader('S', IST);
    const buyer = await trader('B', IST, money(10)); // neredeyse parasız
    await stockUp(seller.facility.inventoryId, qty(500));
    await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(500), price: money(16) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(500), price: money(20) });

    await runTick(sql);
    expect(await stockAt(seller.facility.id)).toBe(qty(500)); // stok yerinde
    expect(await stockAt(buyer.facility.id)).toBe(0n);
    const [buy] = await sql<{ status: string }[]>`SELECT status FROM market_orders WHERE side='BUY'`;
    expect(buy!.status).toBe('OPEN'); // emir açık kaldı
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('süresi dolan emir kapanır', async () => {
    const seller = await trader('S', IST);
    await stockUp(seller.facility.inventoryId, qty(100));
    await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(100), price: money(14), expiresAtTick: 1n });
    await runTick(sql);
    const [order] = await sql<{ status: string }[]>`SELECT status FROM market_orders WHERE side='SELL'`;
    expect(order!.status).toBe('EXPIRED');
  });

  it('kendi emrine eşleşmez', async () => {
    const t = await trader('Tek', IST);
    const second = await makeFacility(sql, t.id, { typeCode: 'MARKET', cityId: IST });
    await stockUp(t.facility.inventoryId, qty(200));
    await placeOrder(sql, { companyId: t.id, facilityId: t.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(200), price: money(14) });
    await placeOrder(sql, { companyId: t.id, facilityId: second.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(200), price: money(25) });
    await runTick(sql);
    expect(await sql`SELECT id FROM market_trades`).toHaveLength(0);
  });
});

describe('idempotency', () => {
  it('aynı tur iki kez koşarsa işlem tekrarlanmaz', async () => {
    const seller = await trader('S', IST);
    const buyer = await trader('B', IST);
    await stockUp(seller.facility.inventoryId, qty(300));
    await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(300), price: money(16) });
    await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(100), price: money(20) });

    const tick = await runTick(sql);
    const buyerCash = await cashOf(sql, buyer.id);
    const [{ count: trades }] = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM market_trades`;

    await sql`UPDATE tick_phase_runs SET status = 'PENDING' WHERE tick_id = ${tick.tickId}`;
    await sql`UPDATE economic_ticks SET status = 'RUNNING' WHERE id = ${tick.tickId}`;
    await runTick(sql);

    expect(await cashOf(sql, buyer.id)).toBe(buyerCash);
    const [{ count: after }] = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM market_trades`;
    expect(after).toBe(trades);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });
});

describe('★ aynı depoya çoklu sevkiyat (F8 bulgusu)', () => {
  it('bir sevkiyatın taşması turu düşürmez, kısmi teslim edilir', async () => {
    // Boş kapasite döngüden önce tek sorguda okunuyordu; aynı depoya iki
    // sevkiyat geldiğinde ikincisi bayat değeri kullanıp depoyu taşırıyor ve
    // TÜM TUR çöküyordu.
    const buyer = await makePlayer(sql, money(500_000), 'Alıcı A.Ş.');
    const small = await makeFacility(sql, buyer.id, {
      typeCode: 'KIOSK', cityId: 1, capacity: qty(300),
    });
    const s1 = await makePlayer(sql, money(100_000), 'Satıcı 1');
    const s2 = await makePlayer(sql, money(100_000), 'Satıcı 2');
    const f1 = await makeFacility(sql, s1.id, { typeCode: 'GREENGROCER', cityId: 1 });
    const f2 = await makeFacility(sql, s2.id, { typeCode: 'GREENGROCER', cityId: 1 });

    for (const [company, facility] of [[s1, f1], [s2, f2]] as const) {
      await runInTransaction(sql, (tx) => addBatch(tx, {
        inventoryId: facility.inventoryId, productId: IRON,
        quantity: qty(200), unitCost: money(10), quality: 70, producedAtTick: 0n,
      }));
      await placeOrder(sql, {
        companyId: company.id, facilityId: facility.id, cityId: 1, productId: IRON,
        side: 'SELL', quantity: qty(200), price: money(12),
      });
    }
    await placeOrder(sql, {
      companyId: buyer.id, facilityId: small.id, cityId: 1, productId: IRON,
      side: 'BUY', quantity: qty(400), price: money(20),
    });

    // Tur ÇÖKMEMELİ; depo 300 birim alır, kalanı bekler.
    const tick = await runTick(sql);
    expect(tick.skipped).toBe(false);
    const exchange = tick.phases.EXCHANGE!.result as { matches: number };
    expect(exchange.matches).toBeGreaterThan(0);

    const [inv] = await sql<{ used: bigint; capacity: bigint }[]>`
      SELECT used_capacity AS used, capacity FROM inventories
       WHERE facility_id = ${small.id}::uuid`;
    expect(inv!.used).toBeLessThanOrEqual(inv!.capacity);
  });
});
