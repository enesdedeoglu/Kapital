import { describe, expect, it } from 'vitest';
import { money, mulberry32 } from '@kapital/shared';
import { cityBonusFor, productionCapacity, upgradeCost } from './capacity.js';
import { validateProductGraph, type GraphProduct, type GraphRecipe } from './graph.js';
import { outputQuality, rawInputQuality } from './quality.js';

describe('kapasite', () => {
  const base = {
    baseCapacity: 30, levelMultiplier: 1, condition: 100, cityBonus: 1, technologyBonus: 0,
  };

  it('seviye çarpanıyla ölçeklenir (madde 12)', () => {
    expect(productionCapacity(base)).toBe(30);
    expect(productionCapacity({ ...base, levelMultiplier: 1.4 })).toBeCloseTo(42);   // Lv2
    expect(productionCapacity({ ...base, levelMultiplier: 11.5 })).toBeCloseTo(345); // Lv10
  });

  it('yıpranmış tesis daha az üretir', () => {
    expect(productionCapacity({ ...base, condition: 50 })).toBe(15);
    expect(productionCapacity({ ...base, condition: 0 })).toBe(0);
  });

  it('şehir bonusu sektöre göre seçilir', () => {
    const city = { agricultureBonus: 1.2, industrialBonus: 0.95 };
    expect(cityBonusFor('AGRICULTURE', city)).toBe(1.2);
    expect(cityBonusFor('MINING', city)).toBe(0.95);
    expect(cityBonusFor('INDUSTRY', city)).toBe(0.95);
    expect(cityBonusFor('RETAIL', city)).toBe(1);
  });

  it('Konya tarımda, Bursa sanayide avantajlı', () => {
    const konya = productionCapacity({ ...base, cityBonus: 1.2 });
    const istanbul = productionCapacity({ ...base, cityBonus: 0.85 });
    expect(konya).toBeGreaterThan(istanbul);
  });

  it('yükseltme maliyeti seviyeyle üstel artar', () => {
    const cost2 = upgradeCost(money(8_000), 2, 0.75, 1.55);
    const cost5 = upgradeCost(money(8_000), 5, 0.75, 1.55);
    expect(cost2).toBeGreaterThan(0n);
    expect(cost5).toBeGreaterThan(cost2 * 3n); // 5^1.55 / 2^1.55 ≈ 3,7
  });
});

describe('üretim kalitesi (madde 14)', () => {
  const rng = () => 0.5; // sapma sıfır

  it('girdi kalitesinin %70\'i taşınır', () => {
    const q = outputQuality({
      inputQuality: 100, technologyBonus: 0, staffScore: 0.5, condition: 100, rng,
    });
    // 100×0,70 + 0 + 50×0,10 + 100×0,05 = 80
    expect(q).toBeCloseTo(80, 6);
  });

  it('teknoloji ve personel kaliteyi yükseltir', () => {
    const plain = outputQuality({ inputQuality: 80, technologyBonus: 0, staffScore: 0.5, condition: 100, rng });
    const good = outputQuality({ inputQuality: 80, technologyBonus: 1, staffScore: 1, condition: 100, rng });
    expect(good).toBeGreaterThan(plain);
    expect(good - plain).toBeCloseTo(15 + 5, 6); // tech +15, personel +5
  });

  it('yıpranmış tesis kaliteyi düşürür', () => {
    const good = outputQuality({ inputQuality: 80, technologyBonus: 0, staffScore: 0.5, condition: 100, rng });
    const worn = outputQuality({ inputQuality: 80, technologyBonus: 0, staffScore: 0.5, condition: 20, rng });
    expect(good - worn).toBeCloseTo(4, 6); // (100−20)×0,05
  });

  it('sapma dar ve deterministiktir', () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 40; i++) {
      const qa = outputQuality({ inputQuality: 80, technologyBonus: 0, staffScore: 0.5, condition: 100, rng: a });
      const qb = outputQuality({ inputQuality: 80, technologyBonus: 0, staffScore: 0.5, condition: 100, rng: b });
      expect(qa).toBe(qb);                 // aynı tohum → aynı sonuç
      expect(Math.abs(qa - 66)).toBeLessThanOrEqual(1.5); // taban 66 ± 1,5
    }
  });

  it('0–100 aralığında kalır', () => {
    expect(outputQuality({ inputQuality: 0, technologyBonus: 0, staffScore: 0, condition: 0, rng: () => 0 }))
      .toBeGreaterThanOrEqual(0);
    expect(outputQuality({ inputQuality: 100, technologyBonus: 1, staffScore: 1, condition: 100, rng: () => 1 }))
      .toBeLessThanOrEqual(100);
  });

  it('hammadde kalitesi şehir bonusuyla ölçeklenir', () => {
    expect(rawInputQuality(70, 1.2)).toBe(84);   // Konya tarım
    expect(rawInputQuality(70, 0.85)).toBe(59.5); // İstanbul tarım
    expect(rawInputQuality(70, 2)).toBe(100);     // tavan
  });
});

describe('ürün grafı (I8, R13)', () => {
  const products: GraphProduct[] = [
    { id: 1, code: 'WHEAT', unlockLevel: 5, isRawMaterial: true, isRetailProduct: false },
    { id: 2, code: 'FLOUR', unlockLevel: 6, isRawMaterial: false, isRetailProduct: false },
    { id: 3, code: 'BREAD', unlockLevel: 6, isRawMaterial: false, isRetailProduct: true },
  ];
  const recipes: GraphRecipe[] = [
    { recipeId: 1, facilityTypeCode: 'WHEAT_FIELD', outputProductId: 1, unlockLevel: 5, inputProductIds: [] },
    { recipeId: 2, facilityTypeCode: 'MILL', outputProductId: 2, unlockLevel: 6, inputProductIds: [1] },
    { recipeId: 3, facilityTypeCode: 'BAKERY', outputProductId: 3, unlockLevel: 6, inputProductIds: [2] },
  ];

  it('sağlıklı zinciri kabul eder ve sıralar', () => {
    const report = validateProductGraph(recipes, products);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.topologicalOrder).toEqual([1, 2, 3]); // buğday → un → ekmek
  });

  it('★ döngüyü yakalar (Çelik → Motor → Çelik)', () => {
    const cyclic: GraphProduct[] = [
      { id: 9, code: 'STEEL', unlockLevel: 15, isRawMaterial: false, isRetailProduct: false },
      { id: 20, code: 'ENGINE', unlockLevel: 24, isRawMaterial: false, isRetailProduct: false },
    ];
    const bad: GraphRecipe[] = [
      { recipeId: 1, facilityTypeCode: 'STEEL_MILL', outputProductId: 9, unlockLevel: 15, inputProductIds: [20] },
      { recipeId: 2, facilityTypeCode: 'ENGINE_PLANT', outputProductId: 20, unlockLevel: 24, inputProductIds: [9] },
    ];
    const report = validateProductGraph(bad, cyclic);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === 'CYCLE')).toBe(true);
  });

  it('girdisi daha geç açılan reçeteyi yakalar', () => {
    const bad = [...recipes];
    bad[1] = { ...bad[1]!, unlockLevel: 3 }; // Un Lv3'te ama Buğday Lv5'te
    const report = validateProductGraph(bad, products);
    expect(report.issues.some((i) => i.kind === 'UNLOCK_ORDER')).toBe(true);
  });

  it('üretilemeyen ve hammadde olmayan ürünü yakalar', () => {
    const orphan: GraphProduct[] = [
      ...products,
      { id: 10, code: 'FURNITURE', unlockLevel: 12, isRawMaterial: false, isRetailProduct: true },
    ];
    const report = validateProductGraph(recipes, orphan);
    expect(report.issues.some((i) => i.kind === 'UNREACHABLE')).toBe(true);
  });
});
