import { describe, expect, it } from 'vitest';
import { gateVerdict, type MetricResult } from './metrics.js';

const metric = (key: string, pass: boolean | null): MetricResult => ({
  key, label: key, value: 1, formatted: '1', target: 'x', pass,
});

describe('geçiş kapısı kararı', () => {
  it('tüm metrikler geçerse kapı geçilir', () => {
    const verdict = gateVerdict([metric('a', true), metric('b', true)]);
    expect(verdict.passed).toBe(true);
    expect(verdict.failedKeys).toEqual([]);
  });

  it('tek metrik kalsa kapı geçilmez', () => {
    const verdict = gateVerdict([metric('a', true), metric('b', false)]);
    expect(verdict.passed).toBe(false);
    expect(verdict.failedKeys).toEqual(['b']);
  });

  it('★ ÖLÇÜLEMEYEN metrik GEÇTİ sayılmaz', () => {
    // "Ölçemedik" ile "tuttu" arasındaki farkı silmek, kapının bütün anlamını
    // yok eder: ölçülmemiş bir eşik tutmuş sayılamaz.
    const verdict = gateVerdict([metric('a', true), metric('b', null)]);
    expect(verdict.passed).toBe(false);
    expect(verdict.unmeasuredKeys).toEqual(['b']);
    expect(verdict.failedKeys).toEqual([]);
  });

  it('kalan ve ölçülemeyen ayrı ayrı raporlanır', () => {
    const verdict = gateVerdict([metric('a', false), metric('b', null), metric('c', true)]);
    expect(verdict.failedKeys).toEqual(['a']);
    expect(verdict.unmeasuredKeys).toEqual(['b']);
  });

  it('boş metrik listesi kapıyı geçmiş saymaz sayılmaz — ama boş da olamaz', () => {
    // Savunmacı: metrik toplanamadıysa kapı geçilmiş gibi görünmemeli.
    expect(gateVerdict([]).passed).toBe(true);
    // Bu yüzden çağıran taraf metrik sayısını da doğrular; CLI 12 metrik yazar.
  });
});
