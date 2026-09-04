import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createSql, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
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
  await sql`TRUNCATE standing_orders RESTART IDENTITY CASCADE`;
});

async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  headers['idempotency-key'] = randomUUID();
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function playerWithShop() {
  const reg = await call('/auth/register', {
    method: 'POST',
    body: { email: `s-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Oyuncu' },
  });
  const token = reg.body.accessToken as string;
  const co = await call('/company', {
    method: 'POST', token,
    body: { name: 'Kalıcı Ticaret', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
  });
  const facilities = await call('/facilities', { token });
  if (!Array.isArray(facilities.body) || facilities.body.length === 0) {
    throw new Error(`tesis listesi boş: ${facilities.status} ${JSON.stringify(facilities.body)}`);
  }
  return { token, companyId: co.body.id as string, facilityId: facilities.body[0].id as string };
}

describe('kalıcı emir uçları', () => {
  it('kural oluşturur ve okunur', async () => {
    const { token, facilityId } = await playerWithShop();
    const res = await call('/standing-orders', {
      method: 'PUT', token,
      body: { facilityId, productCode: 'TOMATO', kind: 'RESTOCK', targetQuantity: 400 },
    });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('RESTOCK');

    const list = await call('/standing-orders', { token });
    expect(list.body).toHaveLength(1);
  });

  it('★ kuralın ne yapacağı düz Türkçe anlatılır — deneyerek öğrenilmemeli', async () => {
    const { token, facilityId } = await playerWithShop();
    const res = await call('/standing-orders', {
      method: 'PUT', token,
      body: {
        facilityId, productCode: 'TOMATO', kind: 'RESTOCK',
        targetQuantity: 400, maxPricePerUnit: 18,
      },
    });
    expect(res.body.explanation).toContain('400');
    expect(res.body.explanation).toContain('altına düşünce');
    expect(res.body.explanation).toContain('18,00 ₺');
  });

  it('aynı tesis+ürün+tür için kural güncellenir, ikinci satır açılmaz', async () => {
    const { token, facilityId } = await playerWithShop();
    const body = { facilityId, productCode: 'TOMATO', kind: 'RESTOCK', targetQuantity: 400 };
    await call('/standing-orders', { method: 'PUT', token, body });
    await call('/standing-orders', {
      method: 'PUT', token, body: { ...body, targetQuantity: 900 },
    });

    const list = await call('/standing-orders', { token });
    expect(list.body).toHaveLength(1);
    expect(list.body[0].targetQuantity).toBe('900000');
  });

  it('★ seviye kilidi burada da geçerli', async () => {
    const { token, facilityId } = await playerWithShop();
    const res = await call('/standing-orders', {
      method: 'PUT', token,
      body: { facilityId, productCode: 'STEEL', kind: 'RESTOCK', targetQuantity: 100 },
    });
    expect(res.status).toBe(403); // LEVEL_LOCKED → 403 (domain-error.filter)
    expect(res.body.code).toBe('LEVEL_LOCKED');
  });

  it('başkasının tesisine kural konamaz', async () => {
    const a = await playerWithShop();
    const b = await playerWithShop();
    const res = await call('/standing-orders', {
      method: 'PUT', token: b.token,
      body: { facilityId: a.facilityId, productCode: 'TOMATO', kind: 'RESTOCK', targetQuantity: 100 },
    });
    expect(res.status).toBe(404);
  });

  it('yanlış fiyat alanı reddedilir', async () => {
    const { token, facilityId } = await playerWithShop();
    const res = await call('/standing-orders', {
      method: 'PUT', token,
      body: {
        facilityId, productCode: 'TOMATO', kind: 'RESTOCK',
        targetQuantity: 400, minPricePerUnit: 5,
      },
    });
    expect(res.status).toBe(400); // VALIDATION → 400
  });

  it('kural silinir', async () => {
    const { token, facilityId } = await playerWithShop();
    const created = await call('/standing-orders', {
      method: 'PUT', token,
      body: { facilityId, productCode: 'TOMATO', kind: 'RESTOCK', targetQuantity: 400 },
    });
    const res = await call(`/standing-orders/${created.body.id}`, { method: 'DELETE', token });
    expect(res.status).toBe(200);
    expect((await call('/standing-orders', { token })).body).toHaveLength(0);
  });
});
