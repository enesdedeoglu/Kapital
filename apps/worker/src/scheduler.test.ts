import { describe, expect, it } from 'vitest';
import { planCatchUp } from './scheduler.js';

// Sabit referans: `Date.now()` ile kayma, floor() sınırında testi kırar.
const now = new Date('2026-09-03T12:00:00Z');
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);

describe('catch-up politikası (docs/05 §5)', () => {
  it('ilk turda normal koşar', () => {
    expect(planCatchUp(null, now)).toEqual({ due: 1, mode: 'normal' });
  });

  it('zamanı gelmemişse boşta bekler', () => {
    expect(planCatchUp(at(5), now).mode).toBe('idle');
  });

  it('4 tura kadar normal koşar', () => {
    expect(planCatchUp(at(60), now)).toEqual({ due: 4, mode: 'normal' });
  });

  it('5–24 tur arası hızlandırılmış moda geçer', () => {
    const plan = planCatchUp(at(120), now); // 8 tur
    expect(plan.due).toBe(8);
    expect(plan.mode).toBe('catch-up');
  });

  it('24 turdan fazlası operatör onayı ister', () => {
    const plan = planCatchUp(at(60 * 24), now); // 96 tur
    expect(plan.mode).toBe('operator-required');
    expect(plan.due).toBe(96);
  });

  it('eşikler yapılandırılabilir', () => {
    expect(planCatchUp(at(60), now, { catchUpThreshold: 2 }).mode).toBe('catch-up');
    expect(planCatchUp(at(60), now, { catchUpThreshold: 2, catchUpLimit: 3 }).mode)
      .toBe('operator-required');
  });
});
