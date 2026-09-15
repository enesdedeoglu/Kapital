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
    TRUNCATE retail_sales, company_financials, production_records RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
    DELETE FROM world_notices;
  `);
});

async function call(path: string, init: { token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: JSON.parse(await res.text()) };
}

async function oyuncu() {
  const reg = await fetch(`${base}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `rapor-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Oyuncu',
    }),
  });
  const token = (await reg.json()).accessToken as string;
  const co = await fetch(`${base}/company`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Rapor A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' }),
  });
  return { token, companyId: (await co.json()).id as string };
}

/** Turları ilerletir — rapor penceresi bunun üzerinden kurulur. */
async function turlar(kac: number) {
  for (let i = 1; i <= kac; i++) {
    await sql`
      INSERT INTO economic_ticks (seq, scheduled_at, status, completed_at, rng_seed, season)
      VALUES (${i}, NOW(), 'COMPLETED', NOW(), 1, 0)`;
  }
}

/**
 * "Sen yokken ne oldu" raporu — madde 45.
 *
 * ★ Uç SAF bir işlevdir: (şirket, sinceTick) → rapor. Sunucu "en son ne zaman
 * baktın" işareti TUTMAZ — tutsaydı `GET` yan etkili olur, raporu çağıran her
 * istek işareti ileri atar ve rapor bir daha okunamazdı.
 */
describe('GET /report — sen yokken', () => {
  it('kaçırılan tur yoksa yeniMi false döner', async () => {
    const p = await oyuncu();
    await turlar(5);
    const res = await call('/report?sinceTick=5', { token: p.token });
    expect(res.status).toBe(200);
    expect(res.body.yeniMi).toBe(false);
    expect(res.body.pencere.turSayisi).toBe(0);
  });

  it('pencere tur sayısını ve süreyi bildirir', async () => {
    const p = await oyuncu();
    await turlar(10);
    const res = await call('/report?sinceTick=4', { token: p.token });
    expect(res.body.pencere.turSayisi).toBe(6);
    expect(res.body.pencere.dakika).toBe(6 * TICK_MINUTES);
    expect(res.body.pencere.kirpildi).toBe(false);
  });

  /*
   * ★ Bir ay sonra dönen oyuncu için 2880 turu taramak hem yavaş hem okunamaz
   * bir rapor üretirdi. Kırpıldığını SÖYLERİZ: "şu kadar kazandın" derken
   * aslında son 7 günü topladığımızı gizlemek yanlış bilgi olurdu.
   */
  it('çok eski pencere 7 günle kırpılır ve kırpıldığı bildirilir', async () => {
    const p = await oyuncu();
    await turlar(96 * 9);
    const res = await call('/report?sinceTick=1', { token: p.token });
    expect(res.body.pencere.kirpildi).toBe(true);
    expect(res.body.pencere.turSayisi).toBe(96 * 7);
  });

  it('satışlar ciroya göre sıralı gelir ve pencere DIŞI satış sayılmaz', async () => {
    const p = await oyuncu();
    await turlar(10);
    const [tesis] = await sql<{ id: string; city_id: number }[]>`
      SELECT id, city_id FROM facilities WHERE company_id = ${p.companyId}::uuid`;
    const satis = (tick: number, productId: number, adet: number, ciro: number) => sql`
      INSERT INTO retail_sales (tick_id, facility_id, product_id, company_id, city_id,
                                quantity, unit_price, revenue, cogs, avg_quality, market_share)
      VALUES (${tick}, ${tesis!.id}::uuid, ${productId}, ${p.companyId}::uuid, ${tesis!.city_id},
              ${adet * 1000}, 10000, ${ciro * 10000}, 0, 80, 0.1)`;

    await satis(3, 4, 10, 100);   // pencere DIŞI (sinceTick=5)
    await satis(7, 4, 20, 200);   // Domates
    await satis(8, 1, 50, 900);   // Buğday — ciro daha yüksek

    const res = await call('/report?sinceTick=5', { token: p.token });
    const s = res.body.satislar as { urunKodu: string; ciro: string }[];
    expect(s).toHaveLength(2);
    // Ciroya göre azalan: önce Buğday.
    expect(BigInt(s[0]!.ciro)).toBeGreaterThan(BigInt(s[1]!.ciro));
    // Pencere dışındaki 100 ₺ toplama GİRMEMELİ.
    expect(res.body.kar.ciro).toBe('0'); // company_financials boş; satış ayrı tablo
    const toplam = s.reduce((a, x) => a + BigInt(x.ciro), 0n);
    expect(toplam).toBe(BigInt(1100 * 10000));
  });

  /*
   * ★ RAF BOŞALMASI — perakendecinin başına gelen bir numaralı şey.
   *
   * İlk sürümde rapor yalnız ÜRETİM duruşlarına bakıyordu; her yeni oyuncu
   * perakendeci olduğu için pratikte hiçbir sorun göstermiyordu. Simülatörde
   * tam da bu oldu: raf boşaldı, satış durdu, rapor "her şey yolunda" dedi.
   *
   * Ölçüt İKİ koşulun birlikte sağlanması — yalnız "stok sıfır" demek hiç mal
   * konmamış rafı da sorun sayardı, yalnız "satış durdu" demek talebin düştüğü
   * turları sorun sayardı.
   */
  it('pencerede satıp stoğu biten ürün SORUN olarak bildirilir', async () => {
    const p = await oyuncu();
    await turlar(10);
    const [tesis] = await sql<{ id: string; city_id: number }[]>`
      SELECT id, city_id FROM facilities WHERE company_id = ${p.companyId}::uuid`;
    await sql`
      INSERT INTO retail_sales (tick_id, facility_id, product_id, company_id, city_id,
                                quantity, unit_price, revenue, cogs, avg_quality, market_share)
      VALUES (7, ${tesis!.id}::uuid, 4, ${p.companyId}::uuid, ${tesis!.city_id},
              5000, 10000, 500000, 0, 80, 0.1)`;

    const res = await call('/report?sinceTick=5', { token: p.token });
    const sorunlar = res.body.sorunlar as { mesaj: string; sure: string; turSayisi: number }[];
    expect(sorunlar).toHaveLength(1);
    expect(sorunlar[0]!.mesaj).toContain('rafı boşaldı');
    // Son satış 7. turda, şimdi 10 → 3 turdur satış yok.
    expect(sorunlar[0]!.turSayisi).toBe(3);
    /*
     * ★ Süre CÜMLESİ sunucuda kurulur. Panel önce hepsini "N turda" diye
     * yazıyordu, oysa sayı üretimde "kaç turda durdu", rafta "kaç turdur satış
     * yok" demek — aynı rakam iki ayrı anlam. Anlamı bilen yer sunucudur.
     */
    expect(sorunlar[0]!.sure).toBe('3 turdur satış yok');
  });

  it('stoğu duran ürün sorun sayılmaz', async () => {
    const p = await oyuncu();
    await turlar(10);
    const [tesis] = await sql<{ id: string; city_id: number }[]>`
      SELECT id, city_id FROM facilities WHERE company_id = ${p.companyId}::uuid`;
    const [inv] = await sql<{ id: string }[]>`
      SELECT id FROM inventories WHERE facility_id = ${tesis!.id}::uuid`;
    await sql`
      INSERT INTO retail_sales (tick_id, facility_id, product_id, company_id, city_id,
                                quantity, unit_price, revenue, cogs, avg_quality, market_share)
      VALUES (7, ${tesis!.id}::uuid, 4, ${p.companyId}::uuid, ${tesis!.city_id},
              5000, 10000, 500000, 0, 80, 0.1)`;
    await sql`
      INSERT INTO inventory_batches (inventory_id, product_id, quantity, reserved_quantity,
                                     quality, unit_cost, produced_in_tick)
      VALUES (${inv!.id}::uuid, 4, 50000, 0, 80, 10000, 7)`;

    const res = await call('/report?sinceTick=5', { token: p.token });
    expect(res.body.sorunlar).toEqual([]);
  });

  it('sinceTick sayı değilse 400 döner', async () => {
    const p = await oyuncu();
    const res = await call('/report?sinceTick=abc', { token: p.token });
    expect(res.status).toBe(400);
  });

  it('kimliksiz istek reddedilir', async () => {
    const res = await call('/report');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
