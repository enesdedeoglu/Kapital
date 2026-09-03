import { asMoney, divRoundHalfEven, mulMoney, type Money } from '@kapital/shared';

export interface LoanTerms {
  /** `company_value × bu` − mevcut borç = üst limit. */
  readonly leverageRatio: number;
  /** Tur başına taban faiz. */
  readonly interestRate: number;
  readonly maxTermTicks: number;
  readonly defaultAfterMissed: number;
}

/**
 * Kredi üst limiti — R15 azaltımının birinci katmanı.
 *
 * Limit KEYFİ DEĞİL, şirket değerine bağlıdır. Şirket değerindeki stok
 * likidite iskontosuyla değerlendiği için (C3) oyuncu teminatını piyasayı
 * stoklayarak şişiremez.
 */
export function maxLoanAmount(
  companyValue: Money, existingDebt: Money, leverageRatio: number,
): Money {
  const ceiling = mulMoney(companyValue, Math.max(0, leverageRatio)).value as bigint;
  const available = ceiling - (existingDebt as bigint);
  return asMoney(available > 0n ? available : 0n);
}

/**
 * Enflasyona bağlı faiz — R15 azaltımının üçüncü katmanı.
 *
 * `faiz = taban × (1 + k × (cpi − 1))`
 *
 * Para arzı şişerse borçlanma pahalılaşır; merkez bankası refleksinin tek
 * satırlık karşılığı. Bu olmadan enflasyon ortamında kredi çekmek bedava
 * paraya dönüşür.
 */
export function inflationAdjustedRate(baseRate: number, gameCpi: number, k = 1): number {
  const adjusted = baseRate * (1 + k * (Math.max(0.01, gameCpi) - 1));
  return Math.max(0, adjusted);
}

/**
 * Anüite taksiti: eşit ödemelerle anapara + faiz.
 *
 *   taksit = P × r / (1 − (1+r)^−n)
 */
export function annuityPayment(principal: Money, ratePerTick: number, termTicks: number): Money {
  if (termTicks <= 0) throw new RangeError('vade pozitif olmalı');
  if (ratePerTick <= 0) return asMoney(divRoundHalfEven(principal as bigint, BigInt(termTicks)));

  const factor = ratePerTick / (1 - Math.pow(1 + ratePerTick, -termTicks));
  const payment = mulMoney(principal, factor).value as bigint;
  // Taksit en az 1 birim olmalı ki bakiye sonsuza kadar sürüklenmesin
  return asMoney(payment > 0n ? payment : 1n);
}

export interface Installment {
  /** Bu turda tahsil edilecek toplam. */
  readonly amount: Money;
  /** Faize giden kısım — `SYS_SINK`'e (kalıcı gider). */
  readonly interestPart: Money;
  /** Anaparaya giden kısım — `SYS_BANK`'a (parayı yok eder). */
  readonly principalPart: Money;
  readonly balanceAfter: Money;
  /** Son taksit mi? */
  readonly settles: boolean;
}

/**
 * Bir turluk taksidi anapara ve faiz olarak ayırır.
 *
 * Ayrım kritiktir: faiz ekonomiden ÇIKAR (`SYS_SINK`), anapara ise kredinin
 * yarattığı parayı GERİ ALIR (`SYS_BANK`). İkisi aynı hesaba yazılsaydı
 * para arzı ölçümü bozulurdu.
 */
export function splitInstallment(
  balance: Money, paymentPerTick: Money, ratePerTick: number,
): Installment {
  const outstanding = balance as bigint;
  if (outstanding <= 0n) {
    return {
      amount: asMoney(0n), interestPart: asMoney(0n), principalPart: asMoney(0n),
      balanceAfter: asMoney(0n), settles: true,
    };
  }

  const interest = mulMoney(balance, Math.max(0, ratePerTick)).value as bigint;
  const due = outstanding + interest;
  // Son taksitte kalan borcun tamamı istenir; kuruş artığı sürüklenmez.
  const amount = (paymentPerTick as bigint) >= due ? due : (paymentPerTick as bigint);
  const principalPart = amount > interest ? amount - interest : 0n;
  const interestPart = amount > interest ? interest : amount;
  const balanceAfter = outstanding - principalPart;

  return {
    amount: asMoney(amount),
    interestPart: asMoney(interestPart),
    principalPart: asMoney(principalPart),
    balanceAfter: asMoney(balanceAfter > 0n ? balanceAfter : 0n),
    settles: balanceAfter <= 0n,
  };
}

/** Tesis tasfiye değeri: defter değerinin bir oranı (zorunlu satış iskontosu). */
export function liquidationValue(bookValue: Money, rate: number): Money {
  return mulMoney(bookValue, Math.max(0, Math.min(1, rate))).value;
}

/**
 * Taksidin tur gelirine oranı — R16 azaltımı.
 *
 * Kredi ekranında ÖNDEN gösterilir: "bu kredi turluk gelirinizin %40'ını
 * götürür". Yeni oyuncunun farkında olmadan batmasını engelleyen uyarı.
 */
export function paymentBurden(paymentPerTick: Money, recentRevenuePerTick: Money): number | null {
  if ((recentRevenuePerTick as bigint) <= 0n) return null;
  return Number(paymentPerTick) / Number(recentRevenuePerTick);
}
