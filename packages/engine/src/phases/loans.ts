import { transfer, type Sql } from '@kapital/db';
import { liquidationValue, splitInstallment } from '@kapital/economy';
import {
  asMoney, deterministicUuid, formatMoney, InsufficientFunds, toJson, type Money,
} from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';

export interface LoanPhaseResult {
  activeLoans: number;
  collected: bigint;
  interestCollected: bigint;
  missedPayments: number;
  liquidations: number;
  bankruptcies: number;
  settled: number;
}

interface LoanRow {
  id: bigint; company_id: string; remaining_balance: bigint; payment_per_tick: bigint;
  interest_rate: number; missed_payments: number; default_after_missed: number;
  company_name: string;
}

/**
 * Kredi taksitlerini tahsil eder — P4 (UPKEEP) fazının parçası.
 *
 * ★ Faiz ve anapara AYRI yerlere gider (R15):
 *   · anapara → `SYS_BANK` — kredinin YARATTIĞI parayı geri alır (yok eder)
 *   · faiz    → `SYS_SINK` — kalıcı gider, ekonomiden çıkar
 * İkisi aynı hesaba yazılsaydı para arzı ölçümü bozulurdu.
 *
 * ★ Kademeli temerrüt (R16, madde 40): nakit yetmezse şirket ANINDA batmaz.
 * Kaçırılan taksit sayılır, eşik aşılınca TEK tesis tasfiye edilir ve sayaç
 * sıfırlanır. Ancak tasfiye edilecek tesis kalmazsa şirket iflas eder.
 */
export async function collectLoanPayments(sql: Sql, tick: EngineTick): Promise<LoanPhaseResult> {
  const cfg = configValue<{ liquidationRate: number }>(
    tick, 'economy.loan', { liquidationRate: 0.5 },
  );

  const [bank] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_BANK'`;
  const [sink] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;

  // Yalnız aktif krediler taranır (madde 54)
  const loans = await sql<LoanRow[]>`
    SELECT l.id, l.company_id, l.remaining_balance, l.payment_per_tick, l.interest_rate,
           l.missed_payments, COALESCE(t.default_after_missed, 3) AS default_after_missed,
           c.name AS company_name
    FROM loans l
    JOIN companies c ON c.id = l.company_id AND c.status = 'ACTIVE'
    LEFT JOIN LATERAL (
      SELECT default_after_missed FROM loan_terms
      WHERE level_min <= c.level ORDER BY level_min DESC LIMIT 1
    ) t ON TRUE
    WHERE l.status = 'ACTIVE'
    ORDER BY l.id`;

  const result: LoanPhaseResult = {
    activeLoans: loans.length, collected: 0n, interestCollected: 0n,
    missedPayments: 0, liquidations: 0, bankruptcies: 0, settled: 0,
  };
  const out = result as { -readonly [K in keyof LoanPhaseResult]: LoanPhaseResult[K] };

  for (const loan of loans) {
    const split = splitInstallment(
      asMoney(loan.remaining_balance), asMoney(loan.payment_per_tick), loan.interest_rate,
    );
    if (split.amount <= 0n) continue;

    try {
      await sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        if (split.principalPart > 0n) {
          await transfer(t, {
            tickId: tick.seq,
            txId: deterministicUuid('loan-principal', tick.seq, loan.id),
            fromCompanyId: loan.company_id, toCompanyId: bank!.id,
            amount: split.principalPart, account: 'LOAN_REPAYMENT',
            reason: 'kredi anapara ödemesi', refType: 'loan', refId: loan.id.toString(),
          });
        }
        if (split.interestPart > 0n) {
          await transfer(t, {
            tickId: tick.seq,
            txId: deterministicUuid('loan-interest', tick.seq, loan.id),
            fromCompanyId: loan.company_id, toCompanyId: sink!.id,
            amount: split.interestPart, account: 'INTEREST',
            reason: 'kredi faizi', refType: 'loan', refId: loan.id.toString(),
          });
        }
        await t`
          UPDATE loans
             SET remaining_balance = ${split.balanceAfter},
                 total_paid = total_paid + ${split.amount},
                 interest_paid = interest_paid + ${split.interestPart},
                 missed_payments = 0,
                 status = ${split.settles ? 'PAID' : 'ACTIVE'}::loan_status
           WHERE id = ${loan.id}`;
        await recordPayment(t, tick, loan, split.amount, split.principalPart,
          split.interestPart, split.balanceAfter, 'PAID');
      });

      out.collected += split.amount as bigint;
      out.interestCollected += split.interestPart as bigint;
      if (split.settles) out.settled++;
    } catch (error) {
      if (!(error instanceof InsufficientFunds)) throw error;

      const missed = loan.missed_payments + 1;
      await sql`UPDATE loans SET missed_payments = ${missed} WHERE id = ${loan.id}`;
      await recordPayment(sql, tick, loan, 0n as Money, 0n as Money, 0n as Money,
        asMoney(loan.remaining_balance), 'MISSED');
      out.missedPayments++;

      await notify(sql, tick, loan.company_id, 'loan.missed', {
        loanId: loan.id.toString(), missed,
        limit: loan.default_after_missed,
        amount: split.amount.toString(),
        amountFormatted: formatMoney(split.amount),
      });

      if (missed >= loan.default_after_missed) {
        const outcome = await liquidate(sql, tick, loan, cfg.liquidationRate);
        if (outcome === 'LIQUIDATED') out.liquidations++;
        if (outcome === 'BANKRUPT') out.bankruptcies++;
      }
    }
  }

  return result;
}

/**
 * Kademeli ceza: TEK tesis tasfiye edilir ve sayaç sıfırlanır.
 *
 * En düşük değerli tesis seçilir — oyuncunun ana üretim hattı en son gider.
 * Tasfiye bir NAKİT hareketi değildir: banka varlığa el koyar ve borç azalır.
 * Defterde karşılığı yoktur çünkü kredinin yarattığı para zaten CAPEX ile
 * ekonomiden çıkmıştı; `Σ bakiye = 0` özdeşliği bozulmaz.
 */
async function liquidate(
  sql: Sql, tick: EngineTick, loan: LoanRow, rate: number,
): Promise<'LIQUIDATED' | 'BANKRUPT'> {
  const [facility] = await sql<{ id: string; base_cost: bigint; name: string }[]>`
    SELECT f.id, ft.base_cost, COALESCE(f.name, ft.name) AS name
    FROM facilities f JOIN facility_types ft ON ft.id = f.facility_type_id
    WHERE f.company_id = ${loan.company_id}::uuid AND f.closed_at IS NULL
    ORDER BY ft.base_cost ASC, f.created_at ASC LIMIT 1`;

  if (!facility) {
    await sql`UPDATE companies SET status = 'BANKRUPT' WHERE id = ${loan.company_id}::uuid`;
    await sql`UPDATE loans SET status = 'DEFAULTED', defaulted_at_tick = ${tick.seq}
               WHERE company_id = ${loan.company_id}::uuid AND status = 'ACTIVE'`;
    await notify(sql, tick, loan.company_id, 'company.bankrupt', {
      reason: 'tasfiye edilecek tesis kalmadı', loanId: loan.id.toString(),
    });
    return 'BANKRUPT';
  }

  const recovered = liquidationValue(asMoney(facility.base_cost), rate) as bigint;
  const balance = loan.remaining_balance > recovered ? loan.remaining_balance - recovered : 0n;

  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`UPDATE facilities SET closed_at = NOW(), production_enabled = FALSE,
                                  halted_reason = 'kredi temerrüdü nedeniyle tasfiye edildi'
             WHERE id = ${facility.id}::uuid`;
    await t`UPDATE loans
               SET remaining_balance = ${balance}, missed_payments = 0,
                   status = ${balance <= 0n ? 'LIQUIDATED' : 'ACTIVE'}::loan_status
             WHERE id = ${loan.id}`;
    await recordPayment(t, tick, loan, asMoney(recovered), asMoney(recovered),
      0n as Money, asMoney(balance), 'LIQUIDATION');
  });

  await notify(sql, tick, loan.company_id, 'loan.liquidation', {
    loanId: loan.id.toString(), facility: facility.name,
    recovered: recovered.toString(), recoveredFormatted: formatMoney(asMoney(recovered)),
    remainingBalance: balance.toString(),
  });
  return 'LIQUIDATED';
}

async function recordPayment(
  tx: Sql, tick: EngineTick, loan: LoanRow,
  amount: Money, principal: Money, interest: Money, balanceAfter: Money, outcome: string,
): Promise<void> {
  await tx`
    INSERT INTO loan_payments (tick_id, loan_id, company_id, amount, principal_part,
                               interest_part, balance_after, outcome)
    VALUES (${tick.seq}, ${loan.id}, ${loan.company_id}::uuid, ${amount}, ${principal},
            ${interest}, ${balanceAfter}, ${outcome})
    ON CONFLICT (tick_id, loan_id) DO NOTHING`;
}

/** Bildirim `outbox`'a yazılır — tur transaction'ı içinde push gönderilmez. */
async function notify(
  sql: Sql, tick: EngineTick, companyId: string, topic: string, payload: unknown,
): Promise<void> {
  await sql`
    INSERT INTO outbox (topic, payload, tick_id, dedupe_key)
    VALUES (${topic}, ${toJson({ companyId, tickSeq: tick.seq.toString(), ...(payload as object) })}::text::jsonb,
            ${tick.seq}, ${`${topic}:${tick.seq}:${companyId}`})
    ON CONFLICT (dedupe_key) DO NOTHING`;
}
