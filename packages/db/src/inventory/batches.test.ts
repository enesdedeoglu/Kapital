import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../client.js';
import {
  makeFacility, makePlayer, prepareTestDb, truncateGameState, type TestFacility,
} from '../testing/harness.js';
import { runInTransaction } from '../finance/transfer.js';
import {
  addBatch, commitPicks, consumeFefo, releasePicks, reserveFefo, summarizeInventory,
} from './batches.js';
import { asQty, DomainError, money, qty } from '@kapital/shared';

let sql: Sql;
let facility: TestFacility;

const TOMATO = 4;
const WHEAT = 1;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });

beforeEach(async () => {
  await truncateGameState(sql);
  const player = await makePlayer(sql, money(30_000));
  facility = await makeFacility(sql, player.id);
});

const add = (o: Partial<Parameters<typeof addBatch>[1]> & { quantity: bigint; quality: number; unitCost: bigint }) =>
  runInTransaction(sql, (tx) => addBatch(tx, {
    inventoryId: facility.inventoryId, productId: TOMATO,
    expiresAtTick: null, ...o,
  } as Parameters<typeof addBatch>[1]));

describe('parti ekleme', () => {
  it('lot ekler ve kullanılan kapasiteyi trigger ile senkron tutar', async () => {
    await add({ quantity: qty(200), quality: 95, unitCost: money(18) });
    await add({ quantity: qty(400), quality: 52, unitCost: money(10) });

    const [inv] = await sql<{ used: bigint; cap: bigint }[]>`
      SELECT used_capacity AS used, capacity AS cap FROM inventories WHERE id = ${facility.inventoryId}::uuid`;
    expect(inv!.used).toBe(qty(600));
    // Kapasite tohumdan gelir; sabit yazılırsa tesis dengesi her
    // değiştiğinde (F8'de Manav deposu 2.000 → 3.000) bu test kırılır.
    const [type] = await sql<{ storage_capacity: bigint }[]>`
      SELECT storage_capacity FROM facility_types WHERE code = 'GREENGROCER'`;
    expect(inv!.cap).toBe(type!.storage_capacity);
  });

  it('depo kapasitesi aşılırsa STORAGE_FULL verir (değişmez I4)', async () => {
    const [inv0] = await sql<{ cap: bigint }[]>`
      SELECT capacity AS cap FROM inventories WHERE id = ${facility.inventoryId}::uuid`;
    const nearlyFull = inv0!.cap - qty(100);
    await add({ quantity: nearlyFull, quality: 90, unitCost: money(15) });
    await expect(add({ quantity: qty(200), quality: 90, unitCost: money(15) }))
      .rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === 'STORAGE_FULL');

    const [inv] = await sql<{ used: bigint }[]>`
      SELECT used_capacity AS used FROM inventories WHERE id = ${facility.inventoryId}::uuid`;
    expect(inv!.used).toBe(nearlyFull); // reddedilen parti sayılmadı
  });
});

describe('FEFO sırası', () => {
  it('önce bozulacak lot önce çıkar, eşitlikte FIFO', async () => {
    await add({ quantity: qty(100), quality: 90, unitCost: money(20), expiresAtTick: 500n });
    await add({ quantity: qty(100), quality: 60, unitCost: money(10), expiresAtTick: 200n }); // en erken
    await add({ quantity: qty(100), quality: 80, unitCost: money(15), expiresAtTick: null }); // bozulmaz

    const alloc = await runInTransaction(sql, (tx) =>
      reserveFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(150) }));

    expect(alloc.allocated).toBe(qty(150));
    expect(alloc.picks).toHaveLength(2);
    expect(alloc.picks[0]!.quality).toBe(60);  // 200. turda bozulacak olan
    expect(alloc.picks[0]!.take).toBe(qty(100));
    expect(alloc.picks[1]!.quality).toBe(90);  // sonra 500
    expect(alloc.picks[1]!.take).toBe(qty(50));
  });

  it('ağırlıklı ortalama kalite ve maliyeti doğru hesaplar', async () => {
    await add({ quantity: qty(100), quality: 90, unitCost: money(20), expiresAtTick: 100n });
    await add({ quantity: qty(300), quality: 50, unitCost: money(10), expiresAtTick: 200n });

    const alloc = await runInTransaction(sql, (tx) =>
      consumeFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(400) }));

    // (90×100 + 50×300) / 400 = 60
    expect(alloc.weightedQuality).toBeCloseTo(60, 6);
    // (20×100 + 10×300) / 400 = 12,50 ₺
    expect(alloc.weightedUnitCost).toBe(money(12.5));
    expect(alloc.complete).toBe(true);
  });

  it('minimum kalite altındaki lotları atlar (reçete girdisi)', async () => {
    await add({ quantity: qty(100), quality: 30, unitCost: money(8), expiresAtTick: 100n });
    await add({ quantity: qty(100), quality: 80, unitCost: money(20), expiresAtTick: 200n });

    const alloc = await runInTransaction(sql, (tx) =>
      reserveFefo(tx, {
        inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(150), minQuality: 50,
      }));

    expect(alloc.allocated).toBe(qty(100)); // yalnız kaliteli lot
    expect(alloc.picks).toHaveLength(1);
    expect(alloc.picks[0]!.quality).toBe(80);
  });

  it('stok yetmezse kısmi ayırır ve complete=false döner', async () => {
    await add({ quantity: qty(50), quality: 70, unitCost: money(12) });
    const alloc = await runInTransaction(sql, (tx) =>
      consumeFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(500) }));
    expect(alloc.allocated).toBe(qty(50));
    expect(alloc.complete).toBe(false);
  });

  it('başka ürünün lotlarına dokunmaz', async () => {
    await add({ quantity: qty(100), quality: 70, unitCost: money(12) });
    await add({ quantity: qty(100), quality: 70, unitCost: money(9), productId: WHEAT } as never);
    const alloc = await runInTransaction(sql, (tx) =>
      consumeFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(500) }));
    expect(alloc.allocated).toBe(qty(100));
  });
});

describe('rezervasyon yaşam döngüsü', () => {
  it('kesinleştirme: tükenen lot silinir, kısmi lot güncellenir', async () => {
    await add({ quantity: qty(100), quality: 90, unitCost: money(20), expiresAtTick: 100n });
    await add({ quantity: qty(100), quality: 80, unitCost: money(15), expiresAtTick: 200n });

    await runInTransaction(sql, async (tx) => {
      const alloc = await reserveFefo(tx, {
        inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(140),
      });
      await commitPicks(tx, alloc.picks);
    });

    const rows = await sql<{ quantity: bigint; reserved_quantity: bigint }[]>`
      SELECT quantity, reserved_quantity FROM inventory_batches
      WHERE inventory_id = ${facility.inventoryId}::uuid`;
    expect(rows).toHaveLength(1);              // ilk lot tamamen tükendi → silindi
    expect(rows[0]!.quantity).toBe(qty(60));   // 100 − 40
    expect(rows[0]!.reserved_quantity).toBe(qty(0));

    const [inv] = await sql<{ used: bigint }[]>`
      SELECT used_capacity AS used FROM inventories WHERE id = ${facility.inventoryId}::uuid`;
    expect(inv!.used).toBe(qty(60));           // trigger senkron kaldı
  });

  it('bırakma: miktar dokunulmaz, yalnız rezerv çözülür (sevkiyat iptali)', async () => {
    await add({ quantity: qty(100), quality: 90, unitCost: money(20) });

    const alloc = await runInTransaction(sql, (tx) =>
      reserveFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(60) }));

    let [row] = await sql<{ quantity: bigint; reserved_quantity: bigint }[]>`
      SELECT quantity, reserved_quantity FROM inventory_batches LIMIT 1`;
    expect(row!.reserved_quantity).toBe(qty(60));

    await runInTransaction(sql, (tx) => releasePicks(tx, alloc.picks));
    [row] = await sql<{ quantity: bigint; reserved_quantity: bigint }[]>`
      SELECT quantity, reserved_quantity FROM inventory_batches LIMIT 1`;
    expect(row!.quantity).toBe(qty(100));
    expect(row!.reserved_quantity).toBe(qty(0));
  });

  it('rezerve edilmiş miktar ikinci kez ayrılamaz', async () => {
    await add({ quantity: qty(100), quality: 90, unitCost: money(20) });

    await runInTransaction(sql, (tx) =>
      reserveFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(80) }));
    const second = await runInTransaction(sql, (tx) =>
      reserveFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(80) }));

    expect(second.allocated).toBe(qty(20)); // yalnız rezerve edilmemiş kısım
  });
});

describe('T2 — aynı stok iki kez satılamaz', () => {
  it('tek lota 30 eşzamanlı talep geldiğinde toplam ayrılan lot miktarını aşmaz', async () => {
    await add({ quantity: qty(100), quality: 90, unitCost: money(20) });

    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        runInTransaction(sql, (tx) =>
          reserveFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(10) }),
        ).catch(() => null),
      ),
    );

    const total = results.reduce((sum, r) => sum + (r?.allocated ?? 0n), 0n);
    expect(total).toBeLessThanOrEqual(qty(100));

    const [row] = await sql<{ quantity: bigint; reserved_quantity: bigint }[]>`
      SELECT quantity, reserved_quantity FROM inventory_batches LIMIT 1`;
    expect(row!.reserved_quantity).toBe(asQty(total));
    expect(row!.reserved_quantity <= row!.quantity).toBe(true); // I3
  });

  it('eşzamanlı tüketimde stok negatife düşmez', async () => {
    await add({ quantity: qty(100), quality: 90, unitCost: money(20) });

    await Promise.all(
      Array.from({ length: 25 }, () =>
        runInTransaction(sql, (tx) =>
          consumeFefo(tx, { inventoryId: facility.inventoryId, productId: TOMATO, quantity: qty(10) }),
        ).catch(() => null),
      ),
    );

    const rows = await sql<{ quantity: bigint }[]>`
      SELECT quantity FROM inventory_batches WHERE inventory_id = ${facility.inventoryId}::uuid`;
    for (const row of rows) expect(row.quantity > 0n).toBe(true);

    const [inv] = await sql<{ used: bigint }[]>`
      SELECT used_capacity AS used FROM inventories WHERE id = ${facility.inventoryId}::uuid`;
    expect(inv!.used >= 0n).toBe(true);
  });
});

describe('özet', () => {
  it('toplam, ortalama kalite ve ağırlıklı maliyeti türetir', async () => {
    await add({ quantity: qty(100), quality: 95, unitCost: money(18), expiresAtTick: 500n });
    await add({ quantity: qty(400), quality: 52.5, unitCost: money(10), expiresAtTick: 600n });

    const summary = await summarizeInventory(sql, facility.inventoryId);
    expect(summary).toHaveLength(1);
    const tomato = summary[0]!;
    expect(tomato.productName).toBe('Domates');
    expect(tomato.total).toBe(qty(500));
    expect(tomato.available).toBe(qty(500));
    expect(tomato.batchCount).toBe(2);
    // (95×100 + 52,5×400) / 500 = 61
    expect(tomato.avgQuality).toBeCloseTo(61, 3);
    // (18×100 + 10×400) / 500 = 11,60 ₺
    expect(tomato.weightedAvgCost).toBe(money(11.6));
  });
});
