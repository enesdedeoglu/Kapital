import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  addBatch, checkInvariants, createSql, runInTransaction, transfer, type Sql,
} from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { runTick } from '@kapital/engine';
import { money, qty } from '@kapital/shared';
import { AppModule } from './app.module.js';
import { DomainErrorFilter } from './common/domain-error.filter.js';

let app: INestApplication;
let base: string;
let sql: Sql;

beforeAll(async () => {
  const prep = await prepareTestDb();
  await prep.end({ timeout: 5 });
  sql = createSql({ url: process.env.TEST_DATABASE_URL });
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new DomainErrorFilter());
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => { await app?.close(); await sql?.end({ timeout: 5 }); });

beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE city_demand, price_history, company_financials, facility_financials,
             economy_snapshots, fx_rates, foreign_trade_capacity RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  headers['idempotency-key'] = randomUUID();
  const res = await fetch(base + path, {
    method: init.method ?? 'GET', headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function topUp(companyId: string, amount: bigint) {
  const [treasury] = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE system_code = 'SYS_TREASURY'`;
  await runInTransaction(sql, (tx) => transfer(tx, {
    tickId: 0n, fromCompanyId: treasury!.id, toCompanyId: companyId,
    amount: amount as never, account: 'SEED', reason: 'test sermayesi',
  }));
}

/** Şirket + tesis kuran oyuncu. */
async function player(opts: { cityCode?: string; level?: number; cash?: bigint; facility?: string } = {}) {
  const reg = await call('/auth/register', {
    method: 'POST',
    body: { email: `m-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Tüccar Oyuncu' },
  });
  const token = reg.body.accessToken as string;
  const co = await call('/company', {
    method: 'POST', token,
    body: { name: 'Tüccar A.Ş.', cityCode: opts.cityCode ?? 'IST', facilityTypeCode: 'GREENGROCER' },
  });
  await sql`UPDATE companies SET level = ${opts.level ?? 15} WHERE id = ${co.body.id}::uuid`;
  await topUp(co.body.id as string, opts.cash ?? money(1_000_000));

  const fac = await call('/facilities', {
    method: 'POST', token,
    body: { facilityTypeCode: opts.facility ?? 'MARKET', cityCode: opts.cityCode ?? 'IST' },
  });
  expect(fac.status, JSON.stringify(fac.body)).toBe(201);
  return { token, companyId: co.body.id as string, facilityId: fac.body.id as string };
}

const stockUp = async (facilityId: string, productId: number, amount: bigint) => {
  const [inv] = await sql<{ id: string }[]>`
    SELECT id FROM inventories WHERE facility_id = ${facilityId}::uuid`;
  await runInTransaction(sql, (tx) => addBatch(tx, {
    inventoryId: inv!.id, productId, quantity: amount, quality: 80,
    unitCost: money(20), producedInTick: 0n, expiresAtTick: null,
  }));
};

const IRON = 7;

describe('emir defteri', () => {
  it('emir verir, listeler ve iptal eder', async () => {
    const p = await player();
    await stockUp(p.facilityId, IRON, qty(500));

    const order = await call('/market/orders', {
      method: 'POST', token: p.token,
      body: { side: 'SELL', facilityId: p.facilityId, productCode: 'IRON', quantity: 500, pricePerUnit: 30 },
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body.side).toBe('SELL');
    expect(order.body.pricePerUnitFormatted).toBe('30,00 ₺');
    expect(order.body.quality).toBe(80); // stoktan türedi

    const list = await call('/market/orders', { token: p.token });
    expect(list.body).toHaveLength(1);

    const cancelled = await call(`/market/orders/${order.body.id}`, { method: 'DELETE', token: p.token });
    expect(cancelled.status).toBe(200);
    expect((await call('/market/orders', { token: p.token })).body).toHaveLength(0);
  });

  it('satılacak stok yoksa SELL emri reddedilir', async () => {
    const p = await player();
    const res = await call('/market/orders', {
      method: 'POST', token: p.token,
      body: { side: 'SELL', facilityId: p.facilityId, productCode: 'IRON', quantity: 100, pricePerUnit: 30 },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('seviye kilidi ticarete de uygulanır', async () => {
    const p = await player({ level: 5 });
    const res = await call('/market/orders', {
      method: 'POST', token: p.token,
      body: { side: 'BUY', facilityId: p.facilityId, productCode: 'IRON', quantity: 100, pricePerUnit: 30 },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LEVEL_LOCKED');
  });

  it('★ defter ürün fiyatı / nakliye / toplam maliyeti AYRI gösterir (madde 16)', async () => {
    const konya = await player({ cityCode: 'KON' });
    await stockUp(konya.facilityId, IRON, qty(500));
    await call('/market/orders', {
      method: 'POST', token: konya.token,
      body: { side: 'SELL', facilityId: konya.facilityId, productCode: 'IRON', quantity: 500, pricePerUnit: 25 },
    });

    const istanbul = await player({ cityCode: 'IST' });
    const book = await call('/market/book/IRON?city=IST', { token: istanbul.token });
    expect(book.status).toBe(200);

    const offer = book.body.sell.find((o: { city: { code: string } }) => o.city.code === 'KON');
    expect(offer.goodsPriceFormatted).toBe('25,00 ₺');
    expect(Number(offer.shippingPerUnit)).toBeGreaterThan(0);   // KON→IST mesafe 6,6
    expect(BigInt(offer.totalPerUnit)).toBe(BigInt(offer.goodsPrice) + BigInt(offer.shippingPerUnit));
    expect(offer.transitTicks).toBe(3);
  });
});

describe('★ şehirler arası ticaret (A3)', () => {
  it('mal yolda kalır, transit süresi sonunda varır ve ayrı listelenir', async () => {
    const seller = await player({ cityCode: 'KON' });
    const buyer = await player({ cityCode: 'IST' });
    await stockUp(seller.facilityId, IRON, qty(300));

    await call('/market/orders', {
      method: 'POST', token: seller.token,
      body: { side: 'SELL', facilityId: seller.facilityId, productCode: 'IRON', quantity: 300, pricePerUnit: 25 },
    });
    await call('/market/orders', {
      method: 'POST', token: buyer.token,
      body: { side: 'BUY', facilityId: buyer.facilityId, productCode: 'IRON', quantity: 300, pricePerUnit: 40 },
    });

    await runTick(sql);

    const inTransit = await call('/market/shipments', { token: buyer.token });
    expect(inTransit.body).toHaveLength(1);
    expect(inTransit.body[0].ticksRemaining).toBe(3);
    expect(inTransit.body[0].quantityFormatted).toBe('300 kg');

    // Mal henüz alıcının stoğunda değil
    const early = await call(`/facilities/${buyer.facilityId}/stock`, { token: buyer.token });
    expect(early.body.products).toHaveLength(0);

    await runTick(sql); await runTick(sql); await runTick(sql);

    const arrived = await call(`/facilities/${buyer.facilityId}/stock`, { token: buyer.token });
    expect(arrived.body.products[0].total).toBe(qty(300).toString());
    expect((await call('/market/shipments', { token: buyer.token })).body).toHaveLength(0);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });
});

describe('★ dış ticaret (docs/12)', () => {
  async function portOwner(cityCode = 'IZM') {
    const p = await player({ cityCode, level: 15, cash: money(5_000_000) });
    const port = await call('/facilities', {
      method: 'POST', token: p.token, body: { facilityTypeCode: 'PORT', cityCode },
    });
    expect(port.status, JSON.stringify(port.body)).toBe(201);
    // Liman inşaatı 20 tur
    for (let i = 0; i < 21; i++) await runTick(sql);
    return { ...p, portId: port.body.id as string };
  }

  it('kapasite ve dünya fiyatları listelenir — band ~%60', async () => {
    await runTick(sql);
    const p = await player();
    const res = await call('/foreign/capacity', { token: p.token });
    expect(res.status).toBe(200);

    const iron = res.body.products.find((x: { code: string }) => x.code === 'IRON');
    expect(iron.importable).toBe(true);
    const band = (Number(iron.importPriceUsd) - Number(iron.exportPriceUsd)) / Number(iron.worldPriceUsd);
    expect(band).toBeCloseTo(0.6, 2);

    // ★ Nihai perakende ürünü ithal EDİLEMEZ (docs/12 §3.4)
    const bread = res.body.products.find((x: { code: string }) => x.code === 'BREAD');
    expect(bread.importable).toBe(false);
    expect(bread.exportable).toBe(true);
  });

  it('döviz alınır, spread SYS_SINK\'e gider', async () => {
    await runTick(sql);
    const p = await player({ level: 15 });
    const before = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${p.companyId}::uuid`;

    const res = await call('/foreign/fx/convert', {
      method: 'POST', token: p.token, body: { side: 'BUY_USD', usdAmount: 1000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.balances.usd).toBe(money(1000).toString());

    const [after] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${p.companyId}::uuid`;
    // 1000 $ × 35 ₺ = 35.000 ₺ + %1,5 spread
    expect(before[0]!.cash - after!.cash).toBe(money(35_525));

    const [spread] = await sql<{ amount: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS amount FROM ledger_entries
      WHERE account = 'FX_SPREAD' AND direction = 'DEBIT'`;
    expect(spread!.amount).toBe(money(525));
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('★ USD defteri ₺ defterinden ayrı dengelidir', async () => {
    await runTick(sql);
    const p = await player({ level: 15 });
    await call('/foreign/fx/convert', { method: 'POST', token: p.token, body: { side: 'BUY_USD', usdAmount: 500 } });
    await call('/foreign/fx/convert', { method: 'POST', token: p.token, body: { side: 'SELL_USD', usdAmount: 200 } });

    const [totals] = await sql<{ try_total: string; usd_total: string }[]>`
      SELECT SUM(cash)::text AS try_total, SUM(usd_balance)::text AS usd_total FROM companies`;
    expect(BigInt(totals!.try_total)).toBe(0n);  // I1-TRY
    expect(BigInt(totals!.usd_total)).toBe(0n);  // I1-USD
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('seviye 7 altındaki oyuncu dış ticaret yapamaz', async () => {
    await runTick(sql);
    const p = await player({ level: 6 });
    const res = await call('/foreign/fx/convert', {
      method: 'POST', token: p.token, body: { side: 'BUY_USD', usdAmount: 100 },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LEVEL_LOCKED');
  });

  it('dış ticaret yalnız Liman üzerinden yapılır', async () => {
    await runTick(sql);
    const p = await player({ level: 15 });
    const res = await call('/foreign/import', {
      method: 'POST', token: p.token,
      body: { facilityId: p.facilityId, productCode: 'IRON', quantity: 10 },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Liman/);
  });

  it('★ ithalat ve ihracat çalışır, derinlik tavanı uygulanır', async () => {
    const p = await portOwner('IZM');
    await call('/foreign/fx/convert', { method: 'POST', token: p.token, body: { side: 'BUY_USD', usdAmount: 20_000 } });

    const capacityBefore = await call('/foreign/capacity', { token: p.token });
    const ironCap = capacityBefore.body.products.find((x: { code: string }) => x.code === 'IRON');
    const remaining = Number(ironCap.importRemaining) / 1000;
    expect(remaining).toBeGreaterThan(0);

    // Tavandan fazlasını istemek: yalnız tavan kadarı gelir
    const imported = await call('/foreign/import', {
      method: 'POST', token: p.token,
      body: { facilityId: p.portId, productCode: 'IRON', quantity: remaining * 10 },
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    expect(Number(imported.body.quantity) / 1000).toBeCloseTo(remaining, 3);
    expect(imported.body.complete).toBe(false); // ★ tavana takıldı

    // Aynı turda ikinci ithalat kapasite dolduğu için reddedilir
    const again = await call('/foreign/import', {
      method: 'POST', token: p.token,
      body: { facilityId: p.portId, productCode: 'IRON', quantity: 1 },
    });
    expect(again.status).toBe(409);

    // İhracat: ithal edilen malı geri sat — arbitraj değil, ZARAR olmalı
    const exported = await call('/foreign/export', {
      method: 'POST', token: p.token,
      body: { facilityId: p.portId, productCode: 'IRON', quantity: 1 },
    });
    expect(exported.status, JSON.stringify(exported.body)).toBe(201);
    expect(Number(exported.body.unitPriceUsd)).toBeLessThan(Number(imported.body.unitPriceUsd));

    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('nihai perakende ürünü ithal edilemez', async () => {
    const p = await portOwner('IZM');
    const res = await call('/foreign/import', {
      method: 'POST', token: p.token,
      body: { facilityId: p.portId, productCode: 'BREAD', quantity: 10 },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ithal edilemez/);
  });
});
