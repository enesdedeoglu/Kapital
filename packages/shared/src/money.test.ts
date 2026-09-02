import { describe, expect, it } from 'vitest';
import {
  addMoney, asMoney, divRoundHalfEven, formatMoney, formatQty, money,
  moneyFromJson, moneyToJson, mulMoney, priceTimesQty, qty, sumMoney,
} from './money.js';

describe('kurucular', () => {
  it('lirayı 4 ondalıklı tam sayıya çevirir', () => {
    expect(money(1)).toBe(10_000n);
    expect(money(15.5)).toBe(155_000n);
    expect(money('0.0001')).toBe(1n);
    expect(money(-3.25)).toBe(-32_500n);
  });

  it('ikili kayan nokta artığını yutmaz', () => {
    expect(money(0.1 + 0.2)).toBe(money(0.3)); // 0.30000000000000004 → 0.3
  });

  it('ölçeğe sığmayan ondalıkta sessizce kaybetmez, hata verir', () => {
    expect(() => money('1.234567')).toThrow(/ondalık basamağa sığmıyor/);
    expect(() => qty('1.2345')).toThrow(/ondalık basamağa sığmıyor/);
  });

  it('miktar 3 ondalıklıdır — reçetedeki 0,5 kg = 500', () => {
    expect(qty(0.5)).toBe(500n);
    expect(qty(200)).toBe(200_000n);
  });
});

describe('divRoundHalfEven', () => {
  it('yarımları çifte yuvarlar', () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n); // 2.5 → 2 (çift)
    expect(divRoundHalfEven(7n, 2n)).toBe(4n); // 3.5 → 4 (çift)
    expect(divRoundHalfEven(-5n, 2n)).toBe(-2n);
    expect(divRoundHalfEven(-7n, 2n)).toBe(-4n);
  });

  it('yarım olmayanları normal yuvarlar', () => {
    expect(divRoundHalfEven(4n, 3n)).toBe(1n);
    expect(divRoundHalfEven(5n, 3n)).toBe(2n);
  });

  it('1000 yarım vakada sistematik sapma yaratmaz', () => {
    let sum = 0n;
    for (let i = 0; i < 1000; i++) sum += divRoundHalfEven(BigInt(2 * i + 1), 2n) * 2n - BigInt(2 * i + 1);
    expect(sum).toBe(0n); // yukarı ve aşağı yuvarlamalar birbirini götürür
  });
});

describe('mulMoney — tek yuvarlama noktası', () => {
  it('artığı geri verir ve tam değeri korur', () => {
    const base = money(100);
    const { value, residue } = mulMoney(base, 1 / 3);
    // tam = value + residue/1e9
    expect(value * 1_000_000_000n + residue).toBe(base * BigInt(Math.round((1 / 3) * 1e9)));
  });

  it('artıksız çarpımda residue sıfırdır', () => {
    const { value, residue } = mulMoney(money(10), 2);
    expect(value).toBe(money(20));
    expect(residue).toBe(0n);
  });

  it('büyük tutarlarda hassasiyet kaybetmez (2^53 üstü)', () => {
    const huge = asMoney(9_000_000_000_000_000_000n); // 900 trilyon ₺
    const { value } = mulMoney(huge, 0.5);
    expect(value).toBe(4_500_000_000_000_000_000n); // double olsaydı sapardı
  });

  it('aralık dışı katsayıyı reddeder', () => {
    expect(() => mulMoney(money(1), 1e10)).toThrow(/aralık dışı/);
    expect(() => mulMoney(money(1), Number.NaN)).toThrow(/sonlu/);
  });
});

describe('priceTimesQty', () => {
  it('miktar ölçeğini düşürür', () => {
    // 200 kg × 15 ₺/kg = 3.000 ₺
    expect(priceTimesQty(money(15), qty(200)).value).toBe(money(3000));
  });

  it('kesirli miktarda doğru çalışır', () => {
    // 0,5 kg × 80 ₺ = 40 ₺
    expect(priceTimesQty(money(80), qty(0.5)).value).toBe(money(40));
  });

  it('tam değeri artıkla birlikte korur', () => {
    const p = money(0.0003), q = qty(0.001);
    const { value, residue } = priceTimesQty(p, q);
    expect(value * 1_000_000_000n + residue).toBe(p * q * 1_000_000n);
  });
});

describe('toplama ve gösterim', () => {
  it('sumMoney tam toplar', () => {
    expect(sumMoney([money(1.1), money(2.2), money(3.3)])).toBe(money(6.6));
  });

  it('addMoney ilişkiseldir (float değil)', () => {
    const a = addMoney(addMoney(money(0.1), money(0.2)), money(0.3));
    const b = addMoney(money(0.1), addMoney(money(0.2), money(0.3)));
    expect(a).toBe(b);
  });

  it('formatMoney Türkçe biçimlendirir', () => {
    expect(formatMoney(money(30_000))).toBe('30.000,00 ₺');
    expect(formatMoney(money(1234.5))).toBe('1.234,50 ₺');
    expect(formatMoney(money(-42))).toBe('-42,00 ₺');
    expect(formatMoney(money(7), { symbol: false })).toBe('7,00');
  });

  it('formatQty birimle biçimlendirir', () => {
    expect(formatQty(qty(200), 'kg')).toBe('200 kg');
    expect(formatQty(qty(0.5), 'kg')).toBe('0,5 kg');
  });

  it('JSON sınırında string olarak taşınır', () => {
    const m = money(12_345.67);
    expect(moneyToJson(m)).toBe('123456700');
    expect(moneyFromJson(moneyToJson(m))).toBe(m);
  });
});
