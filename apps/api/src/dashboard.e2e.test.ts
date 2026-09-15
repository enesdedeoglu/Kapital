import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { TICK_MINUTES } from '@kapital/shared';
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
             price_history, company_financials, facility_financials, economy_snapshots
             RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
    DELETE FROM world_events;
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

/** Şu anki tur sırası — `currentTickSeq` ile aynı tanım (en büyük seq). */
async function simdikiTur(): Promise<bigint> {
  const [row] = await sql<{ seq: bigint | null }[]>`SELECT MAX(seq) AS seq FROM economic_ticks`;
  return row?.seq ?? 0n;
}

async function oyuncu() {
  const reg = await call('/auth/register', {
    method: 'POST',
    body: { email: `ozet-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Oyuncu' },
  });
  const token = reg.body.accessToken as string;
  const company = await call('/company', {
    method: 'POST', token,
    body: { name: 'Özet A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
  });
  return { token, companyId: company.body.id as string };
}

/**
 * Ana sayfa özeti (F9) — beş şeyi TEK yanıtta verir. Bölünürse mobilde beş
 * gidiş-dönüş olur ve ekran karışık turlardan derlenir.
 */
describe('GET /dashboard — ana sayfa özeti', () => {
  it('şirketi olmayan oyuncuya 404 döner', async () => {
    const reg = await call('/auth/register', {
      method: 'POST',
      body: { email: `bos-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Boş' },
    });
    const res = await call('/dashboard', { token: reg.body.accessToken as string });
    expect(res.status).toBe(404);
  });

  it('kimliksiz istek reddedilir', async () => {
    const res = await call('/dashboard');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('taze şirkette tur bilgisi gelir, K/Z sıfırdır, listeler boştur', async () => {
    const { token } = await oyuncu();
    const res = await call('/dashboard', { token });

    expect(res.status).toBe(200);
    expect(res.body.tur.dakika).toBe(TICK_MINUTES);
    expect(typeof res.body.tur.seq).toBe('string');
    // Henüz hiç finansal kayıt yok: sıfır uydurulmaz, sıfır ÖLÇÜLÜR.
    expect(res.body.kar.net).toBe('0');
    // ★ Bakiye yoksa oran NULL'dır — sıfıra bölüp 0 veya Infinity yazılmaz.
    expect(res.body.kar.oran).toBeNull();
    expect(res.body.kritikStok).toEqual([]);
    expect(res.body.olaylar).toEqual([]);
  });

  it('BEKLEYEN tur varsa sonraki turun zamanı gelir', async () => {
    const { token } = await oyuncu();
    const seq = await simdikiTur();
    await sql`
      INSERT INTO economic_ticks (seq, scheduled_at, status, rng_seed)
      VALUES (${seq + 1n}, NOW() + INTERVAL '15 minutes', 'PENDING', 1)`;

    const res = await call('/dashboard', { token });
    expect(res.body.tur.sonraki).not.toBeNull();
    expect(new Date(res.body.tur.sonraki as string).getTime()).toBeGreaterThan(Date.now());
  });

  /*
   * ★ BU TEST ESKİDEN YANLIŞ KURALI SABİTLİYORDU.
   *
   * "Bekleyen tur yoksa null" diyordu. Oysa NORMAL İŞLEYİŞTE BEKLEYEN TUR HİÇ
   * OLMAZ: `orchestrator` bekleyen satır bulamayınca turu kendisi açıp anında
   * koşuyor, zamanlayıcı da (`worker/scheduler.ts` → `planCatchUp`) "ne zaman"
   * sorusunu satır durumundan değil son TAMAMLANAN turun üstünden geçen
   * süreden cevaplıyor. Yani kural gerçek kurulumda hep null döndürürdü ve
   * geri sayım sonsuza dek "bekleniyor" derdi — canlı güncelleme de bu saate
   * dayandığı için hiç çalışmazdı.
   *
   * Yerelde hatanın görünmemesinin tek sebebi tohumun bıraktığı PENDING
   * satırıydı; onu gizleyen bir tesadüf.
   *
   * "Uydurma zaman yazılmaz" ilkesi duruyor: zamanlayıcının KENDİ ölçütünü
   * uygulamak uydurmak değildir. Gerçekten bilinmeyen hâl — hiç tamamlanmış
   * tur olmaması — hâlâ null döner; `packages/db` içindeki `nextTickAt`
   * testleri o dört durumu ayrı ayrı sabitliyor.
   */
  it('★ bekleyen tur YOKSA son TAMAMLANAN turun üstüne tur süresi eklenir', async () => {
    const { token } = await oyuncu();
    await sql`UPDATE economic_ticks SET status = 'COMPLETED' WHERE status = 'PENDING'`;
    const [son] = await sql<{ completed_at: Date }[]>`
      SELECT completed_at FROM economic_ticks WHERE status = 'COMPLETED'
       ORDER BY seq DESC LIMIT 1`;

    const res = await call('/dashboard', { token });
    expect(res.body.tur.sonraki).not.toBeNull();
    expect(new Date(res.body.tur.sonraki as string).getTime())
      .toBe(new Date(son!.completed_at).getTime() + TICK_MINUTES * 60_000);
  });

  it('etkin dünya olayı çarpanlarıyla birlikte listelenir', async () => {
    const { token } = await oyuncu();
    const seq = await simdikiTur();
    // SECTOR kapsamı `category` ZORUNLU kılar (world_events_scope_fields).
    await sql`
      INSERT INTO world_events (code, name, description, scope, category,
                                demand_multiplier, supply_multiplier, cost_multiplier,
                                start_tick, end_tick)
      VALUES ('DROUGHT', 'Kuraklık', 'Hasat düştü.', 'SECTOR', 'AGRICULTURE',
              1.0, 0.55, 1.15, ${seq}, ${seq + 100n})`;

    const res = await call('/dashboard', { token });
    expect(res.body.olaylar).toHaveLength(1);
    const o = res.body.olaylar[0];
    expect(o.kod).toBe('DROUGHT');
    expect(o.arz).toBeCloseTo(0.55, 5);
    expect(o.kalanTur).toBe(100);
  });

  it('süresi geçmiş olay listelenmez', async () => {
    const { token } = await oyuncu();
    const seq = await simdikiTur();
    /*
     * Pencere `end_tick > start_tick` olmak ZORUNDA (world_events_window).
     * Tur sıfırdayken geçmişe tarih atılamaz, o yüzden önce turu ilerletiriz:
     * testin kurgusu şemanın kuralını çiğnememeli.
     */
    await sql`
      INSERT INTO economic_ticks (seq, scheduled_at, status, rng_seed)
      VALUES (${seq + 50n}, NOW(), 'COMPLETED', 1)`;
    await sql`
      INSERT INTO world_events (code, name, description, scope,
                                demand_multiplier, supply_multiplier, cost_multiplier,
                                start_tick, end_tick)
      VALUES ('FESTIVAL', 'Festival', 'Bitti.', 'GLOBAL', 1.5, 1.0, 1.0,
              ${seq + 10n}, ${seq + 20n})`;

    const res = await call('/dashboard', { token });
    expect(res.body.olaylar).toEqual([]);
  });
});
