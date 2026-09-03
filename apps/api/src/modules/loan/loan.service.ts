import { Inject, Injectable } from '@nestjs/common';
import { currentTickSeq, runInTransaction, transfer, type Sql } from '@kapital/db';
import {
  annuityPayment, inflationAdjustedRate, maxLoanAmount, paymentBurden, splitInstallment,
} from '@kapital/economy';
import {
  asMoney, DomainError, formatMoney, InsufficientFunds, money, NotFound,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { TakeLoanDto } from './loan.dto.js';

interface Borrower {
  id: string; name: string; level: number; cash: bigint;
  companyValue: bigint; debt: bigint; revenuePerTick: bigint;
}

@Injectable()
export class LoanService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /** Kredi durumu: limit, kademe, açık krediler ve ödeme yükü uyarısı. */
  async overview(userId: string) {
    const borrower = await this.borrower(userId);
    const terms = await this.terms(borrower.level);
    const rate = await this.currentRate(terms.interest_rate);

    const available = maxLoanAmount(
      asMoney(borrower.companyValue), asMoney(borrower.debt), terms.leverage_ratio,
    );

    const loans = await this.sql<Record<string, never>[]>`
      SELECT l.id, l.principal, l.remaining_balance, l.payment_per_tick, l.interest_rate,
             l.total_paid, l.interest_paid, l.missed_payments, l.opened_tick, l.due_tick,
             l.status
      FROM loans l WHERE l.company_id = ${borrower.id}::uuid
      ORDER BY l.status, l.id DESC LIMIT 50`;

    const tickSeq = await currentTickSeq(this.sql);
    return {
      companyValue: borrower.companyValue.toString(),
      companyValueFormatted: formatMoney(asMoney(borrower.companyValue)),
      totalDebt: borrower.debt.toString(),
      totalDebtFormatted: formatMoney(asMoney(borrower.debt)),
      leverageRatio: terms.leverage_ratio,
      interestRatePerTick: rate,
      /** Yıllık karşılığı — oyuncu için okunabilir hale getirilir. */
      interestRateAnnualPct: Number(((Math.pow(1 + rate, 2688) - 1) * 100).toFixed(2)),
      maxTermTicks: terms.max_term_ticks,
      availableCredit: available.toString(),
      availableCreditFormatted: formatMoney(available),
      loans: loans.map((r) => {
        const l = r as unknown as Record<string, never>;
        const balance = asMoney(l.remaining_balance as unknown as bigint);
        const payment = asMoney(l.payment_per_tick as unknown as bigint);
        return {
          id: (l.id as unknown as bigint).toString(),
          status: l.status,
          principal: (l.principal as unknown as bigint).toString(),
          remainingBalance: balance.toString(),
          remainingBalanceFormatted: formatMoney(balance),
          paymentPerTick: payment.toString(),
          paymentPerTickFormatted: formatMoney(payment),
          totalPaid: (l.total_paid as unknown as bigint).toString(),
          interestPaid: (l.interest_paid as unknown as bigint).toString(),
          missedPayments: l.missed_payments,
          ticksRemaining: Number((l.due_tick as unknown as bigint) - tickSeq),
          /** ★ R16: taksidin gelire oranı — batmadan önce görünsün. */
          paymentBurden: paymentBurden(payment, asMoney(borrower.revenuePerTick)),
        };
      }),
    };
  }

  /**
   * Kredi kullandırır.
   *
   * ★ Anapara `SYS_BANK`'tan çıkar — bu bir PARA YARATMA işlemidir (R15).
   * Limit bu yüzden keyfi olamaz: şirket değerine bağlıdır ve şirket
   * değerindeki stok likidite iskontosuyla değerlenir (C3), böylece teminat
   * piyasayı stoklayarak şişirilemez.
   */
  async take(userId: string, dto: TakeLoanDto) {
    const borrower = await this.borrower(userId);
    const terms = await this.terms(borrower.level);

    if (borrower.companyValue <= 0n) {
      throw new DomainError('VALIDATION',
        'Şirket değeri henüz hesaplanmadı — ilk ekonomik turu bekleyin', {
          hint: 'şirket değeri her turun sonunda güncellenir',
        });
    }

    const amount = money(dto.amount);
    const available = maxLoanAmount(
      asMoney(borrower.companyValue), asMoney(borrower.debt), terms.leverage_ratio,
    );
    if (amount > available) {
      throw new DomainError('VALIDATION', 'Kredi limiti aşıldı', {
        requested: amount.toString(),
        available: available.toString(),
        availableFormatted: formatMoney(available),
        companyValue: borrower.companyValue.toString(),
        leverageRatio: terms.leverage_ratio,
      });
    }

    const term = Math.min(dto.termTicks ?? terms.max_term_ticks, terms.max_term_ticks);
    const rate = await this.currentRate(terms.interest_rate);
    const payment = annuityPayment(amount, rate, term);
    const tickSeq = await currentTickSeq(this.sql);

    const loanId = await runInTransaction(this.sql, async (tx) => {
      const [bank] = await tx<{ id: string }[]>`
        SELECT id FROM companies WHERE system_code = 'SYS_BANK'`;

      const [loan] = await tx<{ id: bigint }[]>`
        INSERT INTO loans (company_id, principal, interest_rate, remaining_balance,
                           payment_per_tick, company_value_at_open, leverage_at_open,
                           opened_tick, due_tick)
        VALUES (${borrower.id}::uuid, ${amount}, ${rate}, ${amount}, ${payment},
                ${borrower.companyValue}, ${terms.leverage_ratio}, ${tickSeq},
                ${tickSeq + BigInt(term)})
        RETURNING id`;

      // Para YARATILIR: SYS_BANK'ın bakiyesi negatife gider
      await transfer(tx, {
        tickId: tickSeq, fromCompanyId: bank!.id, toCompanyId: borrower.id,
        amount, account: 'LOAN_PRINCIPAL', reason: 'kredi kullandırımı',
        refType: 'loan', refId: loan!.id.toString(),
      });
      return loan!.id;
    });

    const burden = paymentBurden(payment, asMoney(borrower.revenuePerTick));
    return {
      loanId: loanId.toString(),
      amount: amount.toString(),
      amountFormatted: formatMoney(amount),
      interestRatePerTick: rate,
      termTicks: term,
      paymentPerTick: payment.toString(),
      paymentPerTickFormatted: formatMoney(payment),
      totalRepayment: (payment * BigInt(term)).toString(),
      totalRepaymentFormatted: formatMoney(asMoney(payment * BigInt(term))),
      /** ★ R16 uyarısı: taksit turluk gelirin ne kadarını götürüyor. */
      paymentBurden: burden,
      warning: burden !== null && burden > 0.4
        ? `Bu kredi turluk gelirinizin %${(burden * 100).toFixed(0)}'ini götürüyor`
        : null,
    };
  }

  /** Erken kapatma: kalan borç + bu turun faizi tek seferde ödenir. */
  async repay(userId: string, loanId: string) {
    const borrower = await this.borrower(userId);
    const [loan] = await this.sql<{
      id: bigint; remaining_balance: bigint; interest_rate: number;
    }[]>`SELECT id, remaining_balance, interest_rate FROM loans
         WHERE id = ${loanId}::bigint AND company_id = ${borrower.id}::uuid AND status = 'ACTIVE'`;
    if (!loan) throw new NotFound('Aktif kredi', loanId);

    const split = splitInstallment(
      asMoney(loan.remaining_balance),
      asMoney(loan.remaining_balance * 2n), // tamamını kapatacak kadar büyük
      loan.interest_rate,
    );
    if (borrower.cash < split.amount) {
      throw new InsufficientFunds({
        required: split.amount.toString(),
        requiredFormatted: formatMoney(split.amount),
        available: borrower.cash.toString(),
      });
    }

    const tickSeq = await currentTickSeq(this.sql);
    await runInTransaction(this.sql, async (tx) => {
      const [bank] = await tx<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_BANK'`;
      const [sink] = await tx<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;

      // Anapara SYS_BANK'a döner (parayı yok eder), faiz SYS_SINK'e (gider)
      await transfer(tx, {
        tickId: tickSeq, fromCompanyId: borrower.id, toCompanyId: bank!.id,
        amount: split.principalPart, account: 'LOAN_REPAYMENT',
        reason: 'kredi erken kapatma', refType: 'loan', refId: loanId,
      });
      if (split.interestPart > 0n) {
        await transfer(tx, {
          tickId: tickSeq, fromCompanyId: borrower.id, toCompanyId: sink!.id,
          amount: split.interestPart, account: 'INTEREST',
          reason: 'kredi faizi', refType: 'loan', refId: loanId,
        });
      }
      await tx`
        UPDATE loans SET remaining_balance = 0, status = 'PAID',
                         total_paid = total_paid + ${split.amount},
                         interest_paid = interest_paid + ${split.interestPart}
         WHERE id = ${loan.id}`;
    });

    return {
      loanId,
      paid: split.amount.toString(),
      paidFormatted: formatMoney(split.amount),
      interestPaid: split.interestPart.toString(),
      status: 'PAID',
    };
  }

  /* ------------------------------------------------------------------ */

  private async borrower(userId: string): Promise<Borrower> {
    const [row] = await this.sql<{
      id: string; name: string; level: number; cash: bigint; company_value: bigint;
      debt: bigint; facility_value: bigint; revenue: bigint;
    }[]>`
      SELECT c.id, c.name, c.level, c.cash, c.company_value,
             COALESCE(d.total, 0) AS debt,
             COALESCE(f.total, 0) AS facility_value,
             COALESCE(r.avg, 0) AS revenue
      FROM companies c
      LEFT JOIN LATERAL (
        SELECT SUM(remaining_balance)::bigint AS total FROM loans
        WHERE company_id = c.id AND status = 'ACTIVE'
      ) d ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(ft.base_cost)::bigint AS total FROM facilities fa
        JOIN facility_types ft ON ft.id = fa.facility_type_id
        WHERE fa.company_id = c.id AND fa.closed_at IS NULL
      ) f ON TRUE
      LEFT JOIN LATERAL (
        -- Son 24 turun ortalama cirosu — ödeme yükü uyarısının paydası (R16).
        -- ORDER BY + LIMIT agregattan ÖNCE uygulanmalı: alt sorgu şart.
        SELECT AVG(recent.revenue)::bigint AS avg FROM (
          SELECT revenue FROM company_financials
          WHERE company_id = c.id ORDER BY tick_id DESC LIMIT 24
        ) recent
      ) r ON TRUE
      WHERE c.user_id = ${userId}::uuid`;
    if (!row) throw new NotFound('Şirket');

    // Şirket değeri her turun sonunda yazılır; ilk turdan önce nakit + tesis
    // defter değeriyle tahmin edilir ki oyuncu boş ekran görmesin.
    const companyValue = row.company_value > 0n
      ? row.company_value
      : row.cash + row.facility_value - row.debt;

    return {
      id: row.id, name: row.name, level: row.level, cash: row.cash,
      companyValue: companyValue > 0n ? companyValue : 0n,
      debt: row.debt, revenuePerTick: row.revenue,
    };
  }

  private async terms(level: number) {
    const [row] = await this.sql<{
      leverage_ratio: number; interest_rate: number; max_term_ticks: number;
    }[]>`SELECT leverage_ratio, interest_rate, max_term_ticks FROM loan_terms
         WHERE level_min <= ${level} ORDER BY level_min DESC LIMIT 1`;
    if (!row) throw new NotFound('Kredi kademesi', String(level));
    return row;
  }

  /** Faiz enflasyona bağlıdır — para arzı şişerse borçlanma pahalılaşır (R15). */
  private async currentRate(baseRate: number): Promise<number> {
    const [fx] = await this.sql<{ game_cpi: number }[]>`
      SELECT game_cpi FROM fx_rates ORDER BY tick_id DESC LIMIT 1`;
    const [cfg] = await this.sql<{ value: { inflationK: number } }[]>`
      SELECT value FROM game_configs WHERE key = 'economy.loan' ORDER BY version DESC LIMIT 1`;
    return inflationAdjustedRate(baseRate, fx?.game_cpi ?? 1, cfg?.value.inflationK ?? 1);
  }
}
