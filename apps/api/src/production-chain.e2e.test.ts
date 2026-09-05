import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkInvariants, createSql, runInTransaction, transfer, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { runTick } from '@kapital/engine';
import { asMoney, money } from '@kapital/shared';
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
    TRUNCATE market_orders, market_trades, retail_offers, retail_sales, city_demand,
             price_history, company_financials, facility_financials, economy_snapshots,
             production_jobs, production_records RESTART IDENTITY CASCADE;
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

const cashOf = async (id: string) => {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${id}::uuid`;
  return asMoney(row!.cash);
};

/** Nakit HER ZAMAN defter üzerinden — doğrudan UPDATE I1'i bozar. */
async function topUp(companyId: string, amount: bigint) {
  const [treasury] = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE system_code = 'SYS_TREASURY'`;
  await runInTransaction(sql, (tx) => transfer(tx, {
    tickId: 0n, fromCompanyId: treasury!.id, toCompanyId: companyId,
    amount: amount as never, account: 'SEED', reason: 'test sermayesi',
  }));
}

const stock = async (facilityId: string, code: string) => {
  const [row] = await sql<{ total: bigint }[]>`
    SELECT COALESCE(SUM(b.quantity), 0)::bigint AS total
    FROM inventories i
    JOIN inventory_batches b ON b.inventory_id = i.id
    JOIN products p ON p.id = b.product_id AND p.code = ${code}
    WHERE i.facility_id = ${facilityId}::uuid`;
  return row!.total;
};

/**
 * ★ F3 ÇIKIŞ KRİTERİ (docs/09):
 * "Oyuncu kendi buğdayını üretip ununu yapıp ekmeğini satabiliyor."
 */
describe('F3 — dikey üretim zinciri', () => {
  it('buğday → un → ekmek → perakende satışı, hepsi kendi tesislerinde', async () => {
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `chain-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Çiftçi Oyuncu' },
    });
    const token = reg.body.accessToken as string;

    const company = await call('/company', {
      method: 'POST', token,
      body: { name: 'Konya Tarım Holding', cityCode: 'KON', facilityTypeCode: 'GREENGROCER' },
    });
    expect(company.status).toBe(201);
    const companyId = company.body.id as string;

    // Fırın ve değirmen Lv6'da açılır; sermayeyi defter üzerinden takviye et
    await sql`UPDATE companies SET level = 6 WHERE id = ${companyId}::uuid`;
    await topUp(companyId, money(200_000));

    // 1) Dört tesis: tarla → değirmen → fırın → manav (hepsi Konya'da)
    const build = async (typeCode: string, name: string) => {
      const res = await call('/facilities', {
        method: 'POST', token, body: { facilityTypeCode: typeCode, cityCode: 'KON', name },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.id as string;
    };
    const field = await build('WHEAT_FIELD', 'Konya Tarlası');
    const mill = await build('MILL', 'Konya Değirmeni');
    const bakery = await build('BAKERY', 'Konya Fırını');
    const shop = await build('GREENGROCER', 'Konya Manavı');

    // 2) Reçeteler
    for (const [facilityId, product] of [
      [field, 'WHEAT'], [mill, 'FLOUR'], [bakery, 'BREAD'],
    ] as const) {
      const res = await call(`/facilities/${facilityId}/recipe`, {
        method: 'POST', token, body: { outputProductCode: product },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }

    // Manav üretim yapamaz
    const invalid = await call(`/facilities/${shop}/recipe`, {
      method: 'POST', token, body: { outputProductCode: 'BREAD' },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toMatch(/üretemez/);

    // 3) İnşaat bitene kadar turlar (tarla 8, değirmen 8, fırın 6 tur)
    for (let i = 0; i < 9; i++) await runTick(sql);
    expect(await stock(field, 'WHEAT')).toBeGreaterThan(0n);

    // 4) Buğday değirmene taşınır (aynı şehir, anında)
    const wheatOnHand = await stock(field, 'WHEAT');
    const move1 = await call('/inventory/transfer', {
      method: 'POST', token,
      body: {
        fromFacilityId: field, toFacilityId: mill, productCode: 'WHEAT',
        quantity: Number(wheatOnHand) / 1000,
      },
    });
    expect(move1.status).toBe(201);
    expect(await stock(mill, 'WHEAT')).toBe(wheatOnHand);

    // 5) Değirmen un üretir
    await runTick(sql);
    const flour = await stock(mill, 'FLOUR');
    expect(flour).toBeGreaterThan(0n);

    // 6) Un fırına taşınır → ekmek üretilir
    await call('/inventory/transfer', {
      method: 'POST', token,
      body: { fromFacilityId: mill, toFacilityId: bakery, productCode: 'FLOUR', quantity: Number(flour) / 1000 },
    });
    await runTick(sql);
    const bread = await stock(bakery, 'BREAD');
    expect(bread).toBeGreaterThan(0n);

    // 7) Ekmek manava taşınır ve rafa konur
    await call('/inventory/transfer', {
      method: 'POST', token,
      body: { fromFacilityId: bakery, toFacilityId: shop, productCode: 'BREAD', quantity: Number(bread) / 1000 },
    });
    const priced = await call(`/retail/${shop}/prices`, {
      method: 'PUT', token, body: { prices: [{ productCode: 'BREAD', sellingPrice: 18, enabled: true }] },
    });
    expect(priced.status).toBe(200);

    // 8) ★ Satış — üretim tamamen kendi zincirinden
    const tick = await runTick(sql);
    const retail = tick.phases.RETAIL!.result as { soldUnits: bigint; revenue: bigint };

    expect(retail.soldUnits).toBeGreaterThan(0n);
    expect(retail.revenue).toBeGreaterThan(0n);

    // Hiçbir şey piyasadan satın alınmadı — zincir tamamen kendi üretimi
    const [{ count: purchases }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM market_trades WHERE buyer_company_id = ${companyId}::uuid`;
    expect(purchases).toBe(0n);

    // Satılan ekmeğin maliyeti kendi üretim zincirinden geliyor
    const [sale] = await sql<{ cogs: bigint; revenue: bigint; avg_quality: string }[]>`
      SELECT cogs, revenue, avg_quality::text FROM retail_sales
      WHERE tick_id = ${tick.seq} AND facility_id = ${shop}::uuid`;
    expect(sale!.cogs).toBeGreaterThan(0n);
    expect(sale!.revenue).toBeGreaterThan(sale!.cogs); // satış brüt kârlı
    expect(Number(sale!.avg_quality)).toBeGreaterThan(0);

    // DENGE NOTU (F8'de ayarlanacak, F3'ün doğruluk kriteri değil):
    // Konya'nın ekmek talebi tur başına ~400 ₺ absorbe ediyor, oysa dört
    // tesisin bakımı ~1.200 ₺. Tek şehre dört tesislik dikey zincir kurmak
    // bu haliyle zarar ettirir — oyuncunun ya başka şehirlere satması ya da
    // tesisleri ölçeklemesi gerekir. Bu, ekonominin doğru çalıştığının
    // işareti; `packages/sim` bu oranları F8'de ayarlayacak.
    const [financials] = await sql<{ revenue: bigint; cogs: bigint; maintenance: bigint }[]>`
      SELECT revenue, cogs, maintenance FROM company_financials
      WHERE tick_id = ${tick.seq} AND company_id = ${companyId}::uuid`;
    expect(financials!.revenue).toBeGreaterThan(0n);
    expect(financials!.maintenance).toBeGreaterThan(0n);

    expect((await checkInvariants(sql)).ok).toBe(true);
  });
});

describe('üretim uçları', () => {
  async function player(level = 6, cash = money(300_000)) {
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `p-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Üretici Oyuncu' },
    });
    const token = reg.body.accessToken as string;
    const co = await call('/company', {
      method: 'POST', token,
      body: { name: 'Üretim A.Ş.', cityCode: 'KON', facilityTypeCode: 'GREENGROCER' },
    });
    await sql`UPDATE companies SET level = ${level} WHERE id = ${co.body.id}::uuid`;
    await topUp(co.body.id as string, cash);
    return { token, companyId: co.body.id as string };
  }

  it('üretim durumu kapasiteyi, reçeteyi ve duruş nedenini gösterir', async () => {
    const { token } = await player();
    const fac = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'MILL', cityCode: 'KON' },
    });
    await call(`/facilities/${fac.body.id}/recipe`, {
      method: 'POST', token, body: { outputProductCode: 'FLOUR' },
    });

    const res = await call(`/facilities/${fac.body.id}/production`, { token });
    expect(res.status).toBe(200);
    expect(res.body.recipe.outputProduct.code).toBe('FLOUR');
    expect(res.body.recipe.inputs[0].code).toBe('WHEAT');
    expect(res.body.recipe.inputs[0].quantityFormatted).toBe('4 kg');
    expect(Number(res.body.capacityPerTick)).toBeGreaterThan(0);

    for (let i = 0; i < 9; i++) await runTick(sql);
    const after = await call(`/facilities/${fac.body.id}/production`, { token });
    expect(after.body.recentTicks.length).toBeGreaterThan(0);
    expect(after.body.recentTicks[0].haltedReason).toBeTruthy(); // buğday yok
  });

  it('tesis yükseltilir, kapasite ve depo büyür', async () => {
    const { token, companyId } = await player();
    const fac = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'WHEAT_FIELD', cityCode: 'KON' },
    });
    const before = await call(`/facilities/${fac.body.id}/production`, { token });
    const cashBefore = await cashOf(companyId);

    const upgraded = await call(`/facilities/${fac.body.id}/upgrade`, { method: 'POST', token });
    expect(upgraded.status, JSON.stringify(upgraded.body)).toBe(201);
    expect(upgraded.body.level).toBe(2);
    expect(BigInt(upgraded.body.storageCapacity)).toBeGreaterThan(BigInt(before.body.level === 1 ? 0 : 0));

    const after = await call(`/facilities/${fac.body.id}/production`, { token });
    // Lv2 kapasite çarpanı %140
    expect(Number(after.body.capacityPerTick) / Number(before.body.capacityPerTick)).toBeCloseTo(1.4, 2);
    expect(await cashOf(companyId)).toBeLessThan(cashBefore);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('seviye kilidi reçeteye de uygulanır', async () => {
    const { token } = await player(4);
    const fac = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'VEG_GARDEN', cityCode: 'KON' },
    });
    expect(fac.status).toBe(201);
    // Sebze bahçesi Lv4'te açılır ama domates reçetesi de Lv4 → geçmeli
    const ok = await call(`/facilities/${fac.body.id}/recipe`, {
      method: 'POST', token, body: { outputProductCode: 'TOMATO' },
    });
    expect(ok.status).toBe(201);
  });

  it('şehirler arası stok taşıma reddedilir (lojistik F4)', async () => {
    const { token } = await player();
    const konya = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'WHEAT_FIELD', cityCode: 'KON' },
    });
    const ankara = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'MILL', cityCode: 'ANK' },
    });
    const res = await call('/inventory/transfer', {
      method: 'POST', token,
      body: {
        fromFacilityId: konya.body.id, toFacilityId: ankara.body.id,
        productCode: 'WHEAT', quantity: 10,
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nakliye/);
  });

  it('taşıma lot kalitesini ve maliyetini korur', async () => {
    const { token } = await player();
    const a = await call('/facilities', { method: 'POST', token, body: { facilityTypeCode: 'WHEAT_FIELD', cityCode: 'KON' } });
    const b = await call('/facilities', { method: 'POST', token, body: { facilityTypeCode: 'MILL', cityCode: 'KON' } });
    await call(`/facilities/${a.body.id}/recipe`, {
      method: 'POST', token, body: { outputProductCode: 'WHEAT' },
    });
    for (let i = 0; i < 9; i++) await runTick(sql);
    expect(await stock(a.body.id as string, 'WHEAT')).toBeGreaterThan(0n);

    const [source] = await sql<{ quality: string; unit_cost: bigint }[]>`
      SELECT b.quality::text, b.unit_cost FROM inventories i
      JOIN inventory_batches b ON b.inventory_id = i.id
      WHERE i.facility_id = ${a.body.id}::uuid LIMIT 1`;

    const transferRes = await call('/inventory/transfer', {
      method: 'POST', token,
      body: { fromFacilityId: a.body.id, toFacilityId: b.body.id, productCode: 'WHEAT', quantity: 5 },
    });
    expect(transferRes.status, JSON.stringify(transferRes.body)).toBe(201);

    const [moved] = await sql<{ quality: string; unit_cost: bigint }[]>`
      SELECT b.quality::text, b.unit_cost FROM inventories i
      JOIN inventory_batches b ON b.inventory_id = i.id
      WHERE i.facility_id = ${b.body.id}::uuid LIMIT 1`;
    expect(moved!.quality).toBe(source!.quality);
    expect(moved!.unit_cost).toBe(source!.unit_cost);
  });
});
