/**
 * Para ve miktar gösterimi — ADR-0001.
 *
 * Kayan nokta HİÇBİR yerde para veya stok tutmaz.
 *   Para   : bigint, 1 ₺       = 10.000 birim (scale 4)
 *   Miktar : bigint, 1 birim   =  1.000 birim (scale 3)
 *
 * Katsayılar (hassasiyet, indeks, kalite) `number`'dır; para sınırına
 * BİR KEZ gelindiğinde `mulMoney` ile çarpılır ve yuvarlama artığı
 * (`residue`) çağırana geri verilir. Artık `ledger_entries.rounding_residue`
 * alanına yazılır; böylece `Σ cash` ile defter toplamı TAM olarak eşleşir (I1).
 */

declare const MoneyBrand: unique symbol;
declare const QtyBrand: unique symbol;

/** Para. 1 ₺ = 10_000. Asla `number`'a çevrilip geri dönülmez. */
export type Money = bigint & { readonly [MoneyBrand]: true };
/** Miktar (kg, L, adet, m). 1 birim = 1_000. */
export type Qty = bigint & { readonly [QtyBrand]: true };

export const MONEY_SCALE = 10_000n;
export const QTY_SCALE = 1_000n;

/** Katsayı çarpımlarında kullanılan sabit nokta ölçeği (9 ondalık basamak). */
const COEF_SCALE = 1_000_000_000n;

export const ZERO_MONEY = 0n as Money;
export const ZERO_QTY = 0n as Qty;

/* ------------------------------------------------------------------ */
/* Kurucular                                                           */
/* ------------------------------------------------------------------ */

/** `money(15.5)` → 15,50 ₺. Ondalık kaybı olursa hata fırlatır. */
export function money(lira: number | string): Money {
  return scaleDecimal(lira, MONEY_SCALE, 'money') as Money;
}

/** `qty(0.5)` → 0,5 kg (reçetelerdeki kesirli girdiler için). */
export function qty(units: number | string): Qty {
  return scaleDecimal(units, QTY_SCALE, 'qty') as Qty;
}

/**
 * HESAPLANMIŞ bir float'ı Money'e çevirir (bankacı yuvarlamasıyla).
 *
 * `money()` yazılmış/config değerleri içindir ve hassasiyet kaybında HATA verir;
 * bu ise formül çıktıları içindir ve yuvarlar. İkisini karıştırmayın: strict
 * kurucu, sessiz hassasiyet kaybını yakalayan güvenliktir.
 */
export function moneyFromNumber(lira: number): Money {
  if (!Number.isFinite(lira)) throw new RangeError('money: sonlu olmayan sayı');
  return roundScaled(lira, MONEY_SCALE) as Money;
}

/** HESAPLANMIŞ bir float'ı Qty'ye çevirir (talep, kapasite gibi formül çıktıları). */
export function qtyFromNumber(units: number): Qty {
  if (!Number.isFinite(units)) throw new RangeError('qty: sonlu olmayan sayı');
  if (units < 0) return 0n as Qty;
  return roundScaled(units, QTY_SCALE) as Qty;
}

function roundScaled(value: number, scale: bigint): bigint {
  const scaled = value * Number(scale);
  if (!Number.isSafeInteger(Math.round(scaled))) {
    // 2^53 üstü: sabit noktaya geç, hassasiyet kaybetme
    const whole = Math.trunc(value);
    const frac = value - whole;
    return BigInt(whole) * scale + divRoundHalfEven(BigInt(Math.round(frac * 1e9)) * scale, 1_000_000_000n);
  }
  return divRoundHalfEven(BigInt(Math.round(scaled * 1e6)), 1_000_000n);
}

/** Ham depolanmış değeri (DB'den gelen bigint) Money'e işaretler. */
export const asMoney = (raw: bigint): Money => raw as Money;
export const asQty = (raw: bigint): Qty => raw as Qty;

function scaleDecimal(input: number | string, scale: bigint, kind: string): bigint {
  const text = typeof input === 'number' ? formatNumber(input, kind) : input.trim();
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(text);
  if (!match) throw new RangeError(`${kind}: geçersiz sayı "${text}"`);
  const [, sign, whole, frac = ''] = match;
  const digits = String(scale).length - 1;
  if (frac.length > digits) {
    throw new RangeError(
      `${kind}: "${text}" ${digits} ondalık basamağa sığmıyor — sessiz hassasiyet kaybı engellendi`,
    );
  }
  const padded = frac.padEnd(digits, '0');
  const value = BigInt(whole!) * scale + BigInt(padded === '' ? '0' : padded);
  return sign === '-' ? -value : value;
}

function formatNumber(n: number, kind: string): string {
  if (!Number.isFinite(n)) throw new RangeError(`${kind}: sonlu olmayan sayı`);
  // toFixed(10) sonrası sondaki sıfırları at — 0.1+0.2 gibi ikili artıkları temizler
  return n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

/* ------------------------------------------------------------------ */
/* Aritmetik                                                           */
/* ------------------------------------------------------------------ */

export const addMoney = (a: Money, b: Money): Money => (a + b) as Money;
export const subMoney = (a: Money, b: Money): Money => (a - b) as Money;
export const negMoney = (a: Money): Money => -a as Money;
export const addQty = (a: Qty, b: Qty): Qty => (a + b) as Qty;
export const subQty = (a: Qty, b: Qty): Qty => (a - b) as Qty;

export function sumMoney(values: readonly Money[]): Money {
  let total = 0n;
  for (const v of values) total += v;
  return total as Money;
}

export interface Rounded<T> {
  /** Yuvarlanmış değer — deftere ve bakiyeye bu yazılır. */
  readonly value: T;
  /**
   * Atılan kesir, nano-birim cinsinden (1e-9 para birimi) ve işaretli.
   * `tam = value + residue / 1e9`. Toplamı sıfırdan farklıysa yuvarlama
   * sapması vardır ve I1 değişmezi bunu yakalar.
   */
  readonly residue: bigint;
}

/**
 * Para × katsayı. Tek yuvarlama noktası (ADR-0001 "sınır kuralı").
 * Bankacı yuvarlaması (yarımlar çifte) — sistematik yukarı sapmayı önler.
 */
export function mulMoney(amount: Money, factor: number): Rounded<Money> {
  const scaled = coefToFixed(factor);
  const product = amount * scaled;
  const value = divRoundHalfEven(product, COEF_SCALE);
  return { value: value as Money, residue: product - value * COEF_SCALE };
}

export function mulQty(amount: Qty, factor: number): Rounded<Qty> {
  const scaled = coefToFixed(factor);
  const product = amount * scaled;
  const value = divRoundHalfEven(product, COEF_SCALE);
  return { value: value as Qty, residue: product - value * COEF_SCALE };
}

/** Birim fiyat × miktar → tutar. Miktar ölçeği (1e3) burada düşer. */
export function priceTimesQty(unitPrice: Money, quantity: Qty): Rounded<Money> {
  const product = unitPrice * quantity;
  const value = divRoundHalfEven(product, QTY_SCALE);
  return { value: value as Money, residue: (product - value * QTY_SCALE) * (COEF_SCALE / QTY_SCALE) };
}

function coefToFixed(factor: number): bigint {
  if (!Number.isFinite(factor)) throw new RangeError('katsayı sonlu olmalı');
  const scaled = Math.round(factor * Number(COEF_SCALE));
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(`katsayı aralık dışı: ${factor} (|katsayı| < 9.007.199 olmalı)`);
  }
  return BigInt(scaled);
}

/** Yarımları çifte yuvarlayan tam sayı bölmesi. Negatiflerde de simetriktir. */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('bölen pozitif olmalı');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs * 2n;
  const twiceRemainder = r - q * denominator * 2n;
  let result: bigint;
  if (twiceRemainder > denominator) result = q + 1n;
  else if (twiceRemainder < denominator) result = q;
  else result = q % 2n === 0n ? q : q + 1n; // tam yarım → çift olana
  return negative ? -result : result;
}

/* ------------------------------------------------------------------ */
/* Gösterim — YALNIZ arayüz/log için. Geri dönüşü yoktur.              */
/* ------------------------------------------------------------------ */

export function formatMoney(amount: Money, opts: { symbol?: boolean } = {}): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / MONEY_SCALE;
  const frac = abs % MONEY_SCALE;
  const kurus = (frac / 100n).toString().padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const symbol = opts.symbol === false ? '' : ' ₺';
  return `${negative ? '-' : ''}${grouped},${kurus}${symbol}`;
}

export function formatQty(amount: Qty, unit = ''): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / QTY_SCALE;
  const frac = abs % QTY_SCALE;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const tail = frac === 0n ? '' : `,${frac.toString().padStart(3, '0').replace(/0+$/, '')}`;
  return `${negative ? '-' : ''}${grouped}${tail}${unit ? ' ' + unit : ''}`;
}

/** API sınırı: bigint JSON'a serialize edilemez → string olarak taşınır. */
export const moneyToJson = (amount: Money): string => amount.toString();
export const moneyFromJson = (raw: string): Money => BigInt(raw) as Money;
export const qtyToJson = (amount: Qty): string => amount.toString();
export const qtyFromJson = (raw: string): Qty => BigInt(raw) as Qty;

/**
 * `JSON.stringify` bigint'i serileştiremez. Para ve miktar her yerde bigint
 * olduğu için JSON sınırında bu replacer kullanılır: değerler string'e döner,
 * hassasiyet korunur.
 */
export const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/** bigint içerebilen herhangi bir değeri güvenle JSON'a çevirir. */
export const toJson = (value: unknown): string => JSON.stringify(value, bigintReplacer);
