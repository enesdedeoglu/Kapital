import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { checkInvariants, createSql, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { runTick } from '@kapital/engine';
import { formatMoney, asMoney, money, qty } from '@kapital/shared';
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
  // Tur sayacını ve tur çıktılarını sıfırla — her senaryo genesis'ten başlar
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, retail_offers, retail_sales, city_demand,
             price_history, company_financials, facility_financials, economy_snapshots
             RESTART IDENTITY CASCADE;
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

const cashOf = async (companyId: string) => {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${companyId}::uuid`;
  return asMoney(row!.cash);
};

/**
 * ★ F2 GEÇİŞ KAPISI — MVP-0 kabul testi (docs/08).
 *
 * "Bu çekirdek sorunsuz çalışmadan ileri özelliklere geçme." (madde 59)
 */
describe('MVP-0 — Domates Döngüsü', () => {
  it('şirket kur → manav aç → domates al → fiyat koy → tur koş → para artsın', async () => {
    // 1) Oyuncu kaydolur ve şirket kurar
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `mvp-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Oyuncu' },
    });
    const token = reg.body.accessToken as string;

    const company = await call('/company', {
      method: 'POST', token,
      body: { name: 'Domates A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
    });
    expect(company.status).toBe(201);
    expect(company.body.cash).toBe(money(30_000).toString());
    const companyId = company.body.id as string;

    // 2) Manav açar
    const facility = await call('/facilities', {
      method: 'POST', token,
      body: { facilityTypeCode: 'GREENGROCER', cityCode: 'IST', name: 'Kadıköy Manav' },
    });
    expect(facility.status).toBe(201);
    const facilityId = facility.body.id as string;
    const afterBuild = await cashOf(companyId);
    expect(afterBuild).toBe(money(18_000)); // 30.000 − 8.000×1,50

    // 3) İlk tur: NPC arzı oluşur, inşaat biter
    const tick1 = await runTick(sql);
    expect(tick1.seq).toBe(1n);
    expect((tick1.phases.OPEN!.result as { npcOffersRefreshed: number }).npcOffersRefreshed).toBe(5);

    const offers = await call('/market/IST?product=TOMATO', { token });
    expect(offers.body.length).toBeGreaterThan(0);
    expect(offers.body[0].seller.kind).toBe('NPC');

    // 4) Piyasadan 200 kg domates alır
    const purchase = await call('/market/buy', {
      method: 'POST', token,
      body: { facilityId, productCode: 'TOMATO', quantity: 200 },
    });
    expect(purchase.status).toBe(201);
    expect(purchase.body.purchasedFormatted).toBe('200 kg');
    expect(purchase.body.complete).toBe(true);
    const afterPurchase = await cashOf(companyId);
    expect(afterPurchase).toBeLessThan(afterBuild); // para çıktı

    const stock = await call(`/facilities/${facilityId}/stock`, { token });
    expect(stock.body.products[0].name).toBe('Domates');
    expect(stock.body.products[0].total).toBe(qty(200).toString());

    // 5) Satış fiyatını belirler
    const priced = await call(`/retail/${facilityId}/prices`, {
      method: 'PUT', token,
      body: { prices: [{ productCode: 'TOMATO', sellingPrice: 22, enabled: true }] },
    });
    expect(priced.status).toBe(200);
    expect(priced.body[0].sellingPriceFormatted).toBe('22,00 ₺');
    expect(priced.body[0].aboveCeiling).toBe(false); // 22 < 15×3

    // 6) Ekonomik tur çalışır → NPC tüketiciler satın alır
    const tick2 = await runTick(sql);
    expect(tick2.seq).toBe(2n);
    const retail = tick2.phases.RETAIL!.result as { soldUnits: bigint; revenue: bigint; markets: number };
    expect(retail.soldUnits).toBeGreaterThan(0n);
    expect(retail.revenue).toBeGreaterThan(0n);

    // 7) ★ Oyuncunun parası arttı
    const afterSale = await cashOf(companyId);
    expect(afterSale).toBeGreaterThan(afterPurchase);

    // 8) Kâr raporu
    const [financials] = await sql<{
      revenue: bigint; cogs: bigint; maintenance: bigint; net_profit: bigint; company_value: bigint;
    }[]>`SELECT revenue, cogs, maintenance, net_profit, company_value
         FROM company_financials WHERE tick_id = 2 AND company_id = ${companyId}::uuid`;
    expect(financials!.revenue).toBeGreaterThan(0n);
    expect(financials!.cogs).toBeGreaterThan(0n);
    expect(financials!.maintenance).toBe(money(120)); // manav bakımı
    expect(financials!.net_profit).toBeGreaterThan(0n); // ★ kâr etti
    expect(financials!.company_value).toBeGreaterThan(money(18_000)); // stok + tesis dahil

    // Tesis bazlı kâr/zarar (madde 46)
    const [byFacility] = await sql<{ revenue: bigint; net_profit: bigint }[]>`
      SELECT revenue, net_profit FROM facility_financials
      WHERE tick_id = 2 AND facility_id = ${facilityId}::uuid`;
    expect(byFacility!.revenue).toBeGreaterThan(0n);

    // Para arzı bütünlüğü bozulmadı
    expect((await checkInvariants(sql)).ok).toBe(true);

    // Paranın oyuna girişi SADECE perakendeden oldu
    const [faucet] = await sql<{ amount: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS amount FROM ledger_entries
      WHERE tick_id = 2 AND account = 'SALES' AND direction = 'CREDIT'`;
    expect(faucet!.amount).toBe(retail.revenue);
  });
});

describe('tur motoru', () => {
  it('tur numarası artar ve fazlar sırayla tamamlanır', async () => {
    const first = await runTick(sql);
    const second = await runTick(sql);
    expect(second.seq).toBe(first.seq + 1n);

    const phases = await sql<{ phase: number; phase_code: string; status: string }[]>`
      SELECT phase, phase_code, status FROM tick_phase_runs
      WHERE tick_id = ${second.tickId} ORDER BY phase`;
    expect(phases.map((p) => p.phase_code))
      .toEqual(['OPEN', 'PRODUCE', 'RETAIL', 'UPKEEP', 'SETTLE', 'CLOSE']);
    expect(phases.every((p) => p.status === 'COMPLETED')).toBe(true);
  });

  it('faz süre bütçelerini ölçer', async () => {
    const tick = await runTick(sql);
    for (const [code, phase] of Object.entries(tick.phases)) {
      expect(phase.overBudget, `${code} bütçeyi aştı`).toBe(false);
    }
  });

  it('her turda ekonomi fotoğrafı yazılır', async () => {
    await runTick(sql);
    const [snap] = await sql<{ total_money_supply: string; active_companies: number }[]>`
      SELECT total_money_supply, active_companies FROM economy_snapshots ORDER BY tick_id DESC LIMIT 1`;
    expect(snap).toBeDefined();
    expect(Number(snap!.total_money_supply)).toBeGreaterThanOrEqual(0);
  });

  it('referans fiyat işlem yokken taban fiyata düşer', async () => {
    await runTick(sql);
    const [row] = await sql<{ ema_reference: bigint }[]>`
      SELECT ema_reference FROM price_history
      WHERE product_id = 4 AND city_id = 0 ORDER BY tick_id DESC LIMIT 1`;
    expect(row!.ema_reference).toBe(money(15)); // domates taban referansı
  });

  it('★ idempotent: aynı tur iki kez koşarsa etki tekrarlanmaz', async () => {
    // Satış yapan bir kurulum hazırla
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `idem-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Idem Oyuncu' },
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const token = reg.body.accessToken as string;
    const co = await call('/company', {
      method: 'POST', token, body: { name: 'Idem A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
    });
    expect(co.status, JSON.stringify(co.body)).toBe(201);
    const fac = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'GREENGROCER', cityCode: 'IST' },
    });
    expect(fac.status, JSON.stringify(fac.body)).toBe(201);
    const warmup = await runTick(sql);
    expect(warmup.skipped, 'tur atlandı — kilit tutulu').toBe(false);
    const bought = await call('/market/buy', {
      method: 'POST', token, body: { facilityId: fac.body.id, productCode: 'TOMATO', quantity: 200 },
    });
    expect(bought.status, JSON.stringify(bought.body)).toBe(201);
    await call(`/retail/${fac.body.id}/prices`, {
      method: 'PUT', token, body: { prices: [{ productCode: 'TOMATO', sellingPrice: 22, enabled: true }] },
    });

    const tick = await runTick(sql);
    const cashAfterFirst = await cashOf(co.body.id);
    const [salesAfterFirst] = await sql<{ count: bigint; total: bigint }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(revenue),0)::bigint AS total
      FROM retail_sales WHERE tick_id = ${tick.seq}`;

    // Fazları PENDING'e çekip aynı turu tekrar koştur
    await sql`UPDATE tick_phase_runs SET status = 'PENDING' WHERE tick_id = ${tick.tickId}`;
    await sql`UPDATE economic_ticks SET status = 'RUNNING' WHERE id = ${tick.tickId}`;
    const rerun = await runTick(sql);
    expect(rerun.seq).toBe(tick.seq); // aynı tur

    expect(await cashOf(co.body.id)).toBe(cashAfterFirst);
    const [salesAfterSecond] = await sql<{ count: bigint; total: bigint }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(revenue),0)::bigint AS total
      FROM retail_sales WHERE tick_id = ${tick.seq}`;
    expect(salesAfterSecond!.count).toBe(salesAfterFirst!.count);
    expect(salesAfterSecond!.total).toBe(salesAfterFirst!.total);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });
});

describe('★ R10 — perakende fiyatı sınırsız para basamaz', () => {
  it('rezervasyon fiyatı üstünde satış yapılamaz', async () => {
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `r10-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Tekel' },
    });
    const token = reg.body.accessToken as string;
    const co = await call('/company', {
      method: 'POST', token, body: { name: 'Tekel A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
    });
    const fac = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'GREENGROCER', cityCode: 'IST' },
    });
    await runTick(sql);
    await call('/market/buy', {
      method: 'POST', token, body: { facilityId: fac.body.id, productCode: 'TOMATO', quantity: 200 },
    });

    // Referansın 100 katı — rakip yok
    await call(`/retail/${fac.body.id}/prices`, {
      method: 'PUT', token, body: { prices: [{ productCode: 'TOMATO', sellingPrice: 1500, enabled: true }] },
    });
    const cashBefore = await cashOf(co.body.id);
    const tick = await runTick(sql);
    const retail = tick.phases.RETAIL!.result as { soldUnits: bigint };

    expect(retail.soldUnits).toBe(0n);                       // hiçbir şey satılmadı
    expect(await cashOf(co.body.id)).toBeLessThan(cashBefore); // yalnız bakım gideri çıktı
  });

  it('bütçe tavanı geliri sınırlar — gelir şehir bütçesini aşamaz', async () => {
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `bud-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Bütçe Oyuncu' },
    });
    const token = reg.body.accessToken as string;
    await call('/company', {
      method: 'POST', token, body: { name: 'Bütçe A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
    });
    const fac = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'GREENGROCER', cityCode: 'IST' },
    });
    await runTick(sql);
    await call('/market/buy', {
      method: 'POST', token, body: { facilityId: fac.body.id, productCode: 'TOMATO', quantity: 400 },
    });
    // Referansın 2 katı — tavanın altında ama pahalı
    await call(`/retail/${fac.body.id}/prices`, {
      method: 'PUT', token, body: { prices: [{ productCode: 'TOMATO', sellingPrice: 30, enabled: true }] },
    });
    const tick = await runTick(sql);
    expect(tick.skipped, 'tur atlandı — kilit tutulu').toBe(false);

    const [demand] = await sql<{ demand_budget: bigint; fulfilled_units: bigint; budget_limited_units: bigint }[]>`
      SELECT demand_budget, fulfilled_units, budget_limited_units FROM city_demand
      WHERE tick_id = ${tick.seq} AND city_id = 1 AND product_id = 4`;
    const [sale] = await sql<{ revenue: bigint }[]>`
      SELECT revenue FROM retail_sales WHERE tick_id = ${tick.seq} AND product_id = 4`;

    expect(sale!.revenue).toBeLessThanOrEqual(demand!.demand_budget);
    expect(demand!.budget_limited_units).toBeGreaterThan(0n); // talep bütçeye takıldı
  });
});
