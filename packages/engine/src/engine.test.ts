import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addBatch, checkInvariants, runInTransaction, type Sql,
} from '@kapital/db';
import { makeFacility, makePlayer, prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { money, qty } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });

beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, retail_offers, retail_sales, city_demand,
             price_history, company_financials, facility_financials, economy_snapshots
             RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

/** Satışa hazır bir manav kurar: stok + raf fiyatı. */
async function shopWithStock(price: number, stockKg: number, quality = 80) {
  const player = await makePlayer(sql, money(50_000), 'Manav A.Ş.');
  const facility = await makeFacility(sql, player.id, { typeCode: 'GREENGROCER', cityId: 1 });
  await runInTransaction(sql, (tx) =>
    addBatch(tx, {
      inventoryId: facility.inventoryId, productId: 4, quantity: qty(stockKg),
      quality, unitCost: money(12), producedInTick: 0n, expiresAtTick: 5000n,
    }));
  await sql`INSERT INTO retail_offers (facility_id, product_id, selling_price)
            VALUES (${facility.id}::uuid, 4, ${money(price)})`;
  return { player, facility };
}

const cashOf = async (id: string) => {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${id}::uuid`;
  return row!.cash;
};

describe('tur döngüsü', () => {
  it('20 tur boyunca değişmezler bozulmaz', async () => {
    await shopWithStock(20, 2000);
    for (let i = 0; i < 20; i++) {
      const tick = await runTick(sql);
      expect(tick.skipped).toBe(false);
    }
    const report = await checkInvariants(sql);
    expect(report.violations).toEqual([]);

    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM economic_ticks WHERE status = 'COMPLETED' AND seq > 0`;
    expect(count).toBe(20n);
  });

  it('para arzı yalnız perakende musluğundan artar', async () => {
    const { player } = await shopWithStock(20, 2000);
    await runTick(sql);
    const before = await moneySupply();
    const tick = await runTick(sql);
    const after = await moneySupply();

    const retail = tick.phases.RETAIL!.result as { revenue: bigint };
    const upkeep = tick.phases.UPKEEP!.result as { maintenanceCharged: bigint };
    // Δ para arzı = perakende geliri − sistem giderleri
    expect(after - before).toBe(retail.revenue - upkeep.maintenanceCharged);
    expect(await cashOf(player.id)).toBeGreaterThan(0n);
  });

  it('bakım gideri her tur tahsil edilir', async () => {
    const player = await makePlayer(sql, money(50_000));
    await makeFacility(sql, player.id, { typeCode: 'GREENGROCER' });
    // Bakım tutarı tohumda kurulum maliyetinden türetilir; sabit yazılmaz.
    const [type] = await sql<{ maintenance_cost: bigint }[]>`
      SELECT maintenance_cost FROM facility_types WHERE code = 'GREENGROCER'`;
    await runTick(sql);
    const before = await cashOf(player.id);
    await runTick(sql);
    expect(await cashOf(player.id)).toBe(before - type!.maintenance_cost);
  });

  it('nakit yetmezse tesis kapatılmaz, yıpranır (madde 40)', async () => {
    const player = await makePlayer(sql, money(0));
    const facility = await makeFacility(sql, player.id, { typeCode: 'GREENGROCER' });
    await runTick(sql);
    const tick = await runTick(sql);
    const upkeep = tick.phases.UPKEEP!.result as { facilitiesHalted: number };
    expect(upkeep.facilitiesHalted).toBeGreaterThan(0);

    const [row] = await sql<{ condition: string; halted_reason: string; closed_at: Date | null }[]>`
      SELECT condition, halted_reason, closed_at FROM facilities WHERE id = ${facility.id}::uuid`;
    expect(Number(row!.condition)).toBeLessThan(100);
    expect(row!.halted_reason).toMatch(/bakım/);
    expect(row!.closed_at).toBeNull(); // tesis KAPATILMADI
  });
});

describe('stok bozulması', () => {
  it('kalite her tur düşer ve raf ömrü dolan lot silinir', async () => {
    const player = await makePlayer(sql, money(50_000));
    const facility = await makeFacility(sql, player.id);
    await runInTransaction(sql, (tx) =>
      addBatch(tx, {
        inventoryId: facility.inventoryId, productId: 4, quantity: qty(100),
        quality: 100, unitCost: money(12), producedInTick: 0n, expiresAtTick: 3n,
      }));

    await runTick(sql); // tur 1
    const [afterOne] = await sql<{ quality: string }[]>`
      SELECT quality FROM inventory_batches WHERE inventory_id = ${facility.inventoryId}::uuid`;
    expect(Number(afterOne!.quality)).toBeLessThan(100); // domates %0,4/tur bozulur

    await runTick(sql); // tur 2
    await runTick(sql); // tur 3 → raf ömrü doldu
    const remaining = await sql`
      SELECT id FROM inventory_batches WHERE inventory_id = ${facility.inventoryId}::uuid`;
    expect(remaining).toHaveLength(0);
  });

  it('bozulmayan ürünün kalitesi sabit kalır', async () => {
    const player = await makePlayer(sql, money(50_000));
    const facility = await makeFacility(sql, player.id, { typeCode: 'MARKET' });
    await runInTransaction(sql, (tx) =>
      addBatch(tx, {
        inventoryId: facility.inventoryId, productId: 9, quantity: qty(100), // Çelik
        quality: 88, unitCost: money(70), producedInTick: 0n, expiresAtTick: null,
      }));
    for (let i = 0; i < 3; i++) await runTick(sql);
    const [row] = await sql<{ quality: string }[]>`
      SELECT quality FROM inventory_batches WHERE inventory_id = ${facility.inventoryId}::uuid`;
    expect(Number(row!.quality)).toBe(88);
  });
});

describe('NPC arzı', () => {
  it('her tur tazelenir ve tek emir satırı tutulur', async () => {
    await runTick(sql);
    const first = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM market_orders WHERE side = 'SELL'`;
    expect(first[0]!.count).toBe(5n);

    // Emri tüket, sonra tur koş: miktar tazelenmeli, yeni satır açılmamalı
    await sql`UPDATE market_orders SET remaining_quantity = 0, status = 'FILLED'`;
    await runTick(sql);
    const second = await sql<{ count: bigint; total: bigint }[]>`
      SELECT COUNT(*) AS count, SUM(remaining_quantity)::bigint AS total
      FROM market_orders WHERE side = 'SELL' AND status = 'OPEN'`;
    expect(second[0]!.count).toBe(5n);
    expect(second[0]!.total).toBeGreaterThan(0n);
  });
});

describe('lider kilidi', () => {
  it('eşzamanlı iki tur çağrısından yalnız biri koşar', async () => {
    const [a, b] = await Promise.all([runTick(sql), runTick(sql)]);
    const ran = [a, b].filter((r) => !r.skipped);
    const skipped = [a, b].filter((r) => r.skipped);
    expect(ran).toHaveLength(1);
    expect(skipped).toHaveLength(1);
  });

  it('kilit tur bittikten sonra bırakılır — sonraki tur koşabilir', async () => {
    await runTick(sql);
    const next = await runTick(sql);
    expect(next.skipped).toBe(false);
  });
});

async function moneySupply(): Promise<bigint> {
  const [row] = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(cash), 0)::text AS total FROM companies WHERE kind <> 'SYSTEM'`;
  return BigInt(row!.total);
}
