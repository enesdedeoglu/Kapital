import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBatch, runInTransaction, type Sql } from '@kapital/db';
import {
  makeFacility, makeNpc, makePlayer, prepareTestDb, truncateGameState,
} from '@kapital/db/testing';
import { money, qty } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;
const TOMATO = 4, WHEAT = 1, FURNITURE = 10;
// Domates ithal EDİLEMEZ (nihai tüketim), mobilya edilebilir — ikisi de talepli.
const KONYA = 4;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, retail_offers, retail_sales, city_demand,
             price_history, company_financials, facility_financials, economy_snapshots,
             production_jobs, production_records, market_health, npc_directives,
             world_events, world_notices, fx_rates RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

const healthOf = async (productId: number) => {
  const [row] = await sql<{ score: string; band: string; f_supply: number }[]>`
    SELECT score::text, band, f_supply FROM market_health
     WHERE product_id = ${productId} AND city_id = 0
     ORDER BY tick_id DESC LIMIT 1`;
  return row ? { score: Number(row.score), band: row.band, fSupply: row.f_supply } : null;
};

const directivesOf = (productId: number) => sql<{ lever: string; magnitude: number }[]>`
  SELECT lever, magnitude FROM npc_directives WHERE product_id = ${productId}
   ORDER BY id`;

const runTicks = async (n: number) => {
  for (let i = 0; i < n; i++) await runTick(sql);
};

describe('Ekonomi Direktörü — ölçüm (madde 29)', () => {
  it('her ürün için her tur sağlık skoru yazar', async () => {
    const tick = await runTick(sql);
    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM market_health WHERE tick_id = ${tick.seq}`;
    const [{ products }] = await sql<{ products: bigint }[]>`
      SELECT COUNT(*) AS products FROM products`;
    expect(count).toBe(products);
  });

  it('skorun bileşenleri ayrı ayrı kaydedilir — karar denetlenebilir olmalı', async () => {
    await runTick(sql);
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT f_supply, f_sellers, f_buyers, f_depth, f_stability, f_player_share,
             supply_units, demand_units
        FROM market_health WHERE product_id = ${TOMATO} AND city_id = 0 LIMIT 1`;
    expect(Object.values(row!).every((v) => v !== null)).toBe(true);
  });

  it('★ SOĞUK BAŞLANGIÇ: oyuncu yokken f_player_share cezalandırmaz (R11)', async () => {
    await runTick(sql);
    const [row] = await sql<{ f_player_share: number }[]>`
      SELECT f_player_share FROM market_health WHERE product_id = ${TOMATO} AND city_id = 0
       ORDER BY tick_id DESC LIMIT 1`;
    // ED'nin hiçbir kaldıracı oyuncu getiremez; müdahale edilemez eksiklik
    // için sürekli müdahale edilmesin diye bileşen nötrlenir.
    expect(row!.f_player_share).toBe(1);
  });
});

describe('müdahale bantları ve direktifler (madde 30)', () => {
  it('üretimi olmayan ve talebi olan ürün EMERGENCY bandına düşer', async () => {
    await runTicks(2);
    const health = await healthOf(TOMATO);
    expect(health!.fSupply).toBe(0);
    expect(health!.band).toBe('EMERGENCY');
  });

  it('★ EMERGENCY önce İTHALAT kapısını açar, rezervi değil (docs/07 §4.1)', async () => {
    await runTicks(2);
    // ★ Mobilya ithal EDİLEBİLİR: ilk kaldıraç ithalat kapısıdır.
    const importable = await directivesOf(FURNITURE);
    expect(importable[0]!.lever).toBe('IMPORT_QUOTA');
    expect(importable[0]!.magnitude).toBe(1);

    const reserveOrders = await sql`
      SELECT o.id FROM market_orders o JOIN companies c ON c.id = o.company_id
       WHERE c.system_code = 'SYS_RESERVE'`;
    expect(reserveOrders).toHaveLength(0); // rezerv henüz devrede değil
  });

  it('★ ithal edilemeyen üründe kapı açıldığı söylenmez, durum olduğu gibi duyurulur', async () => {
    await runTicks(2);
    const [event] = await sql<{ kind: string; severity: string; title: string }[]>`
      SELECT kind, severity, title FROM world_notices WHERE product_id = ${TOMATO}`;
    // Domates nihai tüketim ürünüdür: world_market.importable = false.
    expect(event!.kind).toBe('IMPORT_UNAVAILABLE');
    expect(event!.severity).toBe('WARNING');
  });

  it('ithal EDİLEBİLEN üründe ithalat kapısı duyurulur', async () => {
    await runTicks(2);
    const [event] = await sql<{ kind: string }[]>`
      SELECT kind FROM world_notices WHERE product_id = ${FURNITURE}`;
    expect(event?.kind).toBe('IMPORT_GATE_OPENED');
  });

  it('aynı olay her tur tekrar duyurulmaz — gün başına tek bildirim', async () => {
    await runTicks(6);
    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM world_notices
       WHERE product_id = ${TOMATO} AND kind = 'IMPORT_UNAVAILABLE'`;
    expect(count).toBe(1n);
  });

  it('direktifler her tur yeniden yazılmaz, süresi uzatılır', async () => {
    await runTicks(2);
    const [{ count: first }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM npc_directives WHERE product_id = ${TOMATO}`;
    await runTicks(4);
    const [{ count: later }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM npc_directives WHERE product_id = ${TOMATO}`;
    expect(later).toBe(first);
  });

  it('direktifin süresi vardır — kalıcı müdahale yoktur', async () => {
    const tick = await runTick(sql);
    const [row] = await sql<{ issued_tick: bigint; expires_tick: bigint }[]>`
      SELECT issued_tick, expires_tick FROM npc_directives LIMIT 1`;
    expect(row!.expires_tick).toBeGreaterThan(row!.issued_tick);
    expect(row!.expires_tick).toBeGreaterThan(tick.seq);
  });

  it('★ FAZLA ARZDA yön tersine döner — ED üretimi kısar, artırmaz', async () => {
    // Buğdayın perakende talebi yoktur; onu tüketen değirmen de yoksa üretim
    // saf fazla arzdır. ED bu durumda teşvik verirse sorunu kendisi büyütür.
    const farm = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: farm.inventoryId, productId: WHEAT,
      quantity: qty(500), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));
    await runTicks(3);

    const directives = await directivesOf(WHEAT);
    const production = directives.find((d) => d.lever === 'PRODUCTION_BIAS');
    expect(production).toBeDefined();
    expect(production!.magnitude).toBeLessThan(0);
    // Fazla arzda ithalat kapısı AÇILMAZ
    expect(directives.some((d) => d.lever === 'IMPORT_QUOTA')).toBe(false);
  });

  it('fazla arzda ithalat duyurusu da yapılmaz', async () => {
    const farm = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: farm.inventoryId, productId: WHEAT,
      quantity: qty(500), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));
    await runTicks(3);
    const events = await sql`SELECT id FROM world_notices WHERE product_id = ${WHEAT}`;
    expect(events).toHaveLength(0);
  });
});

describe('★ ÇIKIŞ KRİTERİ: acil rezerv son çaredir (madde 32)', () => {
  it('12 tur EMERGENCY ve sıfır üretimden sonra SYS_RESERVE satışa çıkar', async () => {
    await runTicks(13);

    const [order] = await sql<{ price_per_unit: bigint; quantity: bigint }[]>`
      SELECT o.price_per_unit, o.quantity FROM market_orders o
        JOIN companies c ON c.id = o.company_id
       WHERE c.system_code = 'SYS_RESERVE' AND o.product_id = ${TOMATO}`;
    expect(order).toBeDefined();

    // ★ Rezerv piyasanın ALTINA satmaz: referansın 1,75 katı.
    const [ph] = await sql<{ ema: bigint }[]>`
      SELECT ema_reference AS ema FROM price_history
       WHERE product_id = ${TOMATO} AND city_id = 0 ORDER BY tick_id DESC LIMIT 1`;
    expect(order!.price_per_unit).toBeGreaterThan(ph!.ema);
  });

  it('rezerv müdahalesi CRITICAL olarak duyurulur', async () => {
    await runTicks(13);
    const [event] = await sql<{ kind: string; severity: string }[]>`
      SELECT kind, severity FROM world_notices WHERE kind = 'RESERVE_INTERVENTION'`;
    expect(event!.severity).toBe('CRITICAL');
  });

  it('üretim varsa rezerv devreye GİRMEZ — sıra ithalattan sonradır', async () => {
    const farm = await makeNpc(sql, { typeCode: 'VEG_GARDEN', outputCode: 'TOMATO', cityId: KONYA });
    expect(farm.facilityId).toBeTruthy();
    await runTicks(13);

    const orders = await sql`
      SELECT o.id FROM market_orders o JOIN companies c ON c.id = o.company_id
       WHERE c.system_code = 'SYS_RESERVE' AND o.product_id = ${TOMATO}`;
    expect(orders).toHaveLength(0);
  });

  it('rezerv aynı üründe ikinci emir açmaz', async () => {
    await runTicks(16);
    const orders = await sql`
      SELECT o.id FROM market_orders o JOIN companies c ON c.id = o.company_id
       WHERE c.system_code = 'SYS_RESERVE' AND o.product_id = ${TOMATO}
         AND o.status IN ('OPEN', 'PARTIAL')`;
    expect(orders.length).toBeLessThanOrEqual(1);
  });
});

describe('NPC direktifleri tüketir', () => {
  it('INVENTORY_TARGET alış miktarını değiştirir', async () => {
    const mill = await makeNpc(sql, { typeCode: 'MILL', outputCode: 'FLOUR', cityId: KONYA });
    await runTick(sql);
    const [before] = await sql<{ quantity: bigint }[]>`
      SELECT quantity FROM market_orders
       WHERE facility_id = ${mill.facilityId}::uuid AND side = 'BUY'`;
    expect(before).toBeDefined();

    // Stok hedefini ED ile %40 artır
    await sql`
      INSERT INTO npc_directives (issued_tick, expires_tick, scope, product_id, lever,
                                  magnitude, reason)
      VALUES (1, 999, 'PRODUCT', ${WHEAT}, 'INVENTORY_TARGET', 1, 'test')`;
    await runTick(sql);
    const [after] = await sql<{ quantity: bigint }[]>`
      SELECT quantity FROM market_orders
       WHERE facility_id = ${mill.facilityId}::uuid AND side = 'BUY'`;
    expect(after!.quantity).toBeGreaterThan(before!.quantity);
  });

  it('PRODUCTION_BIAS kapasite kullanımını etkiler', async () => {
    const farm = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: farm.inventoryId, productId: WHEAT,
      quantity: qty(3000), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));
    await sql`
      INSERT INTO npc_directives (issued_tick, expires_tick, scope, product_id, lever,
                                  magnitude, reason)
      VALUES (0, 999, 'PRODUCT', ${WHEAT}, 'PRODUCTION_BIAS', -1, 'test kısma')`;
    await runTick(sql);

    const [row] = await sql<{ utilization: number }[]>`
      SELECT utilization FROM facilities WHERE id = ${farm.facilityId}::uuid`;
    expect(row!.utilization).toBeLessThan(1);
  });

  it('★ oyuncu üretime başlayınca ED NPC kapasitesine tavan koyar (madde 31)', async () => {
    // Oyuncu YOKKEN tavan konmaz: boşluğu dolduracak kimse olmadığı için
    // NPC'yi kısmak kıtlık üretir (docs/07 §8.1).
    await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runTicks(2);
    const [before] = await sql<{ magnitude: number }[]>`
      SELECT magnitude FROM npc_directives
       WHERE lever = 'CAPACITY_CAP' AND product_id = ${WHEAT}`;
    expect(before).toBeUndefined();

    // Oyuncu üretime girer: artık NPC kademeli geri çekilebilir.
    const player = await makePlayer(sql, money(300_000), 'Rakip Çiftlik');
    const facility = await makeFacility(sql, player.id, { typeCode: 'WHEAT_FIELD', cityId: KONYA });
    const [recipe] = await sql<{ id: number }[]>`
      SELECT r.id FROM production_recipes r
      JOIN facility_types ft ON ft.id = r.facility_type_id AND ft.code = 'WHEAT_FIELD'`;
    await sql`UPDATE facilities SET active_recipe_id = ${recipe!.id}
               WHERE id = ${facility.id}::uuid`;
    await runTicks(3);

    const [after] = await sql<{ magnitude: number }[]>`
      SELECT magnitude FROM npc_directives
       WHERE lever = 'CAPACITY_CAP' AND product_id = ${WHEAT}`;
    expect(after).toBeDefined();
    expect(after!.magnitude).toBeLessThan(1);
  });
});

describe('anlık görüntü', () => {
  it('Gini katsayısı yazılır ve 0..1 aralığındadır', async () => {
    await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await makeNpc(sql, { typeCode: 'VEG_GARDEN', outputCode: 'TOMATO', cityId: KONYA });
    const tick = await runTick(sql);
    const [row] = await sql<{ gini: number | null; game_cpi: number | null }[]>`
      SELECT gini, game_cpi FROM economy_snapshots WHERE tick_id = ${tick.seq}`;
    expect(row!.gini).not.toBeNull();
    expect(row!.gini!).toBeGreaterThanOrEqual(0);
    expect(row!.gini!).toBeLessThanOrEqual(1);
    expect(row!.game_cpi).not.toBeNull();
  });
});

describe('★ ED duruşu tutarlıdır: eski yön anında iptal edilir', () => {
  it('yön tersine dönünce karşıt direktifler süresi dolmayı beklemez', async () => {
    // Önce kıtlık: teşvik direktifleri yayınlanır.
    await runTicks(2);
    const before = await directivesOf(WHEAT);
    expect(before.some((d) => d.lever === 'IMPORT_QUOTA')).toBe(true);

    // Sonra bolluk: buğday üretimi başlar, talebi olmadığı için arz fazlaya döner.
    const farm = await makeNpc(sql, { typeCode: 'WHEAT_FIELD', outputCode: 'WHEAT', cityId: KONYA });
    await runInTransaction(sql, (tx) => addBatch(tx, {
      inventoryId: farm.inventoryId, productId: WHEAT,
      quantity: qty(2000), unitCost: money(5), quality: 70, producedAtTick: 0n,
    }));
    await runTicks(3);

    const active = await sql<{ lever: string; magnitude: number }[]>`
      SELECT lever, magnitude FROM npc_directives
       WHERE product_id = ${WHEAT}
         AND expires_tick > (SELECT MAX(seq) FROM economic_ticks)`;
    // ★ Teşvik kaldıraçları hâlâ yürürlükte olsaydı ED bir eliyle kısıp
    //   diğeriyle teşvik ediyor olurdu.
    expect(active.some((d) => d.lever === 'IMPORT_QUOTA')).toBe(false);
    expect(active.some((d) => d.lever === 'INVESTMENT_BIAS')).toBe(false);
    expect(active.every((d) => d.lever === 'CAPACITY_CAP' || d.magnitude < 0)).toBe(true);
  });
});
