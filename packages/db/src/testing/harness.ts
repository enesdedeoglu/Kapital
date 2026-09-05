import { randomUUID } from 'node:crypto';
import { asMoney, type Money } from '@kapital/shared';
import { runMigrations } from '../cli/migrate.js';
import { createSql, type Sql } from '../client.js';
import { loadRootEnv } from '../env.js';
import { seed } from '../seed/index.js';

loadRootEnv();

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL tanımlı değil — testler üretim DB\'sine bağlanmaz');
  return url;
}

/** Test veritabanını hazırlar: migration + seed. Tekrar çalıştırılabilir. */
export async function prepareTestDb(): Promise<Sql> {
  const url = testDatabaseUrl();
  await runMigrations(url, { quiet: true });
  const sql = createSql({ url, max: 20, statementTimeoutMs: 30_000 });
  await seed(sql, { quiet: true });
  return sql;
}

/**
 * Testler arası OYUNCU verisini temizler.
 * Sistem ve NPC şirketleri dünya tohumudur — silinmez, yalnız bakiyeleri sıfırlanır.
 */
/** Testlerin yarattığı NPC'ler bu önekle adlandırılır; temizlik buna bakar. */
export const TEST_NPC_PREFIX = 'TEST-NPC ';

export async function truncateGameState(sql: Sql): Promise<void> {
  // ★ `npc_profiles` mutlaka temizlenir: P0'daki MVP-0 basit satıcıları
  // "gerçek NPC ajanı var mı" diye bu tabloya bakar. Bırakılırsa testler SIRA
  // BAĞIMLI olur — NPC testleri koştuktan sonra motor testleri sessizce
  // satıcısız bir dünyada koşar.
  //
  // Ekonomi Direktörü'nün tabloları da temizlenir: `market_health` histerezis
  // durumunu, `npc_directives` yürürlükteki müdahaleyi taşır. Bırakılırsa bir
  // testin bıraktığı EMERGENCY serisi diğerinde acil rezervi tetikleyebilir.
  //
  // TOHUM NPC ŞİRKETLERİ silinmez: basit satıcılar tohumdan gelir ve P0 onları
  // yeniden yaratmaz, yalnız isimle bulup emrini tazeler. Testlerin kendi
  // yarattıkları (`TEST_NPC_PREFIX`) ise silinir, yoksa her koşuda birikirler.
  await sql.unsafe(`
    TRUNCATE ledger_entries, outbox, tick_phase_runs, company_stats,
             inventory_batches, inventories, facilities,
             market_orders, market_trades, shipments, trade_flags,
             fx_trades, foreign_trades, retail_offers, retail_sales,
             production_jobs, production_records,
             npc_profiles, npc_decisions, npc_directives,
             market_health, world_events, world_notices RESTART IDENTITY CASCADE;
    DELETE FROM companies WHERE kind = 'PLAYER'
        OR (kind = 'NPC' AND name LIKE '${TEST_NPC_PREFIX}%');
    UPDATE companies SET cash = 0, usd_balance = 0, company_value = 0
     WHERE kind IN ('SYSTEM', 'NPC');
  `);
}

export interface TestCompany { id: string; name: string }

/** Oyuncu şirketi oluşturur ve başlangıç nakdini SYS_BANK'tan defter üzerinden verir. */
export async function makePlayer(sql: Sql, cash: Money, name = 'Test A.Ş.'): Promise<TestCompany> {
  const email = `t-${randomUUID()}@kapital.test`;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${email}, 'x', ${name}) RETURNING id`;
  const [company] = await sql<{ id: string }[]>`
    INSERT INTO companies (user_id, kind, name, home_city_id, cash)
    VALUES (${user!.id}, 'PLAYER', ${name}, 1, 0) RETURNING id`;
  await sql`INSERT INTO company_stats (company_id) VALUES (${company!.id})`;

  if (cash > 0n) {
    const { transfer } = await import('../finance/transfer.js');
    // SYS_TREASURY, SYS_BANK DEĞİL: başlangıç sermayesi kredi değildir ve
    // kredinin para arzı içindeki payı metriğini (R15) kirletmemelidir.
    const treasury = await systemCompanyId(sql, 'SYS_TREASURY');
    await sql.begin((tx) =>
      transfer(tx as unknown as Sql, {
        tickId: 0n, fromCompanyId: treasury, toCompanyId: company!.id,
        amount: cash, account: 'SEED', reason: 'test başlangıç sermayesi',
      }),
    );
  }
  return { id: company!.id, name };
}

export async function systemCompanyId(sql: Sql, code: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = ${code}`;
  if (!row) throw new Error(`sistem şirketi bulunamadı: ${code}`);
  return row.id;
}

export interface TestFacility { id: string; inventoryId: string }

/** Tesis (ve trigger ile envanteri) oluşturur. API katmanını atlar — birim testler için. */
export async function makeFacility(
  sql: Sql,
  companyId: string,
  opts: { typeCode?: string; cityId?: number; capacity?: bigint; completeAtTick?: bigint } = {},
): Promise<TestFacility> {
  const [type] = await sql<{ id: number; storage_capacity: bigint }[]>`
    SELECT id, storage_capacity FROM facility_types WHERE code = ${opts.typeCode ?? 'GREENGROCER'}`;
  const [facility] = await sql<{ id: string }[]>`
    INSERT INTO facilities (company_id, facility_type_id, city_id, storage_capacity,
                            construction_complete_at_tick)
    VALUES (${companyId}::uuid, ${type!.id}, ${opts.cityId ?? 1},
            ${opts.capacity ?? type!.storage_capacity}, ${opts.completeAtTick ?? 0n})
    RETURNING id`;
  const [inventory] = await sql<{ id: string }[]>`
    SELECT id FROM inventories WHERE facility_id = ${facility!.id}::uuid`;
  return { id: facility!.id, inventoryId: inventory!.id };
}

/** Doğrudan emir yazar — API katmanını atlar (motor birim testleri için). */
export async function placeOrder(sql: Sql, input: {
  companyId: string; facilityId: string; cityId: number; productId: number;
  side: 'BUY' | 'SELL'; quantity: bigint; price: bigint;
  quality?: number; minQuality?: number; maxDistance?: number; expiresAtTick?: bigint;
}): Promise<bigint> {
  const [row] = await sql<{ id: bigint }[]>`
    INSERT INTO market_orders (company_id, facility_id, product_id, city_id, side,
                               quantity, remaining_quantity, price_per_unit, quality,
                               min_quality, max_delivery_distance, expires_at_tick)
    VALUES (${input.companyId}::uuid, ${input.facilityId}::uuid, ${input.productId},
            ${input.cityId}, ${input.side}::order_side, ${input.quantity}, ${input.quantity},
            ${input.price}, ${(input.quality ?? 70).toFixed(3)},
            ${(input.minQuality ?? 0).toFixed(3)}, ${input.maxDistance ?? null},
            ${input.expiresAtTick ?? 9999n})
    RETURNING id`;
  return row!.id;
}

export async function cashOf(sql: Sql, companyId: string): Promise<Money> {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${companyId}`;
  return asMoney(row!.cash);
}

export interface TestNpc { companyId: string; facilityId: string; inventoryId: string }

/**
 * Profilli bir NPC şirketi ve tek tesisini kurar (F6 testleri için).
 *
 * Adı `TEST_NPC_PREFIX` ile başlar; `truncateGameState` bunu siler. Tohumdan
 * gelen MVP-0 basit satıcıları bu önekte olmadığı için korunur.
 */
export async function makeNpc(sql: Sql, opts: {
  typeCode: string; cityId: number; outputCode?: string; cash?: Money;
  archetype?: string; targetMargin?: number; inventoryTargetTicks?: number;
  cashReserveRatio?: number; strategyIntervalTicks?: number;
}): Promise<TestNpc> {
  const name = `${TEST_NPC_PREFIX}${opts.typeCode}-${opts.cityId}-${randomUUID().slice(0, 8)}`;
  const [company] = await sql<{ id: string }[]>`
    INSERT INTO companies (kind, name, home_city_id, cash, level, reputation)
    VALUES ('NPC', ${name}, ${opts.cityId}, 0, 20, 60) RETURNING id`;
  await sql`INSERT INTO company_stats (company_id) VALUES (${company!.id}::uuid)`;

  const cash = opts.cash ?? (5_000_000_000n as Money);
  if (cash > 0n) {
    const { transfer } = await import('../finance/transfer.js');
    const treasury = await systemCompanyId(sql, 'SYS_TREASURY');
    await sql.begin((tx) => transfer(tx as unknown as Sql, {
      tickId: 0n, fromCompanyId: treasury, toCompanyId: company!.id,
      amount: cash, account: 'SEED', reason: 'test NPC sermayesi',
    }));
  }

  await sql`
    INSERT INTO npc_profiles (company_id, archetype, risk_tolerance, target_margin,
                              quality_target, inventory_target_ticks, price_aggressiveness,
                              investment_aggressiveness, max_debt_ratio, cash_reserve_ratio,
                              strategy_interval_ticks)
    VALUES (${company!.id}::uuid, ${opts.archetype ?? 'VOLUME'}, 0.5,
            ${opts.targetMargin ?? 0.2}, 70, ${opts.inventoryTargetTicks ?? 12}, 0.5,
            0.5, 0.5, ${opts.cashReserveRatio ?? 0.15}, ${opts.strategyIntervalTicks ?? 24})`;

  const [type] = await sql<{ id: number; storage_capacity: bigint }[]>`
    SELECT id, storage_capacity FROM facility_types WHERE code = ${opts.typeCode}`;
  const [facility] = await sql<{ id: string }[]>`
    INSERT INTO facilities (company_id, facility_type_id, city_id, name, storage_capacity,
                            construction_complete_at_tick)
    VALUES (${company!.id}::uuid, ${type!.id}, ${opts.cityId}, ${name},
            ${type!.storage_capacity}, 0)
    RETURNING id`;
  if (opts.outputCode) {
    const [recipe] = await sql<{ id: number }[]>`
      SELECT r.id FROM production_recipes r
      JOIN facility_types ft ON ft.id = r.facility_type_id AND ft.code = ${opts.typeCode}
      JOIN products p ON p.id = r.output_product_id AND p.code = ${opts.outputCode}`;
    await sql`UPDATE facilities SET active_recipe_id = ${recipe!.id}
               WHERE id = ${facility!.id}::uuid`;
  }
  const [inventory] = await sql<{ id: string }[]>`
    SELECT id FROM inventories WHERE facility_id = ${facility!.id}::uuid`;
  return { companyId: company!.id, facilityId: facility!.id, inventoryId: inventory!.id };
}
