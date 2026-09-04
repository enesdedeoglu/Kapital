import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@kapital/shared';
import { positiveEventWeight, WORLD_EVENTS } from './catalog.js';
import {
  eventMultipliersFor, rollWorldEvent, DEFAULT_EVENT_CONFIG, NEUTRAL_MULTIPLIERS,
  type ActiveEvent,
} from './generator.js';

const PRODUCTS = ['BREAD', 'TOMATO', 'CIGARETTE', 'TOBACCO', 'FURNITURE'];

const baseRoll = (rng: () => number, over: Partial<Parameters<typeof rollWorldEvent>[0]> = {}) =>
  rollWorldEvent({
    rng, activeCount: 0, lastEndedByCode: new Map(), tickSeq: 1000n,
    productCodes: PRODUCTS, cityCount: 5, ...over,
  });

describe('olay kataloğu', () => {
  it('kodlar benzersiz', () => {
    expect(new Set(WORLD_EVENTS.map((e) => e.code)).size).toBe(WORLD_EVENTS.length);
  });

  it('★ olayların yarısından fazlası OLUMLU — dünya yalnız cezalandırmaz', () => {
    // Yalnız felaket üreten bir dünya oyuncuya "ne yaparsan yap başına bir şey
    // gelir" der; amaç fırsat da yaratmaktır.
    expect(positiveEventWeight()).toBeGreaterThan(0.5);
  });

  it('süre aralıkları tutarlı ve makul', () => {
    for (const e of WORLD_EVENTS) {
      expect(e.maxTicks, e.code).toBeGreaterThanOrEqual(e.minTicks);
      expect(e.minTicks, e.code).toBeGreaterThan(0);
      expect(e.maxTicks, e.code).toBeLessThanOrEqual(96 * 7); // en fazla bir hafta
    }
  });

  it('çarpanlar ekonomiyi katlayarak kırmaz', () => {
    for (const e of WORLD_EVENTS) {
      for (const m of [e.demandMultiplier, e.supplyMultiplier, e.costMultiplier]) {
        expect(m, e.code).toBeGreaterThanOrEqual(0.1);
        expect(m, e.code).toBeLessThanOrEqual(5);
      }
    }
  });

  it('kapsamı SECTOR veya PRODUCT olan olayın hedefi tanımlı', () => {
    for (const e of WORLD_EVENTS) {
      if (e.scope === 'SECTOR') expect(e.category, e.code).toBeDefined();
    }
  });
});

describe('olay üretimi', () => {
  it('şans düşükken çoğu tur olaysız geçer', () => {
    let count = 0;
    for (let t = 0; t < 1000; t++) {
      if (baseRoll(mulberry32(t))) count++;
    }
    // chancePerTick 0,012 → binde ~12
    expect(count).toBeGreaterThan(3);
    expect(count).toBeLessThan(40);
  });

  /** Olay çıkaran ilk tohumu bulur — şans düşük olduğu için aranması gerekir. */
  const firingSeed = (() => {
    for (let t = 0; t < 5000; t++) if (baseRoll(mulberry32(t))) return t;
    throw new Error('olay çıkaran tohum bulunamadı');
  })();

  it('★ aynı tohum aynı olayı üretir — koşular tekrarlanabilir', () => {
    const a = baseRoll(mulberry32(firingSeed));
    const b = baseRoll(mulberry32(firingSeed));
    expect(a).not.toBeNull();
    expect(a?.template.code).toBe(b?.template.code);
    expect(a?.durationTicks).toBe(b?.durationTicks);
    expect(a?.productCode).toBe(b?.productCode);
  });

  it('★ zar her zaman atılır — dünya durumu RNG dizisini kaydırmamalı', () => {
    // Doluluk kontrolünü zardan ÖNCE yapsaydık, aktif olay sayısı RNG'nin
    // ilerleyişini değiştirir ve aynı tohum farklı dünyalar üretirdi.
    expect(baseRoll(mulberry32(firingSeed), { activeCount: 99 })).toBeNull();
    // Aynı tohum, boş dünyada olayını üretmeye devam eder.
    expect(baseRoll(mulberry32(firingSeed))).not.toBeNull();
  });

  it('eşzamanlı olay tavanı aşılmaz', () => {
    for (let t = 0; t < 200; t++) {
      expect(baseRoll(mulberry32(t), {
        activeCount: DEFAULT_EVENT_CONFIG.maxConcurrent,
      })).toBeNull();
    }
  });

  it('soğumadaki olay havuzdan çıkar', () => {
    // Tüm olayları soğumaya al: hiçbir şey çıkmamalı
    const cooling = new Map(WORLD_EVENTS.map((e) => [e.code, 999n]));
    for (let t = 0; t < 200; t++) {
      expect(baseRoll(mulberry32(t), { lastEndedByCode: cooling, tickSeq: 1000n })).toBeNull();
    }
  });

  it('soğuma penceresi dolunca olay geri döner', () => {
    const old = new Map(WORLD_EVENTS.map((e) => [e.code, 100n]));
    let found = false;
    for (let t = 0; t < 500 && !found; t++) {
      if (baseRoll(mulberry32(t), { lastEndedByCode: old, tickSeq: 1000n })) found = true;
    }
    expect(found).toBe(true);
  });

  it('süre kendi aralığında kalır', () => {
    for (let t = 0; t < 500; t++) {
      const rolled = baseRoll(mulberry32(t));
      if (!rolled) continue;
      expect(rolled.durationTicks).toBeGreaterThanOrEqual(rolled.template.minTicks);
      expect(rolled.durationTicks).toBeLessThanOrEqual(rolled.template.maxTicks);
    }
  });

  it('ürün kapsamlı olay yalnız uygun ürünlerden seçer', () => {
    for (let t = 0; t < 800; t++) {
      const rolled = baseRoll(mulberry32(t));
      if (rolled?.template.scope !== 'PRODUCT') continue;
      expect(rolled.template.productCodes).toContain(rolled.productCode);
    }
  });

  it('ürünü olmayan dünyada ürün kapsamlı olay çıkmaz', () => {
    for (let t = 0; t < 300; t++) {
      const rolled = baseRoll(mulberry32(t), { productCodes: [] });
      if (rolled) expect(rolled.template.scope).not.toBe('PRODUCT');
    }
  });
});

describe('etkilerin çözülmesi', () => {
  const global: ActiveEvent = {
    scope: 'GLOBAL', productId: null, cityId: null, category: null,
    demandMultiplier: 1.5, supplyMultiplier: 1, costMultiplier: 1,
  };
  const drought: ActiveEvent = {
    scope: 'SECTOR', productId: null, cityId: null, category: 'AGRICULTURE',
    demandMultiplier: 1, supplyMultiplier: 0.55, costMultiplier: 1.15,
  };
  const cigarette: ActiveEvent = {
    scope: 'PRODUCT', productId: 6, cityId: null, category: null,
    demandMultiplier: 0.5, supplyMultiplier: 1, costMultiplier: 1,
  };
  const city: ActiveEvent = {
    scope: 'CITY', productId: null, cityId: 3, category: null,
    demandMultiplier: 1.35, supplyMultiplier: 0.9, costMultiplier: 1,
  };

  it('olay yoksa çarpanlar nötrdür', () => {
    expect(eventMultipliersFor([], { productId: 1 })).toEqual(NEUTRAL_MULTIPLIERS);
  });

  it('küresel olay her hedefe uygulanır', () => {
    expect(eventMultipliersFor([global], { productId: 1 }).demand).toBe(1.5);
    expect(eventMultipliersFor([global], { cityId: 9 }).demand).toBe(1.5);
  });

  it('sektör olayı yalnız o kategoriye', () => {
    expect(eventMultipliersFor([drought], { category: 'AGRICULTURE' }).supply).toBe(0.55);
    expect(eventMultipliersFor([drought], { category: 'MINING' }).supply).toBe(1);
  });

  it('ürün olayı yalnız o ürüne', () => {
    expect(eventMultipliersFor([cigarette], { productId: 6 }).demand).toBe(0.5);
    expect(eventMultipliersFor([cigarette], { productId: 3 }).demand).toBe(1);
  });

  it('şehir olayı yalnız o şehre', () => {
    expect(eventMultipliersFor([city], { cityId: 3 }).demand).toBe(1.35);
    expect(eventMultipliersFor([city], { cityId: 4 }).demand).toBe(1);
  });

  it('★ olaylar ÇARPILARAK birikir, toplanarak değil', () => {
    // Toplasaydık iki olumsuz olay birbirini kısmen götürürdü.
    const both = eventMultipliersFor([drought, global], {
      category: 'AGRICULTURE', productId: 1,
    });
    expect(both.supply).toBeCloseTo(0.55, 6);
    expect(both.demand).toBeCloseTo(1.5, 6);
    expect(both.cost).toBeCloseTo(1.15, 6);
  });

  it('aynı kapsamdaki iki olay üst üste biner', () => {
    const ikinci: ActiveEvent = { ...drought, supplyMultiplier: 0.8, costMultiplier: 1 };
    const sonuc = eventMultipliersFor([drought, ikinci], { category: 'AGRICULTURE' });
    expect(sonuc.supply).toBeCloseTo(0.55 * 0.8, 6);
  });
});
