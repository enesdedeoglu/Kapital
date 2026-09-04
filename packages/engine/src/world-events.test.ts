import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '@kapital/db';
import { makeFacility, makePlayer, prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { money } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;
const TOMATO = 4, KONYA = 4;

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

/** Elle olay yerleştirir — üretimin rastgeleliğini beklemeden etkiyi ölçmek için. */
const placeEvent = (opts: {
  code: string; scope: string; category?: string; productId?: number; cityId?: number;
  demand?: number; supply?: number; cost?: number; from?: bigint; to?: bigint;
}) => sql`
  INSERT INTO world_events (code, name, description, scope, category, product_id, city_id,
                            demand_multiplier, supply_multiplier, cost_multiplier,
                            start_tick, end_tick)
  VALUES (${opts.code}, ${opts.code}, '', ${opts.scope}, ${opts.category ?? null},
          ${opts.productId ?? null}, ${opts.cityId ?? null},
          ${opts.demand ?? 1}, ${opts.supply ?? 1}, ${opts.cost ?? 1},
          ${opts.from ?? 0n}, ${opts.to ?? 9999n})`;

async function garden() {
  const player = await makePlayer(sql, money(500_000), 'Bahçe A.Ş.');
  const facility = await makeFacility(sql, player.id, { typeCode: 'VEG_GARDEN', cityId: KONYA });
  const [recipe] = await sql<{ id: number }[]>`
    SELECT r.id FROM production_recipes r
    JOIN facility_types ft ON ft.id = r.facility_type_id AND ft.code = 'VEG_GARDEN'`;
  await sql`UPDATE facilities SET active_recipe_id = ${recipe!.id} WHERE id = ${facility.id}::uuid`;
  return { player, facility };
}

/**
 * Tesis her tur biraz YIPRANIR (`condition`), bu yüzden iki tur arasında üretim
 * birebir eşit olmaz. Olay etkisini ölçerken bu doğal sürüklenme tolere edilir;
 * aranan şey çarpanın kendisidir.
 */
const oranBeklenen = (actual: bigint, expected: bigint, ratio: number) =>
  expect(Number(actual) / Number(expected)).toBeCloseTo(ratio, 1);

const producedIn = async (tickSeq: bigint, facilityId: string) => {
  const [row] = await sql<{ produced: bigint; overhead: bigint }[]>`
    SELECT produced, overhead_cost AS overhead FROM production_records
     WHERE tick_id = ${tickSeq} AND facility_id = ${facilityId}::uuid`;
  return row!;
};

describe('dünya olaylarının üretime etkisi (madde 45)', () => {
  it('★ kuraklık tarımsal üretimi kısar', async () => {
    const a = await garden();
    const normal = await runTick(sql);
    const before = await producedIn(normal.seq, a.facility.id);

    await placeEvent({ code: 'DROUGHT', scope: 'SECTOR', category: 'AGRICULTURE', supply: 0.55 });
    const shocked = await runTick(sql);
    const after = await producedIn(shocked.seq, a.facility.id);

    expect(after.produced).toBeLessThan(before.produced);
    // Çarpan doğrudan uygulanır: yaklaşık %55
    expect(Number(after.produced) / Number(before.produced)).toBeCloseTo(0.55, 1);
  });

  it('★ enerji krizi üretimi DURDURMAZ, pahalılaştırır', async () => {
    const a = await garden();
    const normal = await runTick(sql);
    const before = await producedIn(normal.seq, a.facility.id);

    await placeEvent({ code: 'ENERGY_CRISIS', scope: 'GLOBAL', cost: 1.45 });
    const shocked = await runTick(sql);
    const after = await producedIn(shocked.seq, a.facility.id);

    oranBeklenen(after.produced, before.produced, 1);         // miktar aynı
    expect(after.overhead).toBeGreaterThan(before.overhead);  // gider arttı
    oranBeklenen(after.overhead, before.overhead, 1.45);
  });

  it('bereketli hasat üretimi artırır — dünya yalnız cezalandırmaz', async () => {
    const a = await garden();
    const normal = await runTick(sql);
    const before = await producedIn(normal.seq, a.facility.id);

    await placeEvent({ code: 'HARVEST_BOUNTY', scope: 'SECTOR', category: 'AGRICULTURE', supply: 1.4 });
    const shocked = await runTick(sql);
    expect((await producedIn(shocked.seq, a.facility.id)).produced)
      .toBeGreaterThan(before.produced);
  });

  it('sektör olayı başka sektöre bulaşmaz', async () => {
    const a = await garden();
    const normal = await runTick(sql);
    const before = await producedIn(normal.seq, a.facility.id);

    await placeEvent({ code: 'MINE_ACCIDENT', scope: 'SECTOR', category: 'MINING', supply: 0.5 });
    const shocked = await runTick(sql);
    oranBeklenen((await producedIn(shocked.seq, a.facility.id)).produced, before.produced, 1);
  });

  it('süresi dolmuş olayın etkisi kalkar', async () => {
    const a = await garden();
    const normal = await runTick(sql);
    const before = await producedIn(normal.seq, a.facility.id);

    // Yalnız 2. turda geçerli
    await placeEvent({
      code: 'DROUGHT', scope: 'SECTOR', category: 'AGRICULTURE', supply: 0.55,
      from: 2n, to: 3n,
    });
    const during = await runTick(sql);
    expect((await producedIn(during.seq, a.facility.id)).produced).toBeLessThan(before.produced);

    const after = await runTick(sql);
    oranBeklenen((await producedIn(after.seq, a.facility.id)).produced, before.produced, 1);
  });
});

describe('dünya olaylarının talebe etkisi', () => {
  it('★ bayram talebi artırır', async () => {
    await runTick(sql);
    const [before] = await sql<{ units: bigint }[]>`
      SELECT SUM(demand_units)::bigint AS units FROM city_demand
       WHERE tick_id = (SELECT MAX(tick_id) FROM city_demand)`;

    await placeEvent({ code: 'FESTIVAL', scope: 'GLOBAL', demand: 1.5 });
    await runTick(sql);
    const [after] = await sql<{ units: bigint }[]>`
      SELECT SUM(demand_units)::bigint AS units FROM city_demand
       WHERE tick_id = (SELECT MAX(tick_id) FROM city_demand)`;

    expect(after!.units).toBeGreaterThan(before!.units);
  });

  it('ürün olayı yalnız o ürünün talebini değiştirir', async () => {
    await runTick(sql);
    const domatesTalebi = async () => {
      const [row] = await sql<{ units: bigint }[]>`
        SELECT SUM(demand_units)::bigint AS units FROM city_demand
         WHERE product_id = ${TOMATO} AND tick_id = (SELECT MAX(tick_id) FROM city_demand)`;
      return row!.units;
    };
    const ekmekTalebi = async () => {
      const [row] = await sql<{ units: bigint }[]>`
        SELECT SUM(demand_units)::bigint AS units FROM city_demand
         WHERE product_id = 3 AND tick_id = (SELECT MAX(tick_id) FROM city_demand)`;
      return row!.units;
    };
    const domatesOnce = await domatesTalebi();
    const ekmekOnce = await ekmekTalebi();

    await placeEvent({ code: 'HEALTH_SCARE', scope: 'PRODUCT', productId: TOMATO, demand: 0.5 });
    await runTick(sql);

    expect(await domatesTalebi()).toBeLessThan(domatesOnce);
    // Ekmek talebi rastgele gürültü taşır; yarıya inmediğini kontrol etmek yeterli.
    expect(Number(await ekmekTalebi())).toBeGreaterThan(Number(ekmekOnce) * 0.8);
  });
});

describe('olay akışı ve duyuru', () => {
  it('biten olay duyurulur', async () => {
    await placeEvent({ code: 'FESTIVAL', scope: 'GLOBAL', demand: 1.5, from: 0n, to: 1n });
    const tick = await runTick(sql);

    const [notice] = await sql<{ kind: string; title: string }[]>`
      SELECT kind, title FROM world_notices WHERE tick_id = ${tick.seq}
         AND kind = 'WORLD_EVENT_ENDED'`;
    expect(notice!.kind).toBe('WORLD_EVENT_ENDED');
  });

  it('P0 sonucu aktif olay sayısını raporlar', async () => {
    await placeEvent({ code: 'FESTIVAL', scope: 'GLOBAL', demand: 1.5 });
    const tick = await runTick(sql);
    const open = tick.phases.OPEN!.result as { worldEvents: { active: number } };
    expect(open.worldEvents.active).toBeGreaterThanOrEqual(1);
  });

  it('aynı olay aynı turda iki kez başlamaz', async () => {
    await placeEvent({ code: 'FESTIVAL', scope: 'GLOBAL', demand: 1.5, from: 5n, to: 100n });
    await expect(
      placeEvent({ code: 'FESTIVAL', scope: 'GLOBAL', demand: 1.5, from: 5n, to: 100n }),
    ).rejects.toThrow();
  });
});
