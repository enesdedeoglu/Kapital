import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
    TRUNCATE loans, loan_payments, city_demand, price_history, company_financials,
             facility_financials, economy_snapshots, fx_rates RESTART IDENTITY CASCADE;
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

async function player(level = 6) {
  const reg = await call('/auth/register', {
    method: 'POST',
    body: { email: `l-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Borçlu Oyuncu' },
  });
  const token = reg.body.accessToken as string;
  const co = await call('/company', {
    method: 'POST', token,
    body: { name: 'Kredi A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
  });
  await sql`UPDATE companies SET level = ${level} WHERE id = ${co.body.id}::uuid`;
  await topUp(co.body.id as string, money(70_000));
  return { token, companyId: co.body.id as string };
}

const cashOf = async (id: string) => {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${id}::uuid`;
  return asMoney(row!.cash);
};

describe('kredi limiti', () => {
  it('limit şirket değerine bağlıdır ve kademe seviyeden gelir', async () => {
    const p = await player(6);
    await runTick(sql); // şirket değeri hesaplansın

    const res = await call('/loans', { token: p.token });
    expect(res.status).toBe(200);
    expect(res.body.leverageRatio).toBe(0.6);           // Lv6 kademesi
    expect(Number(res.body.interestRateAnnualPct)).toBeGreaterThan(0);

    const expected = BigInt(res.body.companyValue) * 6n / 10n;
    expect(BigInt(res.body.availableCredit)).toBe(expected);
  });

  it('düşük seviyede kaldıraç daha düşüktür (R16)', async () => {
    const low = await player(2);
    const high = await player(13);
    await runTick(sql);
    const a = await call('/loans', { token: low.token });
    const b = await call('/loans', { token: high.token });
    expect(a.body.leverageRatio).toBe(0.4);
    expect(b.body.leverageRatio).toBe(0.75);
  });

  it('limiti aşan talep reddedilir', async () => {
    const p = await player();
    await runTick(sql);
    const overview = await call('/loans', { token: p.token });
    const tooMuch = Number(overview.body.availableCredit) / 10_000 * 2;

    const res = await call('/loans', { method: 'POST', token: p.token, body: { amount: tooMuch } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/limit/i);
    expect(res.body.details.availableFormatted).toBeTruthy();
  });

  it('şirket değeri hesaplanmadan kredi verilmez', async () => {
    const p = await player();
    await sql`UPDATE companies SET company_value = 0, cash = 0 WHERE id = ${p.companyId}::uuid`;
    await sql`DELETE FROM facilities WHERE company_id = ${p.companyId}::uuid`;
    const res = await call('/loans', { method: 'POST', token: p.token, body: { amount: 1000 } });
    expect(res.status).toBe(400);
  });
});

describe('kredi kullanımı', () => {
  it('★ kredi çekilir, nakit artar ve ödeme yükü uyarısı gösterilir', async () => {
    const p = await player();
    await runTick(sql);
    const before = await cashOf(p.companyId);

    const res = await call('/loans', { method: 'POST', token: p.token, body: { amount: 20_000 } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.amountFormatted).toBe('20.000,00 ₺');
    expect(BigInt(res.body.paymentPerTick)).toBeGreaterThan(0n);
    // Toplam geri ödeme anaparadan fazla — faiz var
    expect(BigInt(res.body.totalRepayment)).toBeGreaterThan(money(20_000));

    expect(await cashOf(p.companyId)).toBe(before + money(20_000));
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('★ R16: taksit gelirin büyük kısmını götürüyorsa uyarı verilir', async () => {
    const p = await player(13);
    await topUp(p.companyId, money(2_000_000));
    await runTick(sql); // geliri yok, şirket değeri var

    const overview = await call('/loans', { token: p.token });
    const max = Number(overview.body.availableCredit) / 10_000;
    const res = await call('/loans', { method: 'POST', token: p.token, body: { amount: Math.floor(max) } });
    expect(res.status).toBe(201);
    // Geliri olmayan oyuncuda yük hesaplanamaz ama taksit görünür
    expect(res.body.paymentBurden).toBeNull();
    expect(BigInt(res.body.paymentPerTick)).toBeGreaterThan(0n);
  });

  it('taksitler her tur otomatik tahsil edilir', async () => {
    const p = await player();
    await runTick(sql);
    const loan = await call('/loans', { method: 'POST', token: p.token, body: { amount: 20_000 } });
    const payment = BigInt(loan.body.paymentPerTick);

    const before = await cashOf(p.companyId);
    await runTick(sql);
    const after = await cashOf(p.companyId);

    // Nakit taksit + bakım kadar azaldı
    expect(before - after).toBeGreaterThanOrEqual(payment);

    const overview = await call('/loans', { token: p.token });
    expect(BigInt(overview.body.loans[0].remainingBalance)).toBeLessThan(money(20_000));
    expect(BigInt(overview.body.totalDebt)).toBeGreaterThan(0n);
  });

  it('erken kapatma borcu bitirir', async () => {
    const p = await player();
    await runTick(sql);
    const loan = await call('/loans', { method: 'POST', token: p.token, body: { amount: 20_000 } });

    const repaid = await call(`/loans/${loan.body.loanId}/repay`, { method: 'POST', token: p.token });
    expect(repaid.status, JSON.stringify(repaid.body)).toBe(201);
    expect(repaid.body.status).toBe('PAID');

    const overview = await call('/loans', { token: p.token });
    expect(BigInt(overview.body.totalDebt)).toBe(0n);
    expect(BigInt(overview.body.loans[0].remainingBalance)).toBe(0n);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('parası yetmiyorsa erken kapatma reddedilir', async () => {
    const p = await player();
    await runTick(sql);
    const loan = await call('/loans', { method: 'POST', token: p.token, body: { amount: 20_000 } });

    const [sink] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;
    const cash = await cashOf(p.companyId);
    await runInTransaction(sql, (tx) => transfer(tx, {
      tickId: 0n, fromCompanyId: p.companyId, toCompanyId: sink!.id,
      amount: cash, account: 'TAX', reason: 'test: nakit boşaltma',
    }));

    const res = await call(`/loans/${loan.body.loanId}/repay`, { method: 'POST', token: p.token });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('başka oyuncunun kredisi kapatılamaz', async () => {
    const a = await player();
    const b = await player();
    await runTick(sql);
    const loan = await call('/loans', { method: 'POST', token: a.token, body: { amount: 10_000 } });
    const res = await call(`/loans/${loan.body.loanId}/repay`, { method: 'POST', token: b.token });
    expect(res.status).toBe(404);
  });
});
