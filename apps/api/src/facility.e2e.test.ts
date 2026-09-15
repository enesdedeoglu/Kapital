import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkInvariants, createSql, runInTransaction, transfer, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { runTick } from '@kapital/engine';
import { asMoney, formatMoney, money, qty } from '@kapital/shared';
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
beforeEach(async () => { await truncateGameState(sql); });

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

/**
 * Nakit HER ZAMAN defter üzerinden değiştirilir — doğrudan UPDATE, I1'i
 * tanımı gereği bozar ve testi anlamsızlaştırır.
 */
async function moveCash(companyId: string, amount: bigint, direction: 'in' | 'out') {
  const code = direction === 'in' ? 'SYS_TREASURY' : 'SYS_SINK';
  const [system] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = ${code}`;
  await runInTransaction(sql, (tx) => transfer(tx, {
    tickId: 0n,
    fromCompanyId: direction === 'in' ? system!.id : companyId,
    toCompanyId: direction === 'in' ? companyId : system!.id,
    amount: amount as never,
    account: direction === 'in' ? 'SEED' : 'TAX',
    reason: 'test bakiye ayarı',
  }));
}

/** Kayıt olup şirket kuran bir oyuncu döndürür. */
async function player(cityCode = 'IST') {
  const reg = await call('/auth/register', {
    method: 'POST',
    body: { email: `f-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Oyuncu' },
  });
  const token = reg.body.accessToken as string;
  const co = await call('/company', {
    method: 'POST', token,
    body: { name: 'Test Ticaret', cityCode, facilityTypeCode: 'GREENGROCER' },
  });
  return { token, companyId: co.body.id as string };
}

describe('dünya uçları (oturumsuz)', () => {
  it('şehirleri parametreleriyle listeler', async () => {
    const res = await call('/cities');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    const ist = res.body.find((c: { code: string }) => c.code === 'IST');
    expect(ist.name).toBe('İstanbul');
    expect(ist.populationIndex).toBe(1.6);
    expect(ist.hasPort).toBe(true);
    expect(res.body.find((c: { code: string }) => c.code === 'KON').hasPort).toBe(false);
  });

  it('şehirler arası mesafe ve transit süresini verir', async () => {
    const res = await call('/cities/IST/distances');
    expect(res.status).toBe(200);
    const bursa = res.body.find((d: { cityCode: string }) => d.cityCode === 'BRS');
    expect(bursa.distanceIndex).toBe(1.5);
    expect(bursa.transitTicks).toBe(1);   // en yakın
    const konya = res.body.find((d: { cityCode: string }) => d.cityCode === 'KON');
    expect(konya.transitTicks).toBe(3);   // en uzak
  });

  it('ürünleri referans fiyat ve dış ticaret izinleriyle listeler', async () => {
    const res = await call('/products');
    expect(res.body).toHaveLength(10);
    const tomato = res.body.find((p: { code: string }) => p.code === 'TOMATO');
    expect(tomato.baseReferencePriceFormatted).toBe('15,00 ₺');
    expect(tomato.shelfLifeTicks).toBe(480);
    expect(tomato.trade.importable).toBe(false); // nihai perakende ürünü
    expect(tomato.trade.exportable).toBe(true);
    const steel = res.body.find((p: { code: string }) => p.code === 'STEEL');
    expect(steel.trade.importable).toBe(true);
  });

  it('tesis türlerini seviye kilidi ve liman şartıyla listeler', async () => {
    const res = await call('/facility-types');
    // Sayı tohumdan okunur: yeni tesis tipi eklendiğinde (F6'da mobilya
    // fabrikası) bu test kırılmasın, uç noktanın TÜMÜNÜ döndürdüğünü ölçsün.
    const [{ count }] = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM facility_types`;
    expect(res.body).toHaveLength(Number(count));
    const port = res.body.find((f: { code: string }) => f.code === 'PORT');
    expect(port.requiresPort).toBe(true);
    expect(port.unlockLevel).toBe(7);
    const shop = res.body.find((f: { code: string }) => f.code === 'GREENGROCER');
    const [seed] = await sql<{ base_cost: bigint }[]>`
      SELECT base_cost FROM facility_types WHERE code = 'GREENGROCER'`;
    expect(shop.baseCostFormatted).toBe(formatMoney(asMoney(seed!.base_cost)));
  });
});

/**
 * Tesis tipinin tohum değerleri. Sabit yazmak, tesis dengesi her
 * değiştiğinde (F8'de Manav 8.000 → 4.000 ₺, depo 2.000 → 3.000) testleri
 * kırar — oysa bunların kanıtladığı şey mutlak tutar değil, arsa endeksinin
 * ÖLÇEKLEMESİ ve defterin tutarlılığıdır.
 */
async function facilityType(code: string) {
  const [row] = await sql<{ base_cost: bigint; storage_capacity: bigint }[]>`
    SELECT base_cost, storage_capacity FROM facility_types WHERE code = ${code}`;
  return row!;
}

describe('tesis kurma', () => {
  it('tesisi kurar, maliyeti arsa endeksiyle ölçekler ve deftere CAPEX yazar', async () => {
    const { token, companyId } = await player();
    const res = await call('/facilities', {
      method: 'POST', token,
      body: { facilityTypeCode: 'GREENGROCER', cityCode: 'IST', name: 'Kadıköy Manav' },
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Kadıköy Manav');
    expect(res.body.city.code).toBe('IST');
    expect(res.body.isUnderConstruction).toBe(true);
    expect(res.body.ticksRemaining).toBe(1);   // Manav 1 tur
    const type = await facilityType('GREENGROCER');
    expect(res.body.storageCapacity).toBe(type.storage_capacity.toString());

    // taban maliyet × 1,50 (İstanbul arsa endeksi)
    const beklenen = (type.base_cost * 150n) / 100n;
    const [entry] = await sql<{ amount: bigint; account: string }[]>`
      SELECT amount, account FROM ledger_entries
      WHERE company_id = ${companyId}::uuid AND direction = 'DEBIT' AND account = 'CAPEX'`;
    expect(entry!.amount).toBe(beklenen);

    const [co] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${companyId}::uuid`;
    expect(co!.cash).toBe(money(30_000) - beklenen);

    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('ucuz şehirde aynı tesis daha ucuza kurulur', async () => {
    const { token, companyId } = await player('KON');
    await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'GREENGROCER', cityCode: 'KON' },
    });
    // taban maliyet × 0,70 (Konya arsa endeksi)
    const type = await facilityType('GREENGROCER');
    const [co] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${companyId}::uuid`;
    expect(co!.cash).toBe(money(30_000) - (type.base_cost * 70n) / 100n);
  });

  it('envanteri tesisle birlikte otomatik oluşturur', async () => {
    const { token } = await player();
    const res = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'KIOSK', cityCode: 'IST' },
    });
    const [inv] = await sql<{ capacity: bigint; used_capacity: bigint }[]>`
      SELECT capacity, used_capacity FROM inventories WHERE facility_id = ${res.body.id}::uuid`;
    const kiosk = await facilityType('KIOSK');
    expect(inv!.capacity).toBe(kiosk.storage_capacity);
    expect(inv!.used_capacity).toBe(qty(0));
  });

  it('seviye kilidini uygular', async () => {
    const { token } = await player();
    const res = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'STEEL_MILL', cityCode: 'IST' },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LEVEL_LOCKED');
    expect(res.body.details.required).toBe(15);
  });

  it('limanı olmayan şehirde Liman kurulamaz', async () => {
    const { token, companyId } = await player();
    await sql`UPDATE companies SET level = 10 WHERE id = ${companyId}::uuid`;
    await moveCash(companyId, money(1_000_000), 'in');

    const konya = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'PORT', cityCode: 'KON' },
    });
    expect(konya.status).toBe(400);
    expect(konya.body.message).toMatch(/liman/i);

    const izmir = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'PORT', cityCode: 'IZM' },
    });
    expect(izmir.status).toBe(201);
  });

  it('parası yetmeyen oyuncuyu reddeder ve hiçbir şey değiştirmez', async () => {
    const { token, companyId } = await player();
    await moveCash(companyId, money(29_900), 'out'); // 30.000 → 100 ₺

    const res = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'GREENGROCER', cityCode: 'IST' },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');

    // Şirket kuruluşta bir başlangıç tesisiyle gelir (madde 4); reddedilen
    // kurulum ona bir şey EKLEMEMELİ.
    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM facilities WHERE company_id = ${companyId}::uuid`;
    expect(count).toBe(1n);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('bilinmeyen tesis türünü 404 ile reddeder', async () => {
    const { token } = await player();
    const res = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'UZAY_USSU', cityCode: 'IST' },
    });
    expect(res.status).toBe(404);
  });
});

describe('stok görünümü', () => {
  async function withStock() {
    const { token } = await player();
    const facility = await call('/facilities', {
      method: 'POST', token, body: { facilityTypeCode: 'GREENGROCER', cityCode: 'IST' },
    });
    const [inv] = await sql<{ id: string }[]>`
      SELECT id FROM inventories WHERE facility_id = ${facility.body.id}::uuid`;
    // 100 kg %95 kalite 18 ₺  +  400 kg %52,5 kalite 10 ₺ (madde 10 örneği)
    await sql`INSERT INTO inventory_batches (inventory_id, product_id, quantity, quality, unit_cost, expires_at_tick)
              VALUES (${inv!.id}::uuid, 4, ${qty(100)}, 95, ${money(18)}, 500),
                     (${inv!.id}::uuid, 4, ${qty(400)}, 52.5, ${money(10)}, 600)`;
    return { token, facilityId: facility.body.id as string };
  }

  it('toplam, ortalama kalite ve ağırlıklı maliyeti türetir', async () => {
    const { token, facilityId } = await withStock();
    const res = await call(`/facilities/${facilityId}/stock`, { token });

    expect(res.status).toBe(200);
    const tomato = res.body.products[0];
    expect(tomato.name).toBe('Domates');
    expect(tomato.totalFormatted).toBe('500 kg');
    expect(tomato.avgQuality).toBe(61);                       // (95×100 + 52,5×400)/500
    expect(tomato.weightedAvgCostFormatted).toBe('11,60 ₺');  // (18×100 + 10×400)/500
    expect(tomato.batchCount).toBe(2);
    const kioskType = await facilityType('KIOSK');
    expect(res.body.freeCapacity).toBe(kioskType.storage_capacity.toString());
  });

  it('lotları FEFO sırasıyla ayrı ayrı verir', async () => {
    const { token, facilityId } = await withStock();
    const res = await call(`/facilities/${facilityId}/batches`, { token });

    expect(res.body).toHaveLength(2);
    expect(res.body[0].expiresAtTick).toBe('500');  // önce bozulacak önce
    expect(res.body[0].quality).toBe(95);
    expect(res.body[1].quality).toBe(52.5);
    expect(res.body[0].unitCostFormatted).toBe('18,00 ₺');
  });

  it('başka oyuncunun tesisine erişilemez', async () => {
    const { facilityId } = await withStock();
    const other = await player();
    const res = await call(`/facilities/${facilityId}/stock`, { token: other.token });
    expect(res.status).toBe(404);
  });

  it('birleşik envanter tüm tesisleri kapsar', async () => {
    const { token } = await withStock();
    await call('/facilities', { method: 'POST', token, body: { facilityTypeCode: 'KIOSK', cityCode: 'ANK' } });

    const res = await call('/inventory', { token });
    expect(res.status).toBe(200);
    // Başlangıç tesisi + testin kurduğu iki tesis (madde 4)
    expect(res.body.facilities).toHaveLength(3);
    // 500 kg × 11,60 ₺ = 5.800 ₺ maliyet değeri
    expect(res.body.totalCostValueFormatted).toBe('5.800,00 ₺');
  });
});

/**
 * ★ Yükseltme ÖNİZLEMESİ ile FİİLİ YÜKSELTME aynı karardan gelmeli.
 *
 * Maliyet `upgradeCost` (config'teki çarpan ve üs), yeni kapasite
 * `facility_level_curve` ile bulunur — ikisi de sunucuda. Önizleme bunları
 * ayrı bir yerde hesaplasaydı ekran "8.784,51 ₺" der, kasadan başka bir tutar
 * düşerdi; ya da ekran "yükselt" der, sunucu "en yüksek seviyede" diye
 * reddederdi. Bu testler iki tarafın tek yerden okuduğunu sabitler.
 */
describe('★ tesis yükseltme önizlemesi', () => {
  it('önizlemedeki maliyet kasadan DÜŞEN tutarla birebir aynıdır', async () => {
    const p = await player();
    await moveCash(p.companyId, 500_000n * 10_000n, 'in');

    const once = await call('/facilities', { token: p.token });
    const tesis = once.body[0];
    expect(tesis.upgrade.atMaxLevel).toBe(false);
    expect(tesis.upgrade.nextLevel).toBe(tesis.level + 1);

    const [kasaOnce] = await sql<{ cash: bigint }[]>`
      SELECT cash FROM companies WHERE id = ${p.companyId}::uuid`;

    const res = await call(`/facilities/${tesis.id}/upgrade`, { method: 'POST', token: p.token });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const [kasaSonra] = await sql<{ cash: bigint }[]>`
      SELECT cash FROM companies WHERE id = ${p.companyId}::uuid`;

    expect(kasaOnce!.cash - kasaSonra!.cash).toBe(BigInt(tesis.upgrade.cost));
  });

  it('önizlemedeki yeni depo kapasitesi yükseltmeden SONRAKİ ile aynıdır', async () => {
    const p = await player();
    await moveCash(p.companyId, 500_000n * 10_000n, 'in');

    const once = await call('/facilities', { token: p.token });
    const tesis = once.body[0];
    const beklenen = tesis.upgrade.nextStorageCapacity;

    await call(`/facilities/${tesis.id}/upgrade`, { method: 'POST', token: p.token });

    const sonra = await call('/facilities', { token: p.token });
    expect(sonra.body[0].storageCapacity).toBe(beklenen);
    expect(sonra.body[0].level).toBe(tesis.level + 1);
    // Sonraki adım da tazelenmeli: Lv3 Lv2'den pahalıdır.
    expect(BigInt(sonra.body[0].upgrade.cost)).toBeGreaterThan(BigInt(tesis.upgrade.cost));
  });

  /*
   * ★ PERAKENDE ÜRETMEZ. `facility_types.base_capacity` manav/büfe/market için
   * 0'dır; yükseltme orada YALNIZ depoyu büyütür. Ekran bu bayrağa bakıp
   * "üretim artar" satırını gizliyor — herkese göstermek yalan olurdu.
   */
  it('producesGoods perakendede false, üreten tesiste true', async () => {
    const p = await player();
    await moveCash(p.companyId, 500_000n * 10_000n, 'in');
    await sql`UPDATE companies SET level = 15 WHERE id = ${p.companyId}::uuid`;

    await call('/facilities', {
      method: 'POST', token: p.token,
      body: { facilityTypeCode: 'BAKERY', cityCode: 'IST' },
    });

    const liste = await call('/facilities', { token: p.token });
    const manav = liste.body.find((f: { type: { code: string } }) => f.type.code === 'GREENGROCER');
    const firin = liste.body.find((f: { type: { code: string } }) => f.type.code === 'BAKERY');

    expect(manav.upgrade.producesGoods).toBe(false);
    expect(firin.upgrade.producesGoods).toBe(true);
  });

  it('en yüksek seviyede önizleme boş gelir ve yükseltme REDDEDİLİR', async () => {
    const p = await player();
    await moveCash(p.companyId, 5_000_000n * 10_000n, 'in');
    const liste = await call('/facilities', { token: p.token });
    const tesis = liste.body[0];
    const tavan = tesis.upgrade.maxLevel as number;

    // Tesisi doğrudan tavana çek: yükseltmeyi 9 kez koşmak testi yavaşlatırdı.
    await sql`UPDATE facilities SET level = ${tavan} WHERE id = ${tesis.id}::uuid`;

    const sonra = await call('/facilities', { token: p.token });
    const u = sonra.body[0].upgrade;
    expect(u.atMaxLevel).toBe(true);
    expect(u.nextLevel).toBeNull();
    expect(u.cost).toBeNull();
    expect(u.nextStorageCapacity).toBeNull();

    // Ekran "yükselt" demiyorsa sunucu da kabul etmemeli — ikisi aynı karar.
    const res = await call(`/facilities/${tesis.id}/upgrade`, { method: 'POST', token: p.token });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });
});

/*
 * ★★★★ KURULAN TESİS ÜRETİYOR MU (R96).
 *
 * `active_recipe_id` NULL ile kuruluyordu ve üretim fazı tam da o alan
 * üzerinden JOIN yapıyor: reçetesiz tesis sorgunun DIŞINDA kalıyor, üretim
 * kaydı açılmıyor, `halted_reason` yazılmıyor. Yani tesis ÇALIŞIR GÖRÜNÜP
 * hiçbir şey üretmiyordu ve mobil uygulamada reçete atayan ekran da yoktu.
 *
 * Bu testler o boşluğun ikisini birden tutar: alan doldurulmuş MU, ve
 * dolduğu için gerçekten ÜRETİYOR MU.
 */
describe('★ üretim: kurulan tesis tarifiyle gelir', () => {
  it('üretim tesisi RUNNING durumunda ve ürünü belli olarak kurulur', async () => {
    const p = await player();
    await moveCash(p.companyId, money(200_000), 'in');

    const fac = await call('/facilities', {
      method: 'POST', token: p.token,
      body: { facilityTypeCode: 'VEG_GARDEN', cityCode: 'IST' },
    });
    expect(fac.status, JSON.stringify(fac.body)).toBe(201);
    expect(fac.body.productionState).toBe('RUNNING');
    expect(fac.body.producedProduct.code).toBe('TOMATO');
  });

  it('★ inşaat bitince GERÇEKTEN üretir — depo dolar', async () => {
    const p = await player();
    await moveCash(p.companyId, money(200_000), 'in');
    const fac = await call('/facilities', {
      method: 'POST', token: p.token,
      body: { facilityTypeCode: 'VEG_GARDEN', cityCode: 'IST' },
    });
    const id = fac.body.id as string;
    const insaat = fac.body.ticksRemaining as number;
    expect(insaat).toBeGreaterThan(0);

    // İnşaat sürerken üretim YOK: tesis henüz yok sayılır.
    await runTick(sql);
    const erken = await call(`/facilities/${id}/stock`, { token: p.token });
    expect(erken.body.products).toEqual([]);

    for (let i = 0; i < insaat; i++) await runTick(sql);

    const stok = await call(`/facilities/${id}/stock`, { token: p.token });
    expect(stok.body.products).toHaveLength(1);
    expect(stok.body.products[0].code).toBe('TOMATO');
    expect(BigInt(stok.body.products[0].total)).toBeGreaterThan(0n);

    const uretim = await call(`/facilities/${id}/production`, { token: p.token });
    expect(uretim.body.recipe.outputProduct.code).toBe('TOMATO');
    expect(uretim.body.recentTicks.length).toBeGreaterThan(0);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('perakende tesisi üretmez: durum NONE, ürün null', async () => {
    const p = await player();
    const liste = await call('/facilities', { token: p.token });
    const manav = liste.body.find((f: { type: { code: string } }) => f.type.code === 'GREENGROCER');
    expect(manav.productionState).toBe('NONE');
    expect(manav.producedProduct).toBeNull();
  });

  it('★ durdurulan tesis PAUSED olur ve üretimi durur', async () => {
    const p = await player();
    await moveCash(p.companyId, money(200_000), 'in');
    const fac = await call('/facilities', {
      method: 'POST', token: p.token,
      body: { facilityTypeCode: 'VEG_GARDEN', cityCode: 'IST' },
    });
    const id = fac.body.id as string;
    for (let i = 0; i <= (fac.body.ticksRemaining as number); i++) await runTick(sql);

    const durdur = await call(`/facilities/${id}/recipe`, {
      method: 'POST', token: p.token,
      body: { outputProductCode: 'TOMATO', enabled: false },
    });
    expect(durdur.body.productionState).toBe('PAUSED');
    // Ürün bilgisi KALIR: durdurmak tarifi silmez, yalnız duraklatır.
    expect(durdur.body.producedProduct.code).toBe('TOMATO');

    const once = await call(`/facilities/${id}/stock`, { token: p.token });
    await runTick(sql);
    const sonra = await call(`/facilities/${id}/stock`, { token: p.token });
    expect(sonra.body.products[0].total).toBe(once.body.products[0].total);
  });
});
