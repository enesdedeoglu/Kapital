import { describe, expect, it } from 'vitest';
import { aggregateGate, type SeedRun } from './gate.js';
import type { MetricResult } from './metrics.js';

const metric = (
  key: string, value: number | null, pass: boolean | null,
): MetricResult => ({
  key, label: key, value, formatted: String(value), target: 'x', pass,
});

const run = (seed: number, ...metrics: MetricResult[]): SeedRun => ({ seed, metrics });

describe('çok tohumlu kapı (R39)', () => {
  it('tüm tohumlarda geçen metrik geçer', () => {
    const report = aggregateGate([
      run(1, metric('a', 0.5, true)),
      run(2, metric('a', 0.6, true)),
      run(3, metric('a', 0.55, true)),
    ]);
    expect(report.metrics[0]!.pass).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('★ çoğunlukta kalan metrik geçmez — medyan tutsa bile', () => {
    // 2/5 geçiyor: medyan örneği geçse bile dünya güvenilir değil.
    const report = aggregateGate([
      run(1, metric('a', 0.10, false)),
      run(2, metric('a', 0.12, false)),
      run(3, metric('a', 0.50, true)),
      run(4, metric('a', 0.14, false)),
      run(5, metric('a', 0.55, true)),
    ]);
    expect(report.metrics[0]!.passCount).toBe(2);
    expect(report.metrics[0]!.pass).toBe(false);
  });

  it('★ çoğunluk geçse de MEDYAN bandın dışındaysa geçmez', () => {
    // 3/5 geçiyor ama geçenler uçlarda; medyan örnek kalıyor.
    const report = aggregateGate([
      run(1, metric('a', 0.01, true)),
      run(2, metric('a', 0.02, true)),
      run(3, metric('a', 0.50, false)),
      run(4, metric('a', 0.99, true)),
      run(5, metric('a', 0.98, true)),
    ]);
    expect(report.metrics[0]!.median).toBe(0.5);
    expect(report.metrics[0]!.pass).toBe(false);
  });

  it('★ ölçülemeyen metrik geçmiş sayılmaz', () => {
    const report = aggregateGate([
      run(1, metric('a', null, null)),
      run(2, metric('a', null, null)),
    ]);
    expect(report.metrics[0]!.pass).toBeNull();
    expect(report.unmeasuredKeys).toEqual(['a']);
    expect(report.passed).toBe(false);
  });

  it('medyan, en küçük ve en büyük değer raporlanır', () => {
    const report = aggregateGate([
      run(1, metric('a', 0.2, true)),
      run(2, metric('a', 0.6, true)),
      run(3, metric('a', 0.4, true)),
    ]);
    const m = report.metrics[0]!;
    expect(m.median).toBeCloseTo(0.4, 6);
    expect(m.min).toBeCloseTo(0.2, 6);
    expect(m.max).toBeCloseTo(0.6, 6);
  });

  it('çift sayıda tohumda medyan iki ortancanın ortalamasıdır', () => {
    const report = aggregateGate([
      run(1, metric('a', 0.2, true)),
      run(2, metric('a', 0.4, true)),
      run(3, metric('a', 0.6, true)),
      run(4, metric('a', 0.8, true)),
    ]);
    expect(report.metrics[0]!.median).toBeCloseTo(0.5, 6);
  });

  it('★ tohumlar KARARDA anlaşmazsa metrik kararsız işaretlenir', () => {
    const report = aggregateGate([
      run(1, metric('a', 0.50, true)),
      run(2, metric('a', 0.52, true)),
      run(3, metric('a', 0.10, false)),
    ]);
    expect(report.metrics[0]!.unstable).toBe(true);
    expect(report.unstableKeys).toContain('a');
  });

  it('hepsi geçen metrik kararsız değildir — sayısal yayılma büyük olsa bile', () => {
    // ★ Yayılmaya bakmak yanıltıcı: medyan sıfıra yakınken oran patlar.
    // Para arzı medyanı %0,1, aralığı %−1,3…%1,4 idi — mutlak olarak minicik,
    // orana göre 27 kat. Hepsi geçtiyse metrik kararlıdır.
    const report = aggregateGate([
      run(1, metric('a', 0.10, true)),
      run(2, metric('a', 0.50, true)),
      run(3, metric('a', 0.95, true)),
    ]);
    expect(report.metrics[0]!.pass).toBe(true);
    expect(report.unstableKeys).toEqual([]);
  });

  it('hepsi kalan metrik de kararsız değildir — tutarlı biçimde kötüdür', () => {
    const report = aggregateGate([
      run(1, metric('a', 0.10, false)),
      run(2, metric('a', 0.12, false)),
    ]);
    expect(report.metrics[0]!.unstable).toBe(false);
    expect(report.metrics[0]!.pass).toBe(false);
  });

  it('medyanın kendi biçimlendirmesi korunur — birimler farklı', () => {
    const ms: MetricResult = {
      key: 'tick', label: 'tur', value: 2500, formatted: '2.50 sn', target: '< 60 sn', pass: true,
    };
    const report = aggregateGate([run(1, ms), run(2, ms)]);
    expect(report.metrics[0]!.medianFormatted).toBe('2.50 sn');
  });

  it('tek metrik kalırsa kapı geçilmez', () => {
    const report = aggregateGate([
      run(1, metric('a', 0.5, true), metric('b', 0.1, false)),
      run(2, metric('a', 0.5, true), metric('b', 0.1, false)),
    ]);
    expect(report.passed).toBe(false);
    expect(report.failedKeys).toEqual(['b']);
  });

  it('koşu yoksa kapı geçilmez', () => {
    expect(aggregateGate([]).passed).toBe(false);
  });

  it('çoğunluk eşiği ayarlanabilir', () => {
    const runs = [
      run(1, metric('a', 0.5, true)),
      run(2, metric('a', 0.5, true)),
      run(3, metric('a', 0.5, false)),
    ];
    expect(aggregateGate(runs, { majority: 0.6 }).metrics[0]!.pass).toBe(true);
    expect(aggregateGate(runs, { majority: 0.9 }).metrics[0]!.pass).toBe(false);
  });

  it('koşulan tohumlar raporda görünür', () => {
    const report = aggregateGate([run(11, metric('a', 1, true)), run(22, metric('a', 1, true))]);
    expect(report.seeds).toEqual([11, 22]);
  });
});
