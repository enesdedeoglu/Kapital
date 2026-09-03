import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBatch, runInTransaction, type Sql } from '@kapital/db';
import {
  makeFacility, makePlayer, placeOrder, prepareTestDb, truncateGameState,
} from '@kapital/db/testing';
import { money, qty } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;
const IRON = 7;
const IST = 1;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE market_orders, market_trades, shipments, trade_flags, fx_rates, fx_trades,
             retail_offers, retail_sales, city_demand, price_history, company_financials,
             facility_financials, economy_snapshots, production_jobs, production_records
             RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

async function trader(name: string, cash = money(5_000_000)) {
  const player = await makePlayer(sql, cash, name);
  const facility = await makeFacility(sql, player.id, { typeCode: 'MARKET', cityId: IST });
  return { ...player, facility };
}

async function stockUp(inventoryId: string, amount: bigint, cost = money(28)) {
  await runInTransaction(sql, (tx) => addBatch(tx, {
    inventoryId, productId: IRON, quantity: amount, quality: 80,
    unitCost: cost, producedInTick: 0n, expiresAtTick: null,
  }));
}

/** Bir işlem çifti oluşturur ve turu koşar. */
async function trade(seller: Awaited<ReturnType<typeof trader>>, buyer: Awaited<ReturnType<typeof trader>>, amount: bigint, price: bigint) {
  await stockUp(seller.facility.inventoryId, amount);
  await placeOrder(sql, { companyId: seller.id, facilityId: seller.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: amount, price });
  await placeOrder(sql, { companyId: buyer.id, facilityId: buyer.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: amount, price });
}

describe('referans fiyat oluşumu', () => {
  it('gerçekleşen işlemlerden medyan hesaplar ve EMA ile yumuşatır', async () => {
    const s = await trader('S');
    const b = await trader('B');
    await trade(s, b, qty(100), money(40)); // referans 28 ₺'nin üstünde
    const tick = await runTick(sql);

    const [ph] = await sql<{ weighted_median: bigint; ema_reference: bigint; volume: bigint }[]>`
      SELECT weighted_median, ema_reference, volume FROM price_history
      WHERE product_id = ${IRON} AND city_id = 0 AND tick_id = ${tick.seq}`;
    expect(ph!.volume).toBe(qty(100));
    expect(ph!.weighted_median).toBe(money(40));
    // EMA: 0,25×40 + 0,75×28 = 31 ₺ — tek işlem referansı fırlatmaz (R2)
    expect(ph!.ema_reference).toBe(money(31));
  });

  it('devre kesici tek turda %15\'ten fazla hareketi kırpar (R2)', async () => {
    const s = await trader('S');
    const b = await trader('B');
    await trade(s, b, qty(100), money(500)); // referansın ~18 katı
    const tick = await runTick(sql);
    const [ph] = await sql<{ ema_reference: bigint }[]>`
      SELECT ema_reference FROM price_history WHERE product_id = ${IRON} AND city_id = 0 AND tick_id = ${tick.seq}`;
    // 28 × 1,15 = 32,20 ₺ tavanı
    expect(ph!.ema_reference).toBe(money(32.2));
  });

  it('işlem yoksa referans önceki değerde kalır', async () => {
    const first = await runTick(sql);
    const [a] = await sql<{ ema_reference: bigint }[]>`
      SELECT ema_reference FROM price_history WHERE product_id = ${IRON} AND city_id = 0 AND tick_id = ${first.seq}`;
    const second = await runTick(sql);
    const [b] = await sql<{ ema_reference: bigint }[]>`
      SELECT ema_reference FROM price_history WHERE product_id = ${IRON} AND city_id = 0 AND tick_id = ${second.seq}`;
    expect(b!.ema_reference).toBe(a!.ema_reference);
  });
});

describe('★ wash trade savunması (madde 48, R8)', () => {
  /** Doğrudan işlem yazar — eşleştirme motorunu atlayarak tespiti izole eder. */
  async function writeTrade(
    tickId: bigint, sellerId: string, buyerId: string, amount: bigint, price: bigint,
  ) {
    await sql`
      INSERT INTO market_trades (tick_id, buyer_company_id, seller_company_id, product_id,
                                 from_city_id, to_city_id, quantity, price_per_unit, quality)
      VALUES (${tickId}, ${buyerId}::uuid, ${sellerId}::uuid, ${IRON}, ${IST}, ${IST},
              ${amount}, ${price}, 80)`;
  }

  it('BİRİNCİL SAVUNMA: emir defteri wash trade\'i zaten engeller', async () => {
    // Dürüst satıcı ucuza satıyor
    const honest = await trader('Dürüst Satıcı');
    await stockUp(honest.facility.inventoryId, qty(400));
    await placeOrder(sql, { companyId: honest.id, facilityId: honest.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(400), price: money(28) });

    // Manipülatör ikili birbirine 280 ₺'den işlem yapmaya çalışıyor
    const a = await trader('Manipülatör A');
    const b = await trader('Manipülatör B');
    await stockUp(a.facility.inventoryId, qty(400));
    await placeOrder(sql, { companyId: a.id, facilityId: a.facility.id, cityId: IST, productId: IRON, side: 'SELL', quantity: qty(400), price: money(280) });
    await placeOrder(sql, { companyId: b.id, facilityId: b.facility.id, cityId: IST, productId: IRON, side: 'BUY', quantity: qty(400), price: money(280) });

    await runTick(sql);

    // ★ Alıcı kendi ortağıyla DEĞİL, dürüst satıcıyla eşleşti: motor alıcı için
    //   en ucuz toplam maliyeti seçer. Wash trade denemesi para kaybettirdi.
    const trades = await sql<{ seller_company_id: string; price_per_unit: bigint }[]>`
      SELECT seller_company_id, price_per_unit FROM market_trades ORDER BY id`;
    expect(trades[0]!.seller_company_id).toBe(honest.id);
    expect(trades[0]!.price_per_unit).toBeLessThan(money(280));
  });

  it('İKİNCİL SAVUNMA: yüksek pay + fiyat sapması işaretlenir', async () => {
    const [h1, h2, m1, m2] = await Promise.all(['H1', 'H2', 'M1', 'M2'].map((n) => trader(n)));
    // Dürüst hacim: makul fiyat, farklı ikililer
    await writeTrade(1n, h1.id, h2.id, qty(200), money(28));
    await writeTrade(1n, h2.id, h1.id, qty(100), money(29));
    // Manipülatör ikili: hacmin %30'undan fazlası, medyandan %20'den fazla sapma
    await writeTrade(1n, m1.id, m2.id, qty(400), money(280));

    const tick = await runTick(sql);
    const settle = tick.phases.SETTLE!.result as { flaggedPairs: number; excludedTrades: number };
    expect(settle.flaggedPairs).toBeGreaterThanOrEqual(1);

    const [flag] = await sql<{ bilateral_share: number; price_deviation_pct: number }[]>`
      SELECT bilateral_share, price_deviation_pct FROM trade_flags ORDER BY bilateral_share DESC`;
    expect(flag!.bilateral_share).toBeGreaterThan(0.3);
    expect(flag!.price_deviation_pct).toBeGreaterThan(0.2);

    // ★ İşlem İPTAL EDİLMEDİ — yalnız endeksten çıkarıldı (madde 48)
    const [{ count: total }] = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM market_trades`;
    expect(total).toBe(3n);
  });

  it('meşru yüksek hacimli ticaret işaretlenmez', async () => {
    const [p, r] = await Promise.all([trader('Büyük Üretici'), trader('Zincir Market')]);
    // Yüksek hacim ama fiyat piyasa medyanında — meşru
    await writeTrade(1n, p.id, r.id, qty(500), money(28));
    await writeTrade(1n, p.id, r.id, qty(500), money(28));
    const tick = await runTick(sql);
    expect((tick.phases.SETTLE!.result as { flaggedPairs: number }).flaggedPairs).toBe(0);
  });

  it('İNCE PİYASA SINIRI: tek ikili piyasanın tamamıysa sapma ölçülemez', async () => {
    // Manipülatörler piyasanın kendisi olduğunda medyan onların fiyatıdır;
    // sapma sıfır çıkar ve tespit çalışmaz. Bu, yöntemin BİLİNEN sınırıdır.
    // Zararı EMA yumuşatması ve %15 devre kesici sınırlar (R2).
    const [a, b] = await Promise.all([trader('Yalnız A'), trader('Yalnız B')]);
    await writeTrade(1n, a.id, b.id, qty(200), money(280));
    const tick = await runTick(sql);

    expect((tick.phases.SETTLE!.result as { flaggedPairs: number }).flaggedPairs).toBe(0);

    const [ph] = await sql<{ ema_reference: bigint }[]>`
      SELECT ema_reference FROM price_history
      WHERE product_id = ${IRON} AND city_id = 0 AND tick_id = ${tick.seq}`;
    // ★ Ama hasar sınırlı: 28 × 1,15 = 32,20 ₺'yi aşamadı
    expect(ph!.ema_reference).toBe(money(32.2));
  });
});

describe('★ likidite iskontosu (madde 41, C3)', () => {
  it('piyasayı stoklayan oyuncunun şirket değeri orantısız artmaz', async () => {
    // Piyasa hacmi oluştur
    const s = await trader('S');
    const b = await trader('B');
    await trade(s, b, qty(100), money(28));
    await runTick(sql);

    const modest = await trader('Ölçülü');
    const hoarder = await trader('İstifçi');
    await stockUp(modest.facility.inventoryId, qty(20));    // hacmin %20'si
    await stockUp(hoarder.facility.inventoryId, qty(2000)); // hacmin 20 katı

    const tick = await runTick(sql);
    const values = await sql<{ company_id: string; inventory_value: bigint }[]>`
      SELECT company_id, inventory_value FROM company_financials WHERE tick_id = ${tick.seq}`;
    const modestValue = values.find((v) => v.company_id === modest.id)!.inventory_value;
    const hoarderValue = values.find((v) => v.company_id === hoarder.id)!.inventory_value;

    // 100 kat stok, 100 kat değer VERMEZ — iskonto devrede
    expect(hoarderValue).toBeLessThan(modestValue * 100n);
    expect(hoarderValue).toBeGreaterThan(0n);
  });
});

describe('kur modeli', () => {
  it('her tur kur yazılır ve lansman çıpasından başlar', async () => {
    const tick = await runTick(sql);
    const [fx] = await sql<{ rate_try_per_usd: bigint; game_cpi: number }[]>`
      SELECT rate_try_per_usd, game_cpi FROM fx_rates WHERE tick_id = ${tick.seq}`;
    expect(fx!.rate_try_per_usd).toBe(money(35));
    expect(fx!.game_cpi).toBeCloseTo(1, 3);
  });

  it('fiyatlar yükselince kur da yükselir (PPP çıpası)', async () => {
    const s = await trader('S');
    const b = await trader('B');
    // Ekmek fiyatını yukarı çekerek CPI'yi yükselt
    const bakerySeller = await trader('Fırıncı');
    await stockUp(bakerySeller.facility.inventoryId, qty(500));
    await runTick(sql);
    const [before] = await sql<{ rate: bigint }[]>`
      SELECT rate_try_per_usd AS rate FROM fx_rates ORDER BY tick_id DESC LIMIT 1`;

    // Ekmekte yüksek fiyatlı işlemler → CPI yükselir
    for (let i = 0; i < 3; i++) {
      const x = await trader(`X${i}`);
      const y = await trader(`Y${i}`);
      await runInTransaction(sql, (tx) => addBatch(tx, {
        inventoryId: x.facility.inventoryId, productId: 3, quantity: qty(400),
        quality: 80, unitCost: money(10), producedInTick: 0n, expiresAtTick: null,
      }));
      await placeOrder(sql, { companyId: x.id, facilityId: x.facility.id, cityId: IST, productId: 3, side: 'SELL', quantity: qty(400), price: money(17) });
      await placeOrder(sql, { companyId: y.id, facilityId: y.facility.id, cityId: IST, productId: 3, side: 'BUY', quantity: qty(400), price: money(17) });
      await runTick(sql);
    }

    const [after] = await sql<{ rate: bigint; game_cpi: number }[]>`
      SELECT rate_try_per_usd AS rate, game_cpi FROM fx_rates ORDER BY tick_id DESC LIMIT 1`;
    expect(after!.game_cpi).toBeGreaterThan(1);
    expect(after!.rate).toBeGreaterThan(before!.rate);
  });
});
