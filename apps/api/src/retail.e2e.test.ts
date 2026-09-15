import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBatch, createSql, runInTransaction, type Sql } from '@kapital/db';
import { prepareTestDb, truncateGameState } from '@kapital/db/testing';
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

async function dukkan() {
  const reg = await call('/auth/register', {
    method: 'POST',
    body: { email: `r-${randomUUID()}@kapital.test`, password: 'parola12345', displayName: 'Manavcı' },
  });
  const token = reg.body.accessToken as string;
  await call('/company', {
    method: 'POST', token,
    body: { name: 'Raf A.Ş.', cityCode: 'IST', facilityTypeCode: 'GREENGROCER' },
  });
  const liste = await call('/facilities', { token });
  return { token, facilityId: liste.body[0].id as string };
}

const stokla = async (facilityId: string, productId: number, amount: bigint) => {
  const [inv] = await sql<{ id: string }[]>`
    SELECT id FROM inventories WHERE facility_id = ${facilityId}::uuid`;
  await runInTransaction(sql, (tx) => addBatch(tx, {
    inventoryId: inv!.id, productId, quantity: amount, quality: 80,
    unitCost: money(18), producedInTick: 0n, expiresAtTick: null,
  }));
};

const TOMATO = 4;

/*
 * ★★★★ RAFA ÜRÜN KOYMANIN YOLU (R96).
 *
 * Rafa ürün koyan tek uç `PUT /retail/:id/prices` ve upsert yaptığı için YENİ
 * ürün de ekleyebiliyor. Ama `GET /retail/:id` yalnız MEVCUT teklifleri
 * döndürüyordu ve arayüz de yalnız onları düzenleyebiliyordu: raf boşsa
 * düzenlenecek bir şey yok, eklenecek yol da yok.
 *
 * Ölçüldü (kapital_dev kopyası, gerçek bir oyuncu gibi): piyasadan 100 kg
 * domates alındı, mal manava vardı, `GET /retail/:id` yine `[]` döndü. Panelin
 * boş hâli "piyasadan perakende ürün alınca burada fiyat belirleyebilirsin"
 * diyordu — tam da yapılmış olan şeyi. Döngü kapanmıyordu: ciro sıfır.
 */
describe('★ raf: eklenebilir ürünler', () => {
  it('depodaki perakende ürünü EKLENEBİLİR olarak listelenir', async () => {
    const d = await dukkan();
    await stokla(d.facilityId, TOMATO, qty(100));

    const raf = await call(`/retail/${d.facilityId}`, { token: d.token });
    expect(raf.status).toBe(200);
    expect(raf.body.offers).toEqual([]);

    const domates = raf.body.addable.find(
      (a: { productCode: string }) => a.productCode === 'TOMATO');
    expect(domates).toBeDefined();
    expect(domates.availableStock).toBe(qty(100).toString());
    expect(domates.availableStockFormatted).toBe('100 kg');
    // Fiyatın anlamını veren iki sayı burada da var: piyasa ve tavan.
    expect(BigInt(domates.referencePrice)).toBeGreaterThan(0n);
    expect(BigInt(domates.reservationCeiling))
      .toBeGreaterThan(BigInt(domates.referencePrice));
  });

  it('★ önerilen fiyat referans × perakende marjı', async () => {
    const d = await dukkan();
    const raf = await call(`/retail/${d.facilityId}`, { token: d.token });
    const domates = raf.body.addable.find(
      (a: { productCode: string }) => a.productCode === 'TOMATO');

    const [cfg] = await sql<{ value: { retailMarkup: number } }[]>`
      SELECT value FROM game_configs WHERE key = 'economy.retail'`;
    const beklenen = (BigInt(domates.referencePrice)
      * BigInt(Math.round(cfg!.value.retailMarkup * 1000))) / 1000n;

    // Çarpım doğru: kuruşa yuvarlamadan önceki değere en fazla yarım kuruş uzak.
    const fark = BigInt(domates.suggestedPrice) - beklenen;
    expect(fark >= -50n && fark <= 50n).toBe(true);
    expect(BigInt(domates.suggestedPrice))
      .toBeLessThan(BigInt(domates.reservationCeiling));

    /*
     * ★ ÖNERİ GİRİLEBİLİR BİR FİYAT OLMALI — TAM KURUŞ.
     *
     * `formatMoney` kuruş altını KESER, panelin alana yazdığı ondalık ise
     * yuvarlar: kuruş altı artık kalırsa aynı ekranda iki farklı sayı çıkar
     * (337469 → gösterim "33,74 ₺", alan "33,75"). Oyuncu öneriyi olduğu gibi
     * kaydettiğinde gördüğünden başka bir fiyat oluşurdu.
     */
    expect(BigInt(domates.suggestedPrice) % 100n).toBe(0n);

    // Gösterilen ile KAYDEDİLEN aynı sayı mı: öneriyi olduğu gibi kaydet.
    const alanDegeri = Number(domates.suggestedPrice) / 10_000;
    const kaydet = await call(`/retail/${d.facilityId}/prices`, {
      method: 'PUT', token: d.token,
      body: { prices: [{ productCode: 'TOMATO', sellingPrice: alanDegeri, enabled: true }] },
    });
    expect(kaydet.body.offers[0].sellingPriceFormatted)
      .toBe(domates.suggestedPriceFormatted);
  });

  it('stoklu ürün listenin BAŞINDA gelir — elindeki mal aranmaz', async () => {
    const d = await dukkan();
    // FURNITURE (id 10) ilk sırada olurdu; stok onu geçmeli.
    await stokla(d.facilityId, TOMATO, qty(50));
    const raf = await call(`/retail/${d.facilityId}`, { token: d.token });
    expect(raf.body.addable[0].productCode).toBe('TOMATO');
  });

  it('★ eklenen ürün rafa geçer ve eklenebilir listesinden ÇIKAR', async () => {
    const d = await dukkan();
    await stokla(d.facilityId, TOMATO, qty(100));

    const kaydet = await call(`/retail/${d.facilityId}/prices`, {
      method: 'PUT', token: d.token,
      body: { prices: [{ productCode: 'TOMATO', sellingPrice: 24, enabled: true }] },
    });
    expect(kaydet.status).toBe(200);
    expect(kaydet.body.offers).toHaveLength(1);
    expect(kaydet.body.offers[0].productCode).toBe('TOMATO');
    expect(kaydet.body.offers[0].sellingPriceFormatted).toBe('24,00 ₺');
    // Aynı yanıtta eklenebilir liste de tazelenir: panel ikinci istek atmasın.
    expect(kaydet.body.addable.some(
      (a: { productCode: string }) => a.productCode === 'TOMATO')).toBe(false);

    const raf = await call(`/retail/${d.facilityId}`, { token: d.token });
    expect(raf.body.offers).toHaveLength(1);
    expect(raf.body.addable.some(
      (a: { productCode: string }) => a.productCode === 'TOMATO')).toBe(false);
  });

  it('perakende OLMAYAN ürün eklenebilir listesinde yok ve reddedilir', async () => {
    const d = await dukkan();
    const raf = await call(`/retail/${d.facilityId}`, { token: d.token });
    expect(raf.body.addable.some(
      (a: { productCode: string }) => a.productCode === 'WHEAT')).toBe(false);

    const red = await call(`/retail/${d.facilityId}/prices`, {
      method: 'PUT', token: d.token,
      body: { prices: [{ productCode: 'WHEAT', sellingPrice: 10, enabled: true }] },
    });
    expect(red.status).toBeGreaterThanOrEqual(400);
  });

  it('başka oyuncunun rafına erişilemez', async () => {
    const a = await dukkan();
    const b = await dukkan();
    const res = await call(`/retail/${a.facilityId}`, { token: b.token });
    expect(res.status).toBe(404);
  });
});
