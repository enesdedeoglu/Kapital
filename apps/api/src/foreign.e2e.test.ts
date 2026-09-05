/**
 * Dış ticaret uçtan uca — R44.
 *
 * Liman, kur, dünya fiyatı ve kapasite altyapısı F4'te kuruldu ve
 * `foreign-capacity` fazı her tur çalışıyor, ama HİÇBİR aktör bu yolu
 * kullanmıyordu: alım-satım yalnız oyuncuya açık uçtan yapılabiliyor, NPC'lerin
 * böyle bir davranışı yok ve simülasyon oyuncuları o ucu çağırmıyor. Liman
 * 200.000 ₺ / Lv7 / 20 tur inşaat olduğu için kapının 7 günlük ufkunda hiçbir
 * oyuncu oraya ulaşamıyor — `foreign_faucet` her koşuda %0,0 çıktı.
 *
 * Asıl risk R18'dir: ithalat sınırsız kâr getirirse dış ticaret ekonominin para
 * musluğunu ele geçirir ve iç üretim anlamsızlaşır. Para arzı zaten haftada
 * ~%56 büyüyor (F8 ölçümü); sınırsız bir arbitraj bunun üstüne binerdi.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createSql, transfer, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { runTick } from '@kapital/engine';
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
    TRUNCATE market_orders, market_trades, foreign_trades RESTART IDENTITY CASCADE;
    -- Kapasite satırları tur numarasına bağlıdır ve her test tur 1'den başlar:
    -- temizlenmezse önceki testin tükettiği kapasite devreder.
    TRUNCATE foreign_trade_capacity;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  headers['idempotency-key'] = randomUUID();
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET', headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Limanlı, seviye yeterli ve nakdi olan bir tüccar. */
async function trader(level = 7) {
  const reg = await call('/auth/register', {
    method: 'POST',
    body: { email: `f-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Tüccar' },
  });
  const token = reg.body.accessToken as string;
  const co = await call('/company', {
    method: 'POST', token,
    body: { name: 'Liman Ticaret', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
  });
  const companyId = co.body.id as string;

  // Liman 200.000 ₺ ve 20 tur inşaat: testte doğrudan kurulur, konu inşaat değil.
  await sql`UPDATE companies SET level = ${level} WHERE id = ${companyId}::uuid`;
  // ★ Nakit DEFTERDEN verilir: `companies.cash` türetilmiş bir alandır ve
  // doğrudan yazılırsa tur sonu değişmez denetimi haklı olarak patlar.
  const [treasury] = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE system_code = 'SYS_TREASURY'`;
  await sql.begin((tx) => transfer(tx as unknown as Sql, {
    tickId: 0n, fromCompanyId: treasury!.id, toCompanyId: companyId,
    amount: 5_000_000_000n as never, account: 'SEED', reason: 'test tüccar sermayesi',
  }));
  const [port] = await sql<{ id: string }[]>`
    INSERT INTO facilities (company_id, facility_type_id, city_id, name,
                            storage_capacity, construction_complete_at_tick)
    SELECT ${companyId}::uuid, ft.id, 1, 'Liman', ft.storage_capacity, 0
      FROM facility_types ft WHERE ft.code = 'PORT'
    RETURNING id`;
  // Envanter tesis eklenince tetikleyiciyle oluşur.
  return { token, companyId, portId: port!.id };
}

/**
 * ★ İthalat DÖVİZLE ödenir: oyuncu önce ₺ bozdurmak zorundadır. Bu, dış
 * ticareti kur riskine bağlar — ithalatçı yalnız mal fiyatını değil kuru da
 * üstlenir. Testin bunu atlaması, akışın yarısını sınamamak olurdu.
 */
async function buyUsd(token: string, usdAmount: number) {
  const res = await call('/foreign/fx/convert', {
    method: 'POST', token, body: { side: 'BUY_USD', usdAmount },
  });
  if (res.status !== 201) throw new Error(`döviz alınamadı: ${res.status} ${JSON.stringify(res.body)}`);
}

/**
 * Oyuncuya AÇIK ithalat kapasitesi (kg).
 *
 * Kapasite `talep × %15`tir ve ürün başına PAYLAŞILIR — Ekonomik Direktör'ün
 * acil rezerv alımları da aynı havuzdan yer. Boş test dünyasında her ürün
 * EMERGENCY olduğu için ED havuzu tüketiyor; burada konu oyuncunun yolu
 * olduğundan sayaç sıfırlanır. Havuzun PAYLAŞILDIĞI gerçeği ayrı testin konusu.
 */
async function importCapacityKg(productId: number) {
  await sql`
    UPDATE foreign_trade_capacity SET import_used = 0
     WHERE product_id = ${productId} AND tick_id = (SELECT MAX(seq) FROM economic_ticks)`;
  const [row] = await sql<{ cap: bigint }[]>`
    SELECT import_capacity AS cap FROM foreign_trade_capacity
     WHERE product_id = ${productId} AND tick_id = (SELECT MAX(seq) FROM economic_ticks)`;
  return Number(row!.cap) / 1000;
}

const usdOf = async (companyId: string) => {
  const [row] = await sql<{ usd_balance: bigint }[]>`
    SELECT usd_balance FROM companies WHERE id = ${companyId}::uuid`;
  return row!.usd_balance;
};

const cashOf = async (companyId: string) => {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${companyId}::uuid`;
  return row!.cash;
};

describe('dış ticaret — liman uçları (R44)', () => {
  it('seviye yetmezse ithalat reddedilir', async () => {
    const { token, portId } = await trader(6);
    await runTick(sql);
    const res = await call('/foreign/import', {
      method: 'POST', token,
      body: { facilityId: portId, productCode: 'WHEAT', quantity: 10 },
    });
    expect(res.status).toBe(403);
  });

  it('liman olmayan tesisten dış ticaret yapılamaz', async () => {
    const { token } = await trader();
    await runTick(sql);
    const facilities = await call('/facilities', { token });
    const manav = facilities.body.find((f: { name: string }) => !f.name.includes('Liman'));
    const res = await call('/foreign/import', {
      method: 'POST', token,
      body: { facilityId: manav.id, productCode: 'WHEAT', quantity: 10 },
    });
    expect(res.status).toBe(400);
  });

  it('★ ithalat uçtan uca çalışır: döviz çıkar, mal girer', async () => {
    const { token, companyId, portId } = await trader();
    await runTick(sql);
    await buyUsd(token, 500);
    const kg = await importCapacityKg(1);
    expect(kg).toBeGreaterThan(0);
    const usdBefore = await usdOf(companyId);

    const res = await call('/foreign/import', {
      method: 'POST', token,
      body: { facilityId: portId, productCode: 'WHEAT', quantity: kg },
    });
    expect(res.status).toBe(201);

    // ★ İthalat DÖVİZLE ödenir: ₺ bakiyesi değil, USD bakiyesi düşer.
    expect(await usdOf(companyId)).toBeLessThan(usdBefore);

    const [stock] = await sql<{ qty: string }[]>`
      SELECT COALESCE(SUM(b.quantity), 0)::text AS qty FROM inventory_batches b
      JOIN inventories i ON i.id = b.inventory_id
      WHERE i.facility_id = ${portId}::uuid AND b.product_id = 1`;
    expect(BigInt(stock!.qty)).toBeGreaterThan(0n);
  });

  it('★ ithal edileni hemen ihraç etmek ZARARDIR — para basma makinesi yok (R18)', async () => {
    const { token, companyId, portId } = await trader();
    await runTick(sql);
    await buyUsd(token, 500);
    const kg = await importCapacityKg(1);
    const usdBefore = await usdOf(companyId);

    const imp = await call('/foreign/import', {
      method: 'POST', token,
      body: { facilityId: portId, productCode: 'WHEAT', quantity: kg },
    });
    expect(imp.status).toBe(201);

    const exp = await call('/foreign/export', {
      method: 'POST', token,
      body: { facilityId: portId, productCode: 'WHEAT', quantity: kg },
    });
    expect(exp.status).toBe(201);

    /*
     * ★ İthalat dünya fiyatının 1,35 katı, ihracat 0,75 katı: %60'lık makas
     * turu kapatanı ZARARDA bırakır. Bu, dış ticaretin ekonominin para
     * musluğunu ele geçirmesini engelleyen birinci savunmadır (R18); ikincisi
     * tur başına kapasite tavanıdır.
     */
    expect(await usdOf(companyId)).toBeLessThan(usdBefore);
  });

  it('ihracat döviz getirir ve malı götürür', async () => {
    const { token, companyId, portId } = await trader();
    await runTick(sql);
    await buyUsd(token, 500);
    const kg = await importCapacityKg(1);
    await call('/foreign/import', {
      method: 'POST', token,
      body: { facilityId: portId, productCode: 'WHEAT', quantity: kg },
    });
    const before = await usdOf(companyId);
    const res = await call('/foreign/export', {
      method: 'POST', token,
      body: { facilityId: portId, productCode: 'WHEAT', quantity: kg / 2 },
    });
    expect(res.status).toBe(201);
    expect(await usdOf(companyId)).toBeGreaterThan(before);
  });
});
