import { describe, expect, it } from 'vitest';
import { asQty, money, qty, type Money } from '@kapital/shared';
import { fxConversion, foreignPrices, nextFxRate, worldPriceUsd } from './fx.js';
import { matchBuyOrder, bookDepth, type BookOrder, type MatchCandidate } from './matching.js';
import { shippingCost, shippingPerUnit } from './shipping.js';
import { valuateStock } from './valuation.js';

const RATE = money(0.35); // 0,35 ₺ / kg / mesafe birimi

describe('nakliye (madde 17)', () => {
  const base = { weightPerUnit: 1, baseRate: RATE, logisticsModifier: 1 };

  it('aynı şehirde nakliye yoktur', () => {
    expect(shippingCost({ ...base, quantity: qty(100), distanceIndex: 0 })).toBe(0n);
  });

  it('mesafeyle doğrusal artar', () => {
    const near = shippingCost({ ...base, quantity: qty(100), distanceIndex: 1.5 }); // İST→BRS
    const far = shippingCost({ ...base, quantity: qty(100), distanceIndex: 6.6 });  // İST→KON
    expect(far).toBe(near * 44n / 10n);
    // 100 kg × 1 × 1,5 × 0,35 = 52,50 ₺
    expect(near).toBe(money(52.5));
  });

  it('ağır ürün pahalı taşınır — mobilya 60 kg/adet', () => {
    const bread = shippingCost({ ...base, quantity: qty(10), distanceIndex: 4.5, weightPerUnit: 0.5 });
    const furniture = shippingCost({ ...base, quantity: qty(10), distanceIndex: 4.5, weightPerUnit: 60 });
    expect(furniture).toBe(bread * 120n);
  });

  it('lojistik katsayısı maliyeti düşürür (AR-GE)', () => {
    const normal = shippingCost({ ...base, quantity: qty(100), distanceIndex: 4.5 });
    const improved = shippingCost({ ...base, quantity: qty(100), distanceIndex: 4.5, logisticsModifier: 0.88 });
    expect(improved).toBeLessThan(normal);
  });

  it('birim başına nakliye UI için ayrı hesaplanır (madde 16)', () => {
    expect(shippingPerUnit({ ...base, distanceIndex: 4.5 })).toBe(money(1.575));
  });
});

describe('emir eşleştirme (madde 16, C2)', () => {
  const order = (o: Partial<BookOrder> & { orderId: bigint; pricePerUnit: Money }): BookOrder => ({
    companyId: 'c' + o.orderId, facilityId: 'f' + o.orderId, cityId: 1,
    remaining: qty(1000), minQuality: 0, quality: 80,
    maxDeliveryDistance: null, createdAt: Number(o.orderId), ...o,
  });
  const candidate = (sell: BookOrder, ship: Money, distance = 0, transit = 0): MatchCandidate =>
    ({ sell, shippingPerUnit: ship, distanceIndex: distance, transitTicks: transit });

  it('nakliye dahil tavanı aşan satıcıyı eler', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(30), companyId: 'alici' });
    const near = order({ orderId: 2n, pricePerUnit: money(28), companyId: 's1' });
    const far = order({ orderId: 3n, pricePerUnit: money(25), companyId: 's2' });

    const { matches } = matchBuyOrder(buy, [
      candidate(near, money(1)),   // toplam 29 ≤ 30 ✓
      candidate(far, money(8), 6.6), // toplam 33 > 30 ✗ — ucuz ama uzak
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sell.companyId).toBe('s1');
  });

  it('alıcı için en ucuz TOPLAM maliyeti seçer, en ucuz fiyatı değil', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(40), companyId: 'alici', remaining: qty(100) });
    const expensive = order({ orderId: 2n, pricePerUnit: money(30), companyId: 'yakin' });
    const cheap = order({ orderId: 3n, pricePerUnit: money(22), companyId: 'uzak' });

    const { matches } = matchBuyOrder(buy, [
      candidate(expensive, money(1)),   // toplam 31
      candidate(cheap, money(12), 6.6), // toplam 34 — fiyatı ucuz ama toplamı pahalı
    ]);
    expect(matches[0]!.sell.companyId).toBe('yakin');
  });

  it('minimum kalite şartını uygular', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(30), companyId: 'a', minQuality: 75 });
    const low = order({ orderId: 2n, pricePerUnit: money(20), companyId: 's1', quality: 60 });
    const high = order({ orderId: 3n, pricePerUnit: money(25), companyId: 's2', quality: 90 });
    const { matches } = matchBuyOrder(buy, [candidate(low, 0n as Money), candidate(high, 0n as Money)]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sell.quality).toBe(90);
  });

  it('maksimum teslimat mesafesini uygular', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(30), companyId: 'a', maxDeliveryDistance: 2 });
    const far = order({ orderId: 2n, pricePerUnit: money(20), companyId: 's1' });
    const { matches } = matchBuyOrder(buy, [candidate(far, money(1), 4.5)]);
    expect(matches).toHaveLength(0);
  });

  it('kendi emrine eşleşmez (wash trade önlemi)', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(30), companyId: 'ayni' });
    const own = order({ orderId: 2n, pricePerUnit: money(20), companyId: 'ayni' });
    expect(matchBuyOrder(buy, [candidate(own, 0n as Money)]).matches).toHaveLength(0);
  });

  it('fiyat, satıcı isteği ile alıcı tavanının orta noktasıdır', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(30), companyId: 'a', remaining: qty(10) });
    const sell = order({ orderId: 2n, pricePerUnit: money(20), companyId: 's' });
    const { matches } = matchBuyOrder(buy, [candidate(sell, money(2))]);
    // alıcının mala ayırdığı tavan = 30 − 2 = 28; orta nokta (20+28)/2 = 24
    expect(matches[0]!.pricePerUnit).toBe(money(24));
    expect(matches[0]!.buyerTotal).toBe(money(24 * 10 + 2 * 10));
  });

  it('birden çok satıcıdan kısmi doldurur, ucuzdan başlar', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(30), companyId: 'a', remaining: qty(150) });
    const s1 = order({ orderId: 2n, pricePerUnit: money(18), companyId: 's1', remaining: qty(100) });
    const s2 = order({ orderId: 3n, pricePerUnit: money(22), companyId: 's2', remaining: qty(100) });
    const { matches, filled } = matchBuyOrder(buy, [candidate(s2, 0n as Money), candidate(s1, 0n as Money)]);
    expect(filled).toBe(qty(150));
    expect(matches[0]!.sell.companyId).toBe('s1');
    expect(matches[0]!.quantity).toBe(qty(100));
    expect(matches[1]!.quantity).toBe(qty(50));
  });

  it('aynı toplam maliyette eski emir önce (zaman önceliği)', () => {
    const buy = order({ orderId: 1n, pricePerUnit: money(30), companyId: 'a', remaining: qty(50) });
    const older = order({ orderId: 2n, pricePerUnit: money(20), companyId: 's1', createdAt: 1 });
    const newer = order({ orderId: 3n, pricePerUnit: money(20), companyId: 's2', createdAt: 9 });
    const { matches } = matchBuyOrder(buy, [candidate(newer, 0n as Money), candidate(older, 0n as Money)]);
    expect(matches[0]!.sell.companyId).toBe('s1');
  });

  it('defter derinliğini özetler', () => {
    const depth = bookDepth([
      order({ orderId: 1n, pricePerUnit: money(20), remaining: qty(100) }),
      order({ orderId: 2n, pricePerUnit: money(18), remaining: qty(50) }),
    ]);
    expect(depth.totalQuantity).toBe(qty(150));
    expect(depth.bestPrice).toBe(money(18));
    expect(depth.orderCount).toBe(2);
  });
});

describe('stok değerlemesi (madde 41, C3)', () => {
  const base = { referencePrice: money(15), threshold: 0.2, discount: 0.5 };

  it('likit stok tam değerlenir', () => {
    const r = valuateStock({ ...base, quantity: qty(100), marketVolume24h: qty(1000) });
    expect(r.value).toBe(money(1500));
    expect(r.discountApplied).toBe(false);
  });

  it('★ hacmin %20\'sini aşan stok yarı değerle sayılır', () => {
    // hacim 1000 → likit sınır 200. 500 kg tutan oyuncu: 200 tam + 300 yarı
    const r = valuateStock({ ...base, quantity: qty(500), marketVolume24h: qty(1000) });
    expect(r.discountApplied).toBe(true);
    expect(r.discountedQuantity).toBe(qty(300));
    // 200×15 + 300×15×0,5 = 3000 + 2250 = 5250
    expect(r.value).toBe(money(5250));
  });

  it('piyasayı stoklayarak şirket değeri şişirilemez', () => {
    const honest = valuateStock({ ...base, quantity: qty(200), marketVolume24h: qty(1000) });
    const hoarder = valuateStock({ ...base, quantity: qty(2000), marketVolume24h: qty(1000) });
    // 10 kat stok, 10 kat değer VERMEZ
    expect(hoarder.value).toBeLessThan(honest.value * 10n);
  });

  it('hiç işlem geçmemiş üründe iskonto uygulanmaz', () => {
    const r = valuateStock({ ...base, quantity: qty(500), marketVolume24h: asQty(0n) });
    expect(r.discountApplied).toBe(false);
    expect(r.value).toBe(money(7500));
  });
});

describe('kur modeli (docs/12 §4)', () => {
  const base = {
    baseRate: money(35), alpha: 0.05, tradeBalanceK: 0.02, clampPerTick: 0.005,
  };

  it('enflasyon yoksa ve ticaret dengedeyse kur sabit kalır', () => {
    const r = nextFxRate({ ...base, previousRate: money(35), gameCpi: 1, tradeBalance: 0 });
    expect(r.rate).toBe(money(35));
  });

  it('★ oyun içi enflasyon ₺\'yi değersizleştirir', () => {
    let rate = money(35);
    for (let i = 0; i < 200; i++) {
      rate = nextFxRate({ ...base, previousRate: rate, gameCpi: 1.2, tradeBalance: 0 }).rate;
    }
    // %20 enflasyon → kur 35 → ~42'ye yakınsar
    expect(Number(rate) / Number(money(35))).toBeCloseTo(1.2, 1);
  });

  it('ihracat fazlası ₺\'yi değerlendirir', () => {
    const surplus = nextFxRate({ ...base, previousRate: money(35), gameCpi: 1, tradeBalance: 1 });
    const deficit = nextFxRate({ ...base, previousRate: money(35), gameCpi: 1, tradeBalance: -1 });
    expect(surplus.rate).toBeLessThan(money(35));
    expect(deficit.rate).toBeGreaterThan(money(35));
  });

  it('tur başına hareket sınırlıdır — ani şok yok', () => {
    const shock = nextFxRate({ ...base, previousRate: money(35), gameCpi: 10, tradeBalance: -1 });
    expect(shock.clamped).toBe(true);
    expect(Number(shock.rate)).toBeLessThanOrEqual(Number(money(35)) * 1.005 + 1);
  });
});

describe('dış ticaret fiyatları (docs/12 §3.2, R18)', () => {
  it('band ~%60 genişliğinde — fiyat keşfi yaşar', () => {
    const world = worldPriceUsd(money(0.4286), 1);
    const { exportUsd, importUsd } = foreignPrices(world, 0.75, 1.35);
    expect(Number(importUsd) / Number(exportUsd)).toBeCloseTo(1.8, 2);
    const width = (Number(importUsd) - Number(exportUsd)) / Number(world);
    expect(width).toBeCloseTo(0.6, 2);
  });

  it('ithal edip ihraç etmek her turda ~%45 kaybettirir — arbitraj yok', () => {
    const world = worldPriceUsd(money(1), 1);
    const { exportUsd, importUsd } = foreignPrices(world, 0.75, 1.35);
    const roundTrip = Number(exportUsd) / Number(importUsd) - 1;
    expect(roundTrip).toBeLessThan(-0.4);
  });

  it('dünya fiyatı endeksle ölçeklenir ama oyuncu belirleyemez', () => {
    expect(worldPriceUsd(money(2), 1.1)).toBe(money(2.2));
  });
});

describe('kur işlemi (S4)', () => {
  it('spread her iki yönde de maliyettir — round-trip bedava değil', () => {
    const rate = money(35);
    const buy = fxConversion(money(100), rate, 0.015, 'BUY_USD');
    const sell = fxConversion(money(100), rate, 0.015, 'SELL_USD');
    expect(buy.tryAmount).toBeGreaterThan(sell.tryAmount);
    // 100 $ al-sat: 3.552,50 − 3.447,50 = 105 ₺ kayıp (%3)
    expect(buy.tryAmount - sell.tryAmount).toBe(money(105));
  });

  it('kur dönüşümü ölçeği doğru düşürür', () => {
    const r = fxConversion(money(100), money(35), 0, 'BUY_USD');
    expect(r.tryAmount).toBe(money(3500)); // 100 $ × 35 ₺
  });
});
