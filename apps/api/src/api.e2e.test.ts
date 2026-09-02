import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { checkInvariants, createSql, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { AppModule } from './app.module.js';
import { DomainErrorFilter } from './common/domain-error.filter.js';

let app: INestApplication;
let base: string;
let sql: Sql;

beforeAll(async () => {
  // DATABASE_URL zaten vitest.setup.ts'te test veritabanına sabitlendi
  const prep = await prepareTestDb();
  await prep.end({ timeout: 5 });

  sql = createSql({ url: process.env.TEST_DATABASE_URL });
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new DomainErrorFilter());
  await app.listen(0);
  base = await app.getUrl().then((u) => u.replace('[::1]', '127.0.0.1'));
});

afterAll(async () => {
  await app?.close();
  await sql?.end({ timeout: 5 });
});

beforeEach(async () => { await truncateGameState(sql); });

async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string; idem?: string } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.idem) headers['idempotency-key'] = init.idem;
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const newUser = () => ({
  email: `u-${randomUUID()}@kapital.test`,
  password: 'cok-guclu-parola',
  displayName: 'Test Oyuncu',
});

describe('sağlık', () => {
  it('GET /health açıktır ve veritabanına ulaşır', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/invariants ihlal bildirmez', async () => {
    const res = await call('/health/invariants');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('auth', () => {
  it('kayıt olur, giriş yapar, token yeniler', async () => {
    const user = newUser();
    const reg = await call('/auth/register', { method: 'POST', body: user });
    expect(reg.status).toBe(201);
    expect(reg.body.accessToken).toBeTruthy();
    expect(reg.body.hasCompany).toBe(false);

    const login = await call('/auth/login', {
      method: 'POST', body: { email: user.email, password: user.password },
    });
    expect(login.status).toBe(200);

    const refreshed = await call('/auth/refresh', {
      method: 'POST', body: { refreshToken: login.body.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    // Rotasyon: kullanılmış refresh token bir daha geçmez
    const reuse = await call('/auth/refresh', {
      method: 'POST', body: { refreshToken: login.body.refreshToken },
    });
    expect(reuse.status).toBe(404);
  });

  it('yanlış parolayı ve tekrarlı e-postayı reddeder', async () => {
    const user = newUser();
    await call('/auth/register', { method: 'POST', body: user });

    const dup = await call('/auth/register', { method: 'POST', body: user });
    expect(dup.status).toBe(409);

    const bad = await call('/auth/login', {
      method: 'POST', body: { email: user.email, password: 'yanlis-parola' },
    });
    expect(bad.status).toBe(403);
  });

  it('geçersiz girdiyi 400 ile reddeder', async () => {
    const res = await call('/auth/register', {
      method: 'POST', body: { email: 'gecersiz', password: 'kisa', displayName: 'A' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.details.issues.length).toBeGreaterThanOrEqual(3);
  });

  it('korumalı uç oturumsuz erişilemez', async () => {
    expect((await call('/company')).status).toBe(403);
  });
});

describe('şirket kurma', () => {
  async function register() {
    const res = await call('/auth/register', { method: 'POST', body: newUser() });
    return res.body.accessToken as string;
  }

  it('şirket kurar ve başlangıç sermayesi deftere yazılır', async () => {
    const token = await register();
    const res = await call('/company', {
      method: 'POST', token, idem: randomUUID(),
      body: { name: 'Anadolu Ticaret', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
    });

    expect(res.status).toBe(201);
    expect(res.body.cash).toBe('300000000');          // 30.000 ₺ · scale 4
    expect(res.body.cashFormatted).toBe('30.000,00 ₺');
    expect(res.body.city.name).toBe('İstanbul');
    expect(res.body.level).toBe(1);
    expect(res.body.levelTitle).toBe('Esnaf');

    // Sermaye SYS_TREASURY'den geldi; kredi ile karışmadı (R15 metriği temiz kalsın)
    const [row] = await sql<{ account: string; amount: bigint }[]>`
      SELECT l.account, l.amount FROM ledger_entries l
      JOIN companies c ON c.id = l.company_id
      WHERE c.name = 'Anadolu Ticaret' AND l.direction = 'CREDIT'`;
    expect(row!.account).toBe('SEED');
    expect(row!.amount).toBe(300000000n);

    const report = await checkInvariants(sql);
    expect(report.ok).toBe(true);
  });

  it('ikinci şirketi reddeder', async () => {
    const token = await register();
    const body = { name: 'İlk', cityCode: 'ANK', facilityTypeCode: 'KIOSK' };
    expect((await call('/company', { method: 'POST', token, body })).status).toBe(201);
    const second = await call('/company', {
      method: 'POST', token, body: { ...body, name: 'İkinci' },
    });
    expect(second.status).toBe(409);
  });

  it('bilinmeyen şehri ve izinsiz işletme türünü reddeder', async () => {
    const token = await register();
    expect((await call('/company', {
      method: 'POST', token, body: { name: 'Test', cityCode: 'XXX', facilityTypeCode: 'KIOSK' },
    })).status).toBe(404);

    expect((await call('/company', {
      method: 'POST', token, body: { name: 'Test', cityCode: 'IST', facilityTypeCode: 'STEEL_MILL' },
    })).status).toBe(400);
  });
});

describe('T5 — idempotency', () => {
  it('aynı Idempotency-Key ile 5 istek tek şirket oluşturur', async () => {
    const reg = await call('/auth/register', { method: 'POST', body: newUser() });
    const token = reg.body.accessToken as string;
    const idem = randomUUID();
    const body = { name: 'Çift Dokunma A.Ş.', cityCode: 'IZM', facilityTypeCode: 'GREENGROCER' };

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await call('/company', { method: 'POST', token, idem, body }));
    }

    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);

    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM companies WHERE name = 'Çift Dokunma A.Ş.'`;
    expect(count).toBe(1n);

    // Tek sermaye aktarımı yapıldı.
    // ::bigint şart: Postgres'te SUM(bigint) → numeric, o da string olarak gelir.
    const [{ total }] = await sql<{ total: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM ledger_entries
      WHERE account = 'SEED' AND direction = 'CREDIT'`;
    expect(total).toBe(300000000n);
  });

  it('aynı anahtar farklı gövdeyle kullanılırsa 409 verir', async () => {
    const reg = await call('/auth/register', { method: 'POST', body: newUser() });
    const token = reg.body.accessToken as string;
    const idem = randomUUID();

    await call('/company', {
      method: 'POST', token, idem,
      body: { name: 'İlk Ad', cityCode: 'IST', facilityTypeCode: 'KIOSK' },
    });
    const conflict = await call('/company', {
      method: 'POST', token, idem,
      body: { name: 'Başka Ad', cityCode: 'IST', facilityTypeCode: 'KIOSK' },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_MISMATCH');
  });
});
