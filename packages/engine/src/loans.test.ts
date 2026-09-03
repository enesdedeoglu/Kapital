import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkInvariants, runInTransaction, transfer, type Sql } from '@kapital/db';
import { cashOf, makeFacility, makePlayer, prepareTestDb, truncateGameState } from '@kapital/db/testing';
import { annuityPayment } from '@kapital/economy';
import { asMoney, money } from '@kapital/shared';
import { runTick } from './orchestrator.js';

let sql: Sql;

beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe(`
    TRUNCATE loans, loan_payments, city_demand, price_history, company_financials,
             facility_financials, economy_snapshots, fx_rates, foreign_trade_capacity
             RESTART IDENTITY CASCADE;
    DELETE FROM tick_phase_runs;
    DELETE FROM economic_ticks WHERE seq > 0;
  `);
});

const moneySupply = async () => {
  const [row] = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(cash), 0)::text AS total FROM companies WHERE kind <> 'SYSTEM'`;
  return BigInt(row!.total);
};

/** Şirketin nakdini defter üzerinden sıfırlar — taksit ödeyemez hale getirir. */
async function drain(companyId: string) {
  const [row] = await sql<{ cash: bigint }[]>`SELECT cash FROM companies WHERE id = ${companyId}::uuid`;
  if (row!.cash <= 0n) return;
  const [sink] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;
  await runInTransaction(sql, (tx) => transfer(tx, {
    tickId: 0n, fromCompanyId: companyId, toCompanyId: sink!.id,
    amount: asMoney(row!.cash), account: 'TAX', reason: 'test: nakit boşaltma',
  }));
}

const systemCash = async (code: string) => {
  const [row] = await sql<{ cash: bigint }[]>`
    SELECT cash FROM companies WHERE system_code = ${code}`;
  return row!.cash;
};

/** Krediyi doğrudan yazar ve anaparayı SYS_BANK'tan aktarır. */
async function lend(companyId: string, principal: bigint, opts: {
  rate?: number; term?: number; payment?: bigint;
} = {}) {
  const rate = opts.rate ?? 0.001;
  const term = opts.term ?? 100;
  const payment = opts.payment ?? (annuityPayment(asMoney(principal), rate, term) as bigint);
  const [loan] = await sql<{ id: bigint }[]>`
    INSERT INTO loans (company_id, principal, interest_rate, remaining_balance,
                       payment_per_tick, company_value_at_open, leverage_at_open,
                       opened_tick, due_tick)
    VALUES (${companyId}::uuid, ${principal}, ${rate}, ${principal}, ${payment},
            ${principal * 3n}, 0.4, 0, ${term})
    RETURNING id`;
  const [bank] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_BANK'`;
  await runInTransaction(sql, (tx) => transfer(tx, {
    tickId: 0n, fromCompanyId: bank!.id, toCompanyId: companyId,
    amount: asMoney(principal), account: 'LOAN_PRINCIPAL', reason: 'test kredisi',
    refType: 'loan', refId: loan!.id.toString(),
  }));
  return loan!.id;
}

describe('★ R15 — kredi anaparası para yaratır', () => {
  it('kredi kullandırımı para arzını anapara kadar artırır', async () => {
    const player = await makePlayer(sql, money(10_000));
    const before = await moneySupply();
    await lend(player.id, money(50_000));
    expect(await moneySupply()).toBe(before + money(50_000));
    // SYS_BANK negatife gitti: dolaşımdaki kredi
    expect(await systemCash('SYS_BANK')).toBe(-money(50_000));
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('★ anapara geri ödemesi parayı YOK EDER, faiz ekonomiden ÇIKAR', async () => {
    const player = await makePlayer(sql, money(200_000));
    await makeFacility(sql, player.id, { typeCode: 'MARKET' });
    await lend(player.id, money(100_000), { rate: 0.001, term: 100 });

    const supplyBefore = await moneySupply();
    const sinkBefore = await systemCash('SYS_SINK');
    const bankBefore = await systemCash('SYS_BANK');

    const tick = await runTick(sql);
    const loans = (tick.phases.UPKEEP!.result as { loans: { collected: bigint; interestCollected: bigint } }).loans;

    const [payment] = await sql<{ principal_part: bigint; interest_part: bigint }[]>`
      SELECT principal_part, interest_part FROM loan_payments WHERE tick_id = ${tick.seq}`;
    // faiz = 100.000 × 0,001 = 100 ₺
    expect(payment!.interest_part).toBe(money(100));
    expect(loans.interestCollected).toBe(money(100));

    // Anapara SYS_BANK'a döndü → dolaşımdaki kredi azaldı
    expect(await systemCash('SYS_BANK')).toBe(bankBefore + payment!.principal_part);
    // Faiz SYS_SINK'e gitti → kalıcı gider
    const [maint] = await sql<{ amount: bigint }[]>`
      SELECT COALESCE(SUM(amount),0)::bigint AS amount FROM ledger_entries
      WHERE tick_id = ${tick.seq} AND account = 'MAINTENANCE' AND direction = 'DEBIT'`;
    expect(await systemCash('SYS_SINK')).toBe(sinkBefore + payment!.interest_part + maint!.amount);

    // Para arzı taksit kadar azaldı (bakım hariç)
    expect(await moneySupply()).toBe(supplyBefore - payment!.principal_part - payment!.interest_part - maint!.amount);
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('kredinin para arzı içindeki payı izlenir ve eşik aşılınca alarm verir', async () => {
    const player = await makePlayer(sql, money(10_000));
    await lend(player.id, money(500_000)); // arzın çoğu kredi
    const tick = await runTick(sql);

    const close = tick.phases.CLOSE!.result as { creditShare: number; creditAlarm: boolean };
    expect(close.creditShare).toBeGreaterThan(0.2);
    expect(close.creditAlarm).toBe(true);

    const [snap] = await sql<{ credit_outstanding: bigint; active_loans: number }[]>`
      SELECT credit_outstanding, active_loans FROM economy_snapshots WHERE tick_id = ${tick.seq}`;
    expect(snap!.active_loans).toBe(1);
    expect(snap!.credit_outstanding).toBeGreaterThan(0n);
  });
});

describe('şirket değeri', () => {
  it('★ kredi çekmek şirket değerini ARTIRMAZ — borç düşülür (madde 41)', async () => {
    const a = await makePlayer(sql, money(100_000), 'Borçsuz');
    const b = await makePlayer(sql, money(100_000), 'Borçlu');
    await lend(b.id, money(50_000));

    const tick = await runTick(sql);
    const values = await sql<{ company_id: string; company_value: bigint; debt: bigint }[]>`
      SELECT company_id, company_value, debt FROM company_financials WHERE tick_id = ${tick.seq}`;
    const clean = values.find((v) => v.company_id === a.id)!;
    const indebted = values.find((v) => v.company_id === b.id)!;

    expect(indebted.debt).toBeGreaterThan(0n);
    // Nakit kredi kadar fazla ama borç düşülüyor. Aradaki tek fark bu turda
    // ödenen FAİZdir — anapara ödemesi hem nakdi hem borcu aynı kadar azaltır.
    const [fin] = await sql<{ interest_cost: bigint }[]>`
      SELECT interest_cost FROM company_financials
      WHERE tick_id = ${tick.seq} AND company_id = ${b.id}::uuid`;
    expect(clean.company_value - indebted.company_value).toBe(fin!.interest_cost);
  });

  it('faiz gideri finansallarda ayrı görünür', async () => {
    const player = await makePlayer(sql, money(200_000));
    await lend(player.id, money(100_000), { rate: 0.001 });
    const tick = await runTick(sql);
    const [fin] = await sql<{ interest_cost: bigint }[]>`
      SELECT interest_cost FROM company_financials
      WHERE tick_id = ${tick.seq} AND company_id = ${player.id}::uuid`;
    expect(fin!.interest_cost).toBe(money(100));
  });
});

describe('★ R16 — kademeli temerrüt (madde 40)', () => {
  it('taksit ödenemezse şirket ANINDA batmaz, kaçırılan sayılır', async () => {
    const player = await makePlayer(sql, money(0));
    await makeFacility(sql, player.id, { typeCode: 'MARKET' });
    const loanId = await lend(player.id, money(100_000));
    await drain(player.id); // kredi parasını da harcadı — taksit ödeyemez

    const tick = await runTick(sql);
    const loans = (tick.phases.UPKEEP!.result as { loans: { missedPayments: number; bankruptcies: number } }).loans;
    expect(loans.missedPayments).toBe(1);
    expect(loans.bankruptcies).toBe(0);

    const [loan] = await sql<{ missed_payments: number; status: string }[]>`
      SELECT missed_payments, status FROM loans WHERE id = ${loanId}`;
    expect(loan!.missed_payments).toBe(1);
    expect(loan!.status).toBe('ACTIVE');

    const [company] = await sql<{ status: string }[]>`
      SELECT status FROM companies WHERE id = ${player.id}::uuid`;
    expect(company!.status).toBe('ACTIVE'); // ★ batmadı

    const [notice] = await sql<{ topic: string }[]>`
      SELECT topic FROM outbox WHERE topic = 'loan.missed'`;
    expect(notice).toBeDefined(); // uyarı gitti
  });

  it('★ 3 kaçırılan taksitte TEK tesis tasfiye edilir, şirket yaşar', async () => {
    const player = await makePlayer(sql, money(0));
    await makeFacility(sql, player.id, { typeCode: 'MARKET' });
    await makeFacility(sql, player.id, { typeCode: 'GREENGROCER' });
    const loanId = await lend(player.id, money(100_000));
    await drain(player.id);

    let liquidations = 0;
    for (let i = 0; i < 3; i++) {
      const tick = await runTick(sql);
      liquidations += (tick.phases.UPKEEP!.result as { loans: { liquidations: number } }).loans.liquidations;
    }
    expect(liquidations).toBe(1);

    const facilities = await sql<{ closed_at: Date | null; halted_reason: string | null }[]>`
      SELECT closed_at, halted_reason FROM facilities WHERE company_id = ${player.id}::uuid`;
    expect(facilities.filter((f) => f.closed_at !== null)).toHaveLength(1);
    expect(facilities.find((f) => f.closed_at !== null)!.halted_reason).toMatch(/tasfiye/);

    // Ucuz olan (Manav 8.000) gitti, pahalı olan (Market 35.000) kaldı
    const [remaining] = await sql<{ code: string }[]>`
      SELECT ft.code FROM facilities f JOIN facility_types ft ON ft.id = f.facility_type_id
      WHERE f.company_id = ${player.id}::uuid AND f.closed_at IS NULL`;
    expect(remaining!.code).toBe('MARKET');

    // Borç tasfiye değeri kadar azaldı, sayaç sıfırlandı
    const [loan] = await sql<{ remaining_balance: bigint; missed_payments: number; status: string }[]>`
      SELECT remaining_balance, missed_payments, status FROM loans WHERE id = ${loanId}`;
    expect(loan!.remaining_balance).toBeLessThan(money(100_000));
    expect(loan!.missed_payments).toBe(0);
    expect(loan!.status).toBe('ACTIVE');

    const [company] = await sql<{ status: string }[]>`
      SELECT status FROM companies WHERE id = ${player.id}::uuid`;
    expect(company!.status).toBe('ACTIVE'); // ★ hâlâ oyunda
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('tasfiye edilecek tesis kalmayınca iflas eder', async () => {
    const player = await makePlayer(sql, money(0));
    await makeFacility(sql, player.id, { typeCode: 'GREENGROCER' });
    await lend(player.id, money(500_000)); // tek tesis kapatamaz
    await drain(player.id);

    let bankruptcies = 0;
    for (let i = 0; i < 8; i++) {
      const tick = await runTick(sql);
      bankruptcies += (tick.phases.UPKEEP!.result as { loans: { bankruptcies: number } }).loans.bankruptcies;
    }
    expect(bankruptcies).toBe(1);

    const [company] = await sql<{ status: string }[]>`
      SELECT status FROM companies WHERE id = ${player.id}::uuid`;
    expect(company!.status).toBe('BANKRUPT');

    const [loan] = await sql<{ status: string; defaulted_at_tick: bigint | null }[]>`
      SELECT status, defaulted_at_tick FROM loans WHERE company_id = ${player.id}::uuid`;
    expect(loan!.status).toBe('DEFAULTED');
    expect(loan!.defaulted_at_tick).not.toBeNull();
    expect((await checkInvariants(sql)).ok).toBe(true);
  });
});

describe('kredi yaşam döngüsü', () => {
  it('kredi vadesinde tamamen kapanır', async () => {
    const player = await makePlayer(sql, money(500_000));
    await lend(player.id, money(10_000), { rate: 0, term: 5, payment: money(2_000) });

    for (let i = 0; i < 6; i++) await runTick(sql);
    const [loan] = await sql<{ status: string; remaining_balance: bigint; total_paid: bigint }[]>`
      SELECT status, remaining_balance, total_paid FROM loans WHERE company_id = ${player.id}::uuid`;
    expect(loan!.status).toBe('PAID');
    expect(loan!.remaining_balance).toBe(0n);
    expect(loan!.total_paid).toBe(money(10_000));
    expect((await checkInvariants(sql)).ok).toBe(true);
  });

  it('taksit geçmişi kaydedilir — "neden battım" cevaplanabilir', async () => {
    const player = await makePlayer(sql, money(200_000));
    await lend(player.id, money(50_000), { rate: 0.001, term: 100 });
    await runTick(sql);
    await runTick(sql);

    const payments = await sql<{ outcome: string; principal_part: bigint; interest_part: bigint }[]>`
      SELECT outcome, principal_part, interest_part FROM loan_payments ORDER BY tick_id`;
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.outcome === 'PAID')).toBe(true);
    // Anüitede faiz payı zamanla azalır
    expect(payments[1]!.interest_part).toBeLessThan(payments[0]!.interest_part);
    expect(payments[1]!.principal_part).toBeGreaterThan(payments[0]!.principal_part);
  });

  it('idempotent: aynı tur iki kez koşarsa taksit iki kez alınmaz', async () => {
    const player = await makePlayer(sql, money(200_000));
    await lend(player.id, money(50_000));
    const tick = await runTick(sql);
    const cash = await cashOf(sql, player.id);

    await sql`UPDATE tick_phase_runs SET status = 'PENDING' WHERE tick_id = ${tick.tickId}`;
    await sql`UPDATE economic_ticks SET status = 'RUNNING' WHERE id = ${tick.tickId}`;
    await runTick(sql);

    expect(await cashOf(sql, player.id)).toBe(cash);
    const [{ count }] = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM loan_payments`;
    expect(count).toBe(1n);
  });
});
