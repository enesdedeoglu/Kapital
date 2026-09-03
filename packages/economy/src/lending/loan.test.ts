import { describe, expect, it } from 'vitest';
import { money } from '@kapital/shared';
import {
  annuityPayment, inflationAdjustedRate, liquidationValue, maxLoanAmount,
  paymentBurden, splitInstallment,
} from './loan.js';

describe('kredi limiti (R15 birinci katman)', () => {
  it('şirket değerine bağlıdır, keyfi değildir', () => {
    expect(maxLoanAmount(money(100_000), money(0), 0.4)).toBe(money(40_000));
  });

  it('mevcut borç limitten düşülür', () => {
    expect(maxLoanAmount(money(100_000), money(30_000), 0.4)).toBe(money(10_000));
  });

  it('limit aşılmışsa sıfır döner, negatif olmaz', () => {
    expect(maxLoanAmount(money(100_000), money(80_000), 0.4)).toBe(0n);
  });

  it('yüksek seviye daha çok kaldıraç verir', () => {
    const low = maxLoanAmount(money(1_000_000), money(0), 0.40);  // Lv1–5
    const high = maxLoanAmount(money(1_000_000), money(0), 0.75); // Lv13+
    expect(high).toBe(low * 75n / 40n);
  });
});

describe('enflasyona bağlı faiz (R15 üçüncü katman)', () => {
  it('enflasyon yoksa taban faiz geçerlidir', () => {
    expect(inflationAdjustedRate(0.00025, 1)).toBeCloseTo(0.00025, 10);
  });

  it('★ enflasyon artınca borçlanma pahalılaşır', () => {
    const normal = inflationAdjustedRate(0.00025, 1);
    const inflated = inflationAdjustedRate(0.00025, 1.5);
    expect(inflated).toBeCloseTo(normal * 1.5, 10);
  });

  it('deflasyonda faiz düşer ama negatife inmez', () => {
    expect(inflationAdjustedRate(0.00025, 0.5)).toBeCloseTo(0.000125, 10);
    expect(inflationAdjustedRate(0.00025, 0.01)).toBeGreaterThanOrEqual(0);
  });
});

describe('anüite taksiti', () => {
  it('faizsiz kredi anaparayı eşit böler', () => {
    expect(annuityPayment(money(1000), 0, 100)).toBe(money(10));
  });

  it('faizli kredide taksit anapara/vadeden büyüktür', () => {
    const payment = annuityPayment(money(100_000), 0.00025, 2688);
    expect(payment).toBeGreaterThan(money(100_000) / 2688n);
  });

  it('bir oyun yılı vadeli kredide toplam ödeme ~%37 fazla', () => {
    const principal = money(100_000);
    const payment = annuityPayment(principal, 0.00025, 2688);
    const total = payment * 2688n;
    expect(Number(total) / Number(principal)).toBeGreaterThan(1.3);
    expect(Number(total) / Number(principal)).toBeLessThan(1.45);
  });
});

describe('taksit ayrıştırma', () => {
  it('★ faiz ve anapara AYRI hesaplanır — farklı yerlere gider', () => {
    const balance = money(100_000);
    const payment = money(1_000);
    const split = splitInstallment(balance, payment, 0.001);

    // faiz = 100.000 × 0,001 = 100 ₺ → SYS_SINK (ekonomiden çıkar)
    expect(split.interestPart).toBe(money(100));
    // anapara = 1.000 − 100 = 900 ₺ → SYS_BANK (yaratılan parayı yok eder)
    expect(split.principalPart).toBe(money(900));
    expect(split.balanceAfter).toBe(money(99_100));
    expect(split.settles).toBe(false);
  });

  it('son taksitte kalan borcun tamamı istenir — kuruş sürüklenmez', () => {
    const split = splitInstallment(money(50), money(1000), 0.001);
    expect(split.settles).toBe(true);
    expect(split.balanceAfter).toBe(0n);
    expect(split.amount).toBe(money(50) + split.interestPart);
  });

  it('taksit faizi karşılamıyorsa anapara azalmaz', () => {
    const split = splitInstallment(money(100_000), money(50), 0.001);
    expect(split.principalPart).toBe(0n);
    expect(split.interestPart).toBe(money(50));
    expect(split.balanceAfter).toBe(money(100_000)); // borç erimiyor
  });

  it('borç bittiyse taksit sıfırdır', () => {
    const split = splitInstallment(money(0), money(1000), 0.001);
    expect(split.amount).toBe(0n);
    expect(split.settles).toBe(true);
  });

  it('anapara + faiz her zaman taksite eşittir', () => {
    for (const balance of [1000, 50_000, 999_999]) {
      const s = splitInstallment(money(balance), money(700), 0.0005);
      expect(s.principalPart + s.interestPart).toBe(s.amount);
    }
  });
});

describe('tasfiye ve yük uyarısı (R16)', () => {
  it('tesis defter değerinin bir oranıyla tasfiye edilir', () => {
    expect(liquidationValue(money(25_000), 0.5)).toBe(money(12_500));
  });

  it('★ taksidin gelire oranı önden gösterilir', () => {
    expect(paymentBurden(money(400), money(1000))).toBeCloseTo(0.4, 6);
    expect(paymentBurden(money(400), money(0))).toBeNull(); // geliri yok
  });
});
