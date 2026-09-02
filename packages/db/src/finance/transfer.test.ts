import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../client.js';
import { cashOf, makePlayer, prepareTestDb, systemCompanyId, truncateGameState } from '../testing/harness.js';
import { runInTransaction, transfer, withDeadlockRetry } from './transfer.js';
import { checkInvariants } from './invariants.js';
import { InsufficientFunds, money } from '@kapital/shared';

let sql: Sql;
let bank: string;
let sink: string;

beforeAll(async () => {
  sql = await prepareTestDb();
  bank = await systemCompanyId(sql, 'SYS_BANK');
  sink = await systemCompanyId(sql, 'SYS_SINK');
});
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => { await truncateGameState(sql); });

const send = (input: Parameters<typeof transfer>[1]) =>
  runInTransaction(sql, (tx) => transfer(tx, input));

describe('temel davranış', () => {
  it('parayı taşır ve defterin iki tarafını yazar', async () => {
    const a = await makePlayer(sql, money(1000), 'A');
    const b = await makePlayer(sql, money(0), 'B');

    await send({
      tickId: 0n, fromCompanyId: a.id, toCompanyId: b.id,
      amount: money(250), account: 'TRADE', reason: 'test',
    });

    expect(await cashOf(sql, a.id)).toBe(money(750));
    expect(await cashOf(sql, b.id)).toBe(money(250));

    const rows = await sql<{ direction: string; amount: bigint }[]>`
      SELECT direction, amount FROM ledger_entries WHERE account = 'TRADE'
      ORDER BY direction::text`;
    expect(rows.map((r) => r.direction)).toEqual(['CREDIT', 'DEBIT']);
    expect(rows.every((r) => r.amount === money(250))).toBe(true);
  });

  it('sistem şirketi negatife düşebilir — musluk tanımı gereği karşılıksız öder', async () => {
    const p = await makePlayer(sql, money(0));
    const consumer = await systemCompanyId(sql, 'SYS_CONSUMER');

    await send({
      tickId: 0n, fromCompanyId: consumer, toCompanyId: p.id,
      amount: money(5000), account: 'SALES', reason: 'perakende satış',
    });

    expect(await cashOf(sql, consumer)).toBe(money(-5000));
    expect(await cashOf(sql, p.id)).toBe(money(5000));
  });

  it('kendine transferi ve sıfır/negatif tutarı reddeder', async () => {
    const a = await makePlayer(sql, money(100));
    await expect(send({
      tickId: 0n, fromCompanyId: a.id, toCompanyId: a.id,
      amount: money(1), account: 'TRADE', reason: 'x',
    })).rejects.toThrow(/aynı olamaz/);
    await expect(send({
      tickId: 0n, fromCompanyId: a.id, toCompanyId: bank,
      amount: money(0), account: 'TRADE', reason: 'x',
    })).rejects.toThrow(/pozitif olmalı/);
  });
});

describe('T1 — çift harcama savunması', () => {
  it('100 eşzamanlı harcamada nakit yalnız 50\'ye yetiyorsa tam 50 başarılı olur', async () => {
    const a = await makePlayer(sql, money(500), 'Yarışan');
    const each = money(10); // 500 / 10 = 50 adet

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        withDeadlockRetry(() => send({
          tickId: 0n, fromCompanyId: a.id, toCompanyId: sink,
          amount: each, account: 'MAINTENANCE', reason: 'eşzamanlı harcama',
        })),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(ok).toBe(50);
    expect(rejected).toHaveLength(50);
    expect(rejected.every((r) => (r as PromiseRejectedResult).reason instanceof InsufficientFunds)).toBe(true);
    expect(await cashOf(sql, a.id)).toBe(money(0));
    // Negatife hiç düşmedi
    const [{ min }] = await sql<{ min: bigint }[]>`
      SELECT MIN(cash) AS min FROM companies WHERE kind <> 'SYSTEM'`;
    expect(min >= 0n).toBe(true);
  });

  it('yetersiz bakiyede defter satırı da yazılmaz (transaction geri alınır)', async () => {
    const a = await makePlayer(sql, money(10));
    const txId = randomUUID();
    await expect(send({
      tickId: 0n, txId, fromCompanyId: a.id, toCompanyId: sink,
      amount: money(9999), account: 'TAX', reason: 'çok büyük',
    })).rejects.toBeInstanceOf(InsufficientFunds);

    const rows = await sql`SELECT 1 FROM ledger_entries WHERE tx_id = ${txId}::uuid`;
    expect(rows).toHaveLength(0);
  });
});

describe('T3 — idempotency', () => {
  it('aynı txId 3 kez gönderilse de tek etki oluşur', async () => {
    const a = await makePlayer(sql, money(1000));
    const txId = randomUUID();
    const input = {
      tickId: 0n, txId, fromCompanyId: a.id, toCompanyId: sink,
      amount: money(300), account: 'RENT' as const, reason: 'kira',
    };

    const first = await send(input);
    const second = await send(input);
    const third = await send(input);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(third.applied).toBe(false);
    expect(await cashOf(sql, a.id)).toBe(money(700));

    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM ledger_entries WHERE tx_id = ${txId}::uuid`;
    expect(count).toBe(2n); // yalnız bir çift
  });

  it('aynı txId eşzamanlı 20 kez gönderilse de tek etki oluşur', async () => {
    const a = await makePlayer(sql, money(1000));
    const txId = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        withDeadlockRetry(() => send({
          tickId: 0n, txId, fromCompanyId: a.id, toCompanyId: sink,
          amount: money(100), account: 'RENT', reason: 'kira',
        })),
      ),
    );
    const applied = results.filter((r) => r.status === 'fulfilled' && r.value.applied).length;
    expect(applied).toBe(1);
    expect(await cashOf(sql, a.id)).toBe(money(900));
  });
});

describe('T4 — deadlock', () => {
  it('A→B ve B→A karşılıklı transferlerde deadlock oluşmaz', async () => {
    const a = await makePlayer(sql, money(10_000), 'A');
    const b = await makePlayer(sql, money(10_000), 'B');

    const pairs = Array.from({ length: 120 }, (_, i) => {
      const [from, to] = i % 2 === 0 ? [a.id, b.id] : [b.id, a.id];
      return send({
        tickId: 0n, fromCompanyId: from, toCompanyId: to,
        amount: money(5), account: 'TRADE', reason: `çapraz ${i}`,
      });
    });

    const results = await Promise.allSettled(pairs);
    const deadlocks = results.filter(
      (r) => r.status === 'rejected' && (r.reason as { code?: string })?.code === '40P01',
    );
    expect(deadlocks).toHaveLength(0);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // Eşit sayıda gidiş-dönüş → bakiyeler başlangıçtaki gibi
    expect(await cashOf(sql, a.id)).toBe(money(10_000));
    expect(await cashOf(sql, b.id)).toBe(money(10_000));
  });
});

describe('T6 — değişmezler', () => {
  it('yoğun trafikten sonra Σ bakiye = defter toplamı ve global toplam sıfır', async () => {
    const players = await Promise.all(
      Array.from({ length: 6 }, (_, i) => makePlayer(sql, money(2_000), `Ş${i}`)),
    );

    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 200; i++) {
      const from = players[i % players.length]!;
      const to = players[(i * 3 + 1) % players.length]!;
      if (from.id === to.id) continue;
      ops.push(
        withDeadlockRetry(() => send({
          tickId: 0n, fromCompanyId: from.id, toCompanyId: to.id,
          amount: money(7), account: 'TRADE', reason: `yük ${i}`,
        })).catch((e) => { if (!(e instanceof InsufficientFunds)) throw e; }),
      );
    }
    await Promise.all(ops);

    const report = await checkInvariants(sql);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('USD defteri ₺ defterinden ayrı ayrı dengelidir', async () => {
    const p = await makePlayer(sql, money(0));
    const fx = await systemCompanyId(sql, 'SYS_FX');

    await send({
      tickId: 0n, fromCompanyId: fx, toCompanyId: p.id,
      amount: money(1_000), currency: 'USD', account: 'FX_CONVERSION', reason: 'döviz alımı',
    });

    const [row] = await sql<{ usd: bigint }[]>`
      SELECT usd_balance AS usd FROM companies WHERE id = ${p.id}`;
    expect(row!.usd).toBe(money(1_000));
    expect(await cashOf(sql, p.id)).toBe(money(0)); // ₺ etkilenmedi

    const report = await checkInvariants(sql);
    expect(report.ok).toBe(true);
  });
});
