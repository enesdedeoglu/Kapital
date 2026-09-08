import { describe, expect, it } from 'vitest';
import { money, mulberry32, qty, type Money } from '@kapital/shared';
import type { CategoryWeights, ProductDemandParams, RetailOffer } from '../types.js';
import { affordableUnits, allocateRetail } from './allocation.js';
import { reservationCeiling, scoreOffer } from './attractiveness.js';
import { demandNoise, dailyRhythm, economicCycle, seasonMultiplier } from './cycle.js';
import { decayBatch, expiryTick } from './decay.js';
import { cityDemand, worldDemandScale,
} from './demand.js';

const TOMATO: ProductDemandParams = {
  productId: 4,
  baseDemand: 25,
  referencePrice: money(15),
  reservationPriceMult: 3,
  priceSensitivity: 1.5,
};

const ISTANBUL = { cityId: 1, populationIndex: 1.6, incomeIndex: 1.2, consumerDemandIndex: 1 };
const KONYA = { cityId: 4, populationIndex: 0.65, incomeIndex: 0.9, consumerDemandIndex: 1 };

const FLAT = {
  economicCycle: 1, seasonMultiplier: 1, eventMultiplier: 1, noise: 1, budgetSlack: 1.15,
};

const PRODUCE: CategoryWeights = { priceWeight: 1.4, qualityWeight: 1.1, brandWeight: 0.3 };

const offer = (o: Partial<RetailOffer> & { facilityId: string; sellingPrice: Money }): RetailOffer => ({
  companyId: 'c-' + o.facilityId,
  availableStock: qty(10_000),
  avgQuality: 70,
  reputation: 50,
  facilityLevel: 1,
  ...o,
});

describe('şehir talebi', () => {
  it('nüfus ve gelir endeksiyle ölçeklenir', () => {
    const ist = cityDemand(TOMATO, ISTANBUL, FLAT);
    const kon = cityDemand(TOMATO, KONYA, FLAT);
    // 25 × 1,6 × 1,2 = 48 kg  ·  25 × 0,65 × 0,9 = 14,625 kg
    expect(ist.units).toBe(qty(48));
    expect(kon.units).toBe(qty(14.625));
  });

  it('bütçe tavanını referans fiyattan üretir (R10)', () => {
    const d = cityDemand(TOMATO, ISTANBUL, FLAT);
    // 48 kg × 15 ₺ × 1,15 = 828 ₺
    expect(d.budget).toBe(money(828));
  });

  it('sıfır taban talepte sıfır döner', () => {
    const d = cityDemand({ ...TOMATO, baseDemand: 0 }, ISTANBUL, FLAT);
    expect(d.units).toBe(0n);
    expect(d.budget).toBe(0n);
  });

  it('çarpanları birleştirir', () => {
    const d = cityDemand(TOMATO, ISTANBUL, { ...FLAT, economicCycle: 1.1, seasonMultiplier: 0.5 });
    expect(d.units).toBe(qty(26.4)); // 48 × 1,1 × 0,5
  });
});

describe('çekicilik', () => {
  it('ucuz mağaza daha çekicidir', () => {
    const cheap = scoreOffer(offer({ facilityId: 'a', sellingPrice: money(14) }), TOMATO, PRODUCE);
    const dear = scoreOffer(offer({ facilityId: 'b', sellingPrice: money(20) }), TOMATO, PRODUCE);
    expect(cheap.attractiveness).toBeGreaterThan(dear.attractiveness);
  });

  it('kaliteli ve itibarlı mağaza daha çekicidir', () => {
    const base = { facilityId: 'a', sellingPrice: money(15) };
    const plain = scoreOffer(offer(base), TOMATO, PRODUCE);
    const good = scoreOffer(offer({ ...base, avgQuality: 95, reputation: 90 }), TOMATO, PRODUCE);
    expect(good.attractiveness).toBeGreaterThan(plain.attractiveness);
  });

  it('★ R10: rezervasyon fiyatı üstünde çekicilik SIFIRLANIR', () => {
    expect(reservationCeiling(TOMATO)).toBe(money(45)); // 15 × 3
    const justUnder = scoreOffer(offer({ facilityId: 'a', sellingPrice: money(44) }), TOMATO, PRODUCE);
    const justOver = scoreOffer(offer({ facilityId: 'b', sellingPrice: money(46) }), TOMATO, PRODUCE);

    expect(justUnder.attractiveness).toBeGreaterThan(0);
    expect(justUnder.aboveReservationPrice).toBe(false);
    expect(justOver.attractiveness).toBe(0);
    expect(justOver.aboveReservationPrice).toBe(true);
  });

  it('kategori ağırlıkları davranışı değiştirir', () => {
    const staple: CategoryWeights = { priceWeight: 1.6, qualityWeight: 0.8, brandWeight: 0.35 };
    const durable: CategoryWeights = { priceWeight: 0.95, qualityWeight: 1.3, brandWeight: 1.15 };
    const cheapLow = offer({ facilityId: 'a', sellingPrice: money(12), avgQuality: 40 });
    const dearHigh = offer({ facilityId: 'b', sellingPrice: money(18), avgQuality: 95, reputation: 90 });

    const stapleWinner =
      scoreOffer(cheapLow, TOMATO, staple).attractiveness >
      scoreOffer(dearHigh, TOMATO, staple).attractiveness;
    const durableWinner =
      scoreOffer(dearHigh, TOMATO, durable).attractiveness >
      scoreOffer(cheapLow, TOMATO, durable).attractiveness;

    expect(stapleWinner).toBe(true);  // temel gıdada fiyat kazanır
    expect(durableWinner).toBe(true); // dayanıklı malda kalite+marka kazanır
  });
});

describe('dağıtım', () => {
  const score = (o: RetailOffer) => scoreOffer(o, TOMATO, PRODUCE);

  it('çekiciliğe göre pay dağıtır', () => {
    const demand = cityDemand(TOMATO, ISTANBUL, FLAT); // 48 kg, 828 ₺
    const out = allocateRetail({
      demand,
      offers: [
        score(offer({ facilityId: 'ucuz', sellingPrice: money(13) })),
        score(offer({ facilityId: 'pahali', sellingPrice: money(17) })),
      ],
    });

    const cheap = out.allocations.find((a) => a.facilityId === 'ucuz')!;
    const dear = out.allocations.find((a) => a.facilityId === 'pahali')!;
    expect(cheap.units).toBeGreaterThan(dear.units);
    expect(out.soldUnits).toBe(demand.units);
    expect(out.unmetUnits).toBe(0n);
  });

  it('stok yetmezse karşılanmayan talep diğer mağazalara dağıtılır', () => {
    const demand = cityDemand(TOMATO, ISTANBUL, FLAT); // 48 kg
    const out = allocateRetail({
      demand,
      offers: [
        score(offer({ facilityId: 'az-stok', sellingPrice: money(12), availableStock: qty(5) })),
        score(offer({ facilityId: 'bol-stok', sellingPrice: money(16) })),
      ],
    });

    const small = out.allocations.find((a) => a.facilityId === 'az-stok')!;
    expect(small.units).toBe(qty(5));          // stoğu kadar
    expect(out.soldUnits).toBe(demand.units);  // kalan diğerine gitti
    expect(out.roundsUsed).toBeGreaterThan(1);
  });

  it('★ R10: bütçe tavanı geliri sınırlar', () => {
    const demand = cityDemand(TOMATO, ISTANBUL, FLAT); // 48 kg, 828 ₺ tavan
    // Tek satıcı, rakip yok, fiyat referansın 2 katı (tavanın altında)
    const out = allocateRetail({
      demand,
      offers: [score(offer({ facilityId: 'tekel', sellingPrice: money(30) }))],
    });

    expect(out.revenue).toBeLessThanOrEqual(demand.budget);
    expect(out.soldUnits).toBeLessThan(demand.units);   // bütçe birim sayısını kesti
    expect(out.budgetLimitedUnits).toBeGreaterThan(0n);
    // 828 ₺ / 30 ₺ = 27,6 kg
    expect(out.soldUnits).toBe(qty(27.6));
  });

  it('★ R10: rakipsiz mağaza fahiş fiyatta HİÇBİR ŞEY satamaz', () => {
    const demand = cityDemand(TOMATO, ISTANBUL, FLAT);
    const out = allocateRetail({
      demand,
      offers: [score(offer({ facilityId: 'tekel', sellingPrice: money(1_000_000) }))],
    });

    expect(out.soldUnits).toBe(0n);
    expect(out.revenue).toBe(0n);
    expect(out.unmetUnits).toBe(demand.units);
  });

  it('★ R1: 500 mağazada bile en fazla 3 tur koşar', () => {
    const demand = cityDemand(TOMATO, ISTANBUL, FLAT);
    const offers = Array.from({ length: 500 }, (_, i) =>
      score(offer({ facilityId: `m${i}`, sellingPrice: money(14), availableStock: qty(0.01) })),
    );
    const started = Date.now();
    const out = allocateRetail({ demand, offers });
    expect(out.roundsUsed).toBeLessThanOrEqual(3);
    expect(Date.now() - started).toBeLessThan(200);
    expect(out.unmetUnits).toBeGreaterThan(0n); // stok yetmedi, karşılanmadı
  });

  it('teklif yoksa tüm talep karşılanmaz', () => {
    const demand = cityDemand(TOMATO, ISTANBUL, FLAT);
    const out = allocateRetail({ demand, offers: [] });
    expect(out.soldUnits).toBe(0n);
    expect(out.unmetUnits).toBe(demand.units);
  });

  it('gelir hiçbir zaman bütçeyi aşmaz', () => {
    const demand = cityDemand(TOMATO, ISTANBUL, FLAT);
    for (const price of [1, 5, 15, 30, 44]) {
      const out = allocateRetail({
        demand,
        offers: [
          score(offer({ facilityId: 'a', sellingPrice: money(price) })),
          score(offer({ facilityId: 'b', sellingPrice: money(price + 1) })),
        ],
      });
      expect(out.revenue).toBeLessThanOrEqual(demand.budget);
    }
  });

  it('affordableUnits aşağı yuvarlar — karşılanamayan birim satılmaz', () => {
    expect(affordableUnits(money(100), money(30))).toBe(qty(3.333));
    expect(affordableUnits(money(0), money(30))).toBe(0n);
  });
});

describe('bozulma', () => {
  it('kaliteyi çarpımsal düşürür', () => {
    const r = decayBatch({ quality: 100, quantity: qty(10), expiresAtTick: 500n, decayRate: 0.004 }, 10n);
    expect(r.quality).toBe(99.6);
    expect(r.expired).toBe(false);
  });

  it('raf ömrü dolan lot düşülür', () => {
    const r = decayBatch({ quality: 80, quantity: qty(10), expiresAtTick: 100n, decayRate: 0.004 }, 100n);
    expect(r.expired).toBe(true);
  });

  it('bozulmayan ürüne dokunmaz (çelik, cam, elektronik)', () => {
    const r = decayBatch({ quality: 88, quantity: qty(10), expiresAtTick: null, decayRate: 0 }, 999_999n);
    expect(r.quality).toBe(88);
    expect(r.expired).toBe(false);
  });

  it('bitiş turunu raf ömründen hesaplar', () => {
    expect(expiryTick(100n, 480)).toBe(580n);
    expect(expiryTick(100n, null)).toBeNull();
  });
});

describe('çevrim ve gürültü', () => {
  it('iş çevrimi genlik içinde kalır ve deterministiktir', () => {
    for (let t = 0; t < 3000; t += 37) {
      const v = economicCycle(BigInt(t), 0.12);
      expect(v).toBeGreaterThanOrEqual(0.88 - 1e-9);
      expect(v).toBeLessThanOrEqual(1.12 + 1e-9);
    }
    expect(economicCycle(1234n, 0.12)).toBe(economicCycle(1234n, 0.12));
  });

  it('mevsim tablosu yoksa 1,0 döner', () => {
    expect(seasonMultiplier(0, undefined, 'TOMATO')).toBe(1);
    expect(seasonMultiplier(2, { TOMATO: [1.3, 1.0, 0.8, 0.6] }, 'TOMATO')).toBe(0.8);
  });

  it('gürültü dar bantta ve aynı tohumla tekrarlanabilir', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      const n = demandNoise(a);
      expect(n).toBeGreaterThanOrEqual(0.97);
      expect(n).toBeLessThanOrEqual(1.03);
      expect(n).toBe(demandNoise(b));
    }
  });
});

describe('dünya talep ölçeği (F8)', () => {
  const cfg = { baseMultiplier: 1, baselineCompanies: 65, elasticity: 0.85, max: 20 };

  it('taban şirket sayısında ölçek 1', () => {
    expect(worldDemandScale(65, cfg)).toBeCloseTo(1, 6);
  });

  it('★ oyuncu tabanı büyüdükçe dünya da büyür', () => {
    const az = worldDemandScale(65, cfg);
    const cok = worldDemandScale(500, cfg);
    expect(cok).toBeGreaterThan(az);
  });

  it('esneklik 1in altında: nokta başına ciro seyrelir, rekabet kalkmaz', () => {
    // 4 kat şirket → 4^0,85 ≈ 3,25 kat talep, yani nokta başına düşen azalır.
    const scale = worldDemandScale(260, cfg);
    expect(scale).toBeLessThan(4);
    expect(scale).toBeGreaterThan(3);
  });

  it('tabanın altına inilmez — küçülen dünya talebi kısmaz', () => {
    expect(worldDemandScale(10, cfg)).toBe(1);
    expect(worldDemandScale(0, cfg)).toBe(1);
  });

  it('üst sınır uygulanır — dünya sınırsız büyümez', () => {
    expect(worldDemandScale(1_000_000, cfg)).toBe(20);
  });

  it('taban çarpanı kalibrasyon koludur ve doğrudan çarpar', () => {
    const yuksek = { ...cfg, baseMultiplier: 3 };
    expect(worldDemandScale(65, yuksek)).toBeCloseTo(3, 6);
    expect(worldDemandScale(260, yuksek)).toBeCloseTo(3 * worldDemandScale(260, cfg), 6);
  });
});

describe('★ günlük talep ritmi (R72)', () => {
  it('genlik 0 ise etkisizdir', () => {
    expect(dailyRhythm(500n, 3, 0)).toBe(1);
  });

  it('bir gün sonra aynı değere döner — periyot 1 gündür', () => {
    expect(dailyRhythm(1234n + 96n, 3, 0.1)).toBeCloseTo(dailyRhythm(1234n, 3, 0.1), 10);
  });

  it('★ gün İÇİNDE gerçekten hareket eder — ölçütün aradığı budur', () => {
    // Tur başına bağımsız gürültü 96 turluk günde ortalaması alınıp ±%0,3'e
    // iner. Ölçüldü: tüm hafta fiyat aralığı %10,5–20,5 iken GÜNLÜK %0,4–3,0
    // (R72). Günlük ölçekte hiçbir şey olmuyordu.
    const gun = Array.from({ length: 96 }, (_, i) => dailyRhythm(BigInt(i), 3, 0.1));
    expect(Math.max(...gun) - Math.min(...gun)).toBeGreaterThan(0.15);
  });

  it('★ ürünler aynı anda zirve yapmaz — günün her saatinde bir şey hareket eder', () => {
    const zirve = (id: number) => {
      let best = -Infinity; let at = 0;
      for (let i = 0; i < 96; i++) {
        const v = dailyRhythm(BigInt(i), id, 0.1);
        if (v > best) { best = v; at = i; }
      }
      return at;
    };
    expect(new Set([3, 4, 6].map(zirve)).size).toBe(3);
  });

  it('deterministiktir: aynı tur aynı değeri verir (ADR-0003)', () => {
    expect(dailyRhythm(777n, 5, 0.1)).toBe(dailyRhythm(777n, 5, 0.1));
  });
});
