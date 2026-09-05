import { describe, expect, it } from 'vitest';
import { capacityGaps, chainRequirements, type ChainRecipe } from './chain.js';

/** Tohumdaki ekmek zinciri: 4 buğday → 3 un · 1 un → 4 ekmek. */
const RECIPES: ChainRecipe[] = [
  { outputCode: 'BREAD', outputQuantity: 4, inputs: [{ code: 'FLOUR', quantity: 1 }] },
  { outputCode: 'FLOUR', outputQuantity: 3, inputs: [{ code: 'WHEAT', quantity: 4 }] },
  { outputCode: 'WHEAT', outputQuantity: 1, inputs: [] },
  { outputCode: 'TOMATO', outputQuantity: 1, inputs: [] },
  { outputCode: 'STEEL', outputQuantity: 2, inputs: [
    { code: 'COAL', quantity: 3 }, { code: 'IRON', quantity: 2 },
  ] },
  { outputCode: 'COAL', outputQuantity: 1, inputs: [] },
  { outputCode: 'IRON', outputQuantity: 1, inputs: [] },
  { outputCode: 'FURNITURE', outputQuantity: 1, inputs: [{ code: 'STEEL', quantity: 10 }] },
];

const find = (list: { productCode: string }[], code: string) =>
  list.find((r) => r.productCode === code)!;

describe('zincir kapasite gereksinimi', () => {
  it('★ talep zincirde geriye yayılır', () => {
    // 826 ekmek → 826/4 = 206,5 un → 206,5/3 × 4 = 275,3 buğday
    const req = chainRequirements(new Map([['BREAD', 826]]), RECIPES);
    expect(find(req, 'BREAD').units).toBeCloseTo(826, 6);
    expect(find(req, 'FLOUR').units).toBeCloseTo(206.5, 6);
    expect(find(req, 'WHEAT').units).toBeCloseTo(275.333, 2);
  });

  it('derinlik nihai üründen sayılır', () => {
    const req = chainRequirements(new Map([['BREAD', 100]]), RECIPES);
    expect(find(req, 'BREAD').depth).toBe(0);
    expect(find(req, 'FLOUR').depth).toBe(1);
    expect(find(req, 'WHEAT').depth).toBe(2);
  });

  it('çok girdili tarif bölünür', () => {
    // 1 mobilya → 10 çelik → 5 çevrim × (3 kömür + 2 demir) = 15 kömür, 10 demir
    const req = chainRequirements(new Map([['FURNITURE', 1]]), RECIPES);
    expect(find(req, 'STEEL').units).toBeCloseTo(10, 6);
    expect(find(req, 'COAL').units).toBeCloseTo(15, 6);
    expect(find(req, 'IRON').units).toBeCloseTo(10, 6);
  });

  it('★ aynı ürün birden çok yerde girdiyse gereksinimler TOPLANIR', () => {
    const req = chainRequirements(
      new Map([['FURNITURE', 1], ['STEEL', 10]]), RECIPES,
    );
    // 10 (mobilyadan) + 10 (doğrudan) = 20 çelik
    expect(find(req, 'STEEL').units).toBeCloseTo(20, 6);
  });

  it('talebi olmayan ürün listede yer almaz', () => {
    const req = chainRequirements(new Map([['TOMATO', 100]]), RECIPES);
    expect(req.find((r) => r.productCode === 'BREAD')).toBeUndefined();
  });

  it('girdisiz ürün zincirin sonudur', () => {
    const req = chainRequirements(new Map([['TOMATO', 517]]), RECIPES);
    expect(req).toHaveLength(1);
    expect(find(req, 'TOMATO').units).toBe(517);
  });

  it('boş talep boş sonuç verir', () => {
    expect(chainRequirements(new Map(), RECIPES)).toEqual([]);
    expect(chainRequirements(new Map([['BREAD', 0]]), RECIPES)).toEqual([]);
  });

  it('★ derinlik sınırı bozuk grafta sonsuz döngüyü engeller', () => {
    const cyclic: ChainRecipe[] = [
      { outputCode: 'A', outputQuantity: 1, inputs: [{ code: 'B', quantity: 1 }] },
      { outputCode: 'B', outputQuantity: 1, inputs: [{ code: 'A', quantity: 1 }] },
    ];
    // Döngü I8 ile ayrıca engellenir; burada yalnız donmadığını doğruluyoruz.
    const req = chainRequirements(new Map([['A', 1]]), cyclic, 5);
    expect(req.length).toBeGreaterThan(0);
  });
});

describe('kapasite açığı', () => {
  const req = chainRequirements(new Map([['BREAD', 826]]), RECIPES);

  it('★ ölçülen açığı yeniden üretir', () => {
    // F8'de ölçülen: fırın 120, değirmen 26, buğday tarlası 43 birim/tur
    const available = new Map([['BREAD', 120], ['FLOUR', 26], ['WHEAT', 43]]);
    const gaps = capacityGaps(req, available, 1);
    expect(find(gaps, 'BREAD').shortfall).toBeCloseTo(6.9, 1);
    expect(find(gaps, 'FLOUR').shortfall).toBeCloseTo(7.9, 1);
    expect(find(gaps, 'WHEAT').shortfall).toBeCloseTo(6.4, 1);
  });

  it('★ NPC payı hedefi düşürür — oyuncuya yatırım yeri kalmalı', () => {
    const available = new Map([['BREAD', 826]]);
    const tam = capacityGaps(req, available, 1);
    const paylı = capacityGaps(req, available, 0.7);
    expect(find(tam, 'BREAD').requiredPerTick).toBeCloseTo(826, 6);
    expect(find(paylı, 'BREAD').requiredPerTick).toBeCloseTo(578.2, 1);
    expect(find(paylı, 'BREAD').shortfall).toBeLessThan(1); // fazlasıyla yeterli
  });

  it('kapasite hiç yoksa açık sonsuzdur', () => {
    const gaps = capacityGaps(req, new Map(), 0.7);
    expect(find(gaps, 'BREAD').shortfall).toBe(Infinity);
  });
});
