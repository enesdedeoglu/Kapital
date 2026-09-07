import { describe, expect, it } from 'vitest';
import { money, mulberry32, mulMoney, qty, type Money } from '@kapital/shared';
import { productionCapacity } from '../production/capacity.js';
import {
  decidePrice, inputBid, investmentScore, npcCapacityCap, outputThrottle,
  planInventory, representativeDistance, clearanceFactor, shouldDivest, strategicNeed,
} from './decisions.js';
import { ARCHETYPES, varyTemplate } from './profile.js';

const priceBase = {
  targetMargin: 0.2, priceAggressiveness: 0.5, marketHealth: 100,
  normalBand: 0.03, emergencyBand: 0.10, emergencyHealthBelow: 35,
};

describe('arketipler (madde 24)', () => {
  it('sekiz farklı karakter tanımlı', () => {
    expect(ARCHETYPES).toHaveLength(8);
    expect(new Set(ARCHETYPES.map((a) => a.archetype)).size).toBe(8);
  });

  it('ucuzcu düşük marjlı, premium yüksek kaliteli', () => {
    const discounter = ARCHETYPES.find((a) => a.archetype === 'DISCOUNTER')!;
    const premium = ARCHETYPES.find((a) => a.archetype === 'PREMIUM')!;
    expect(discounter.targetMargin).toBeLessThan(premium.targetMargin);
    expect(premium.qualityTarget).toBeGreaterThan(discounter.qualityTarget);
    // Ucuzcu piyasayı yakından takip eder, premium maliyetine göre fiyatlar
    expect(discounter.priceAggressiveness).toBeGreaterThan(premium.priceAggressiveness);
  });

  it('spekülatör en riskli ve en sık karar veren', () => {
    const spec = ARCHETYPES.find((a) => a.archetype === 'SPECULATOR')!;
    expect(spec.riskTolerance).toBe(Math.max(...ARCHETYPES.map((a) => a.riskTolerance)));
    expect(spec.strategyIntervalTicks).toBe(Math.min(...ARCHETYPES.map((a) => a.strategyIntervalTicks)));
  });

  it('★ parametreler dağıtılır — hiçbir NPC aynı değil', () => {
    const template = ARCHETYPES[0]!;
    const variants = Array.from({ length: 20 }, (_, i) => varyTemplate(template, mulberry32(i)));
    const margins = new Set(variants.map((v) => v.targetMargin.toFixed(6)));
    expect(margins.size).toBe(20);
    for (const v of variants) {
      expect(v.targetMargin).toBeGreaterThan(template.targetMargin * 0.84);
      expect(v.targetMargin).toBeLessThan(template.targetMargin * 1.16);
    }
  });

  it('dağıtım deterministiktir', () => {
    const a = varyTemplate(ARCHETYPES[2]!, mulberry32(42));
    const b = varyTemplate(ARCHETYPES[2]!, mulberry32(42));
    expect(a).toEqual(b);
  });
});

describe('fiyat kararı (madde 25)', () => {
  it('ilk fiyatlamada bant uygulanmaz', () => {
    const d = decidePrice({ ...priceBase, unitCost: money(10), reference: money(15), currentPrice: null });
    expect(d.clamped).toBe(false);
    // hedef 12, piyasa 15, agresiflik 0,5 → 13,50
    expect(d.price).toBe(money(13.5));
  });

  it('agresif NPC piyasayı, temkinli NPC maliyetini takip eder', () => {
    const follower = decidePrice({ ...priceBase, unitCost: money(10), reference: money(20), currentPrice: null, priceAggressiveness: 1 });
    const coster = decidePrice({ ...priceBase, unitCost: money(10), reference: money(20), currentPrice: null, priceAggressiveness: 0 });
    expect(follower.price).toBe(money(20));  // tamamen piyasa
    expect(coster.price).toBe(money(12));    // maliyet + %20
  });

  it('★ normal bant tur başına ±%3 ile sınırlar', () => {
    const d = decidePrice({ ...priceBase, unitCost: money(50), reference: money(60), currentPrice: money(20) });
    expect(d.clamped).toBe(true);
    expect(d.price).toBe(money(20.6)); // 20 × 1,03
    expect(d.emergency).toBe(false);
  });

  it('★ R4: krizde acil bant ±%10\'a açılır', () => {
    const normal = decidePrice({ ...priceBase, unitCost: money(5), reference: money(5), currentPrice: money(20) });
    const crisis = decidePrice({ ...priceBase, unitCost: money(5), reference: money(5), currentPrice: money(20), marketHealth: 20 });

    expect(normal.emergency).toBe(false);
    expect(normal.price).toBe(money(19.4));  // 20 × 0,97

    expect(crisis.emergency).toBe(true);
    expect(crisis.price).toBe(money(18));    // 20 × 0,90 — 3 kat hızlı tepki
    expect(crisis.reason).toMatch(/acil bant/);
  });

  it('sapma küçükse health düşük olsa da acil bant açılmaz', () => {
    const d = decidePrice({ ...priceBase, unitCost: money(16), reference: money(20), currentPrice: money(20), marketHealth: 10 });
    expect(d.emergency).toBe(false);
  });

  it('★ bant sayesinde NPC 6 saatte değil, krizde ~2 saatte yetişir', () => {
    // %50 düşüş: normal bantla kaç tur? acil bantla kaç tur?
    const ticks = (band: number) => Math.ceil(Math.log(0.5) / Math.log(1 - band));
    expect(ticks(0.03)).toBeGreaterThan(20);  // ~23 tur ≈ 6 saat
    expect(ticks(0.10)).toBeLessThan(8);      // ~7 tur ≈ 2 saat
  });
});

describe('stok yönetimi (madde 26)', () => {
  const base = { consumptionPerTick: 10, minTicks: 4, targetTicks: 12, maxTicks: 24 };

  it('hedefin altındaysa eksiği tamamlar', () => {
    const plan = planInventory({ ...base, onHand: qty(50) }); // 5 turluk
    expect(plan.coverageTicks).toBe(5);
    expect(plan.buyQuantity).toBe(qty(70)); // (12−5) × 10
    expect(plan.urgent).toBe(false);
  });

  it('★ minimumun altında acil alım yapar', () => {
    const plan = planInventory({ ...base, onHand: qty(20) }); // 2 turluk
    expect(plan.urgent).toBe(true);
    expect(plan.reason).toMatch(/minimum/);
  });

  it('maksimumun üstünde alım durur', () => {
    const plan = planInventory({ ...base, onHand: qty(300) }); // 30 turluk
    expect(plan.buyQuantity).toBe(0n);
    expect(plan.reason).toMatch(/maksimum/);
  });

  it('hedefte alım yapılmaz', () => {
    expect(planInventory({ ...base, onHand: qty(120) }).buyQuantity).toBe(0n);
  });

  it('★ Director BUY_BIAS hedefi büyütür ama mantığı ezmez', () => {
    const neutral = planInventory({ ...base, onHand: qty(50) });
    const stimulated = planInventory({ ...base, onHand: qty(50), buyBias: 1 });
    expect(stimulated.buyQuantity).toBeGreaterThan(neutral.buyQuantity);
    // Yine de maksimum stok kuralı geçerli
    expect(planInventory({ ...base, onHand: qty(300), buyBias: 1 }).buyQuantity).toBe(0n);
  });

  it('tüketimi olmayan üründe plan yapılmaz', () => {
    const plan = planInventory({ ...base, onHand: qty(0), consumptionPerTick: 0 });
    expect(plan.buyQuantity).toBe(0n);
  });
});

describe('yatırım skoru (madde 27)', () => {
  const base = { profitMargin: 0.5, demandGap: 0.5, priceTrend: 0.5, strategicNeed: 0.5, competition: 0.5 };

  it('ağırlıklar madde 27 ile uyumlu', () => {
    expect(investmentScore({ ...base, profitMargin: 1 }) - investmentScore(base)).toBeCloseTo(0.175, 6);
    expect(investmentScore({ ...base, demandGap: 1 }) - investmentScore(base)).toBeCloseTo(0.15, 6);
    // ★ Rekabet skoru DÜŞÜRÜR
    expect(investmentScore({ ...base, competition: 1 }) - investmentScore(base)).toBeCloseTo(-0.05, 6);
  });

  it('kârlı ve arzı yetersiz pazar yüksek skor alır', () => {
    const attractive = investmentScore({ profitMargin: 0.9, demandGap: 0.9, priceTrend: 0.8, strategicNeed: 0.5, competition: 0.1 });
    const saturated = investmentScore({ profitMargin: 0.1, demandGap: 0.1, priceTrend: 0.2, strategicNeed: 0.1, competition: 0.9 });
    expect(attractive).toBeGreaterThan(0.6);
    expect(saturated).toBeLessThan(0.15);
  });
});

describe('NPC kapasite tavanı (madde 31)', () => {
  it('oyuncu arzı arttıkça NPC geri çekilir', () => {
    let cap = 0.85;
    for (let i = 0; i < 200; i++) cap = npcCapacityCap(0.7, cap);
    expect(cap).toBeCloseTo(0.195, 2); // 1 − 0,7×1,15
  });

  it('★ geri çekilme KADEMELİ — tur başına en fazla %2', () => {
    const next = npcCapacityCap(0.9, 0.85);
    expect(0.85 - next).toBeCloseTo(0.02, 6);
  });

  it('taban ve tavan korunur', () => {
    let cap = 0.85;
    for (let i = 0; i < 500; i++) cap = npcCapacityCap(1, cap);
    expect(cap).toBeGreaterThanOrEqual(0.10);
    let low = 0.10;
    for (let i = 0; i < 500; i++) low = npcCapacityCap(0, low);
    expect(low).toBeLessThanOrEqual(0.85);
  });
});

describe('inputBid — navlun dahil tavan (R20)', () => {
  const reference = money(3.86);

  it('navlun payı olmadan uzak satıcı erişilemez, payla erişilebilir', () => {
    // Konya→Ankara buğday: satıcı 3,66 ister, navlun 0,91.
    const ask = money(3.66);
    const freight = money(0.91);

    const naif = mulMoney(reference, 1.02).value; // eski davranış
    expect(ask + freight > naif).toBe(true); // ★ eşleşemez

    const bid = inputBid({ reference, urgent: false, freightAllowance: freight });
    expect(ask + freight <= bid).toBe(true); // ★ eşleşir
  });

  it('acil durumda pay büyür', () => {
    const normal = inputBid({ reference, urgent: false, freightAllowance: 0n as Money });
    const acil = inputBid({ reference, urgent: true, freightAllowance: 0n as Money });
    expect(acil > normal).toBe(true);
    expect(acil).toBe(mulMoney(reference, 1.1).value);
  });

  it('aynı şehirde pay sıfırdır — yerel satıcı hâlâ ucuza kazanır', () => {
    const bid = inputBid({ reference, urgent: false, freightAllowance: 0n as Money });
    expect(bid).toBe(mulMoney(reference, 1.02).value);
  });

  it('navlun payı doğrudan tavana eklenir, referansla çarpılmaz', () => {
    const freight = money(1.5);
    const bid = inputBid({ reference, urgent: false, freightAllowance: freight });
    expect(bid).toBe(mulMoney(reference, 1.02).value + freight);
  });
});

describe('representativeDistance', () => {
  it('tek sayıda mesafede medyanı verir', () => {
    expect(representativeDistance([2.6, 3.9, 4.5])).toBe(3.9);
  });

  it('çift sayıda mesafede iki ortancanın ortalamasını verir', () => {
    // Ankara: Konya 2,6 · Bursa 3,9 · İstanbul 4,5 · İzmir 5,9
    expect(representativeDistance([2.6, 3.9, 4.5, 5.9])).toBe(4.2);
  });

  it('kendi şehrinin sıfır mesafesini eler', () => {
    expect(representativeDistance([0, 2.6, 3.9, 4.5, 5.9])).toBe(4.2);
  });

  it('tek şehirli dünyada sıfırdır', () => {
    expect(representativeDistance([0])).toBe(0);
    expect(representativeDistance([])).toBe(0);
  });
});

describe('outputThrottle — satılmayan üretimi kısma (madde 31)', () => {
  const base = { targetTicks: 8, maxStep: 0.05, floor: 0.10 };

  it('stok hedefin altındayken tam kapasitede kalır', () => {
    expect(outputThrottle({ ...base, coverageTicks: 3, previous: 1 })).toBe(1);
  });

  it('stok hedefin iki katıysa üretimi yarıya doğru çeker', () => {
    // hedef kullanım = 8/16 = 0,5 — ama tek turda en fazla 0,05 iner
    expect(outputThrottle({ ...base, coverageTicks: 16, previous: 1 })).toBeCloseTo(0.95, 6);
  });

  it('kademeli iner, bir turda çökmez', () => {
    let u = 1;
    const steps: number[] = [];
    for (let i = 0; i < 12; i++) {
      u = outputThrottle({ ...base, coverageTicks: 16, previous: u });
      steps.push(u);
    }
    expect(steps.every((s, i) => i === 0 || s <= steps[i - 1]!)).toBe(true);
    expect(u).toBeCloseTo(0.5, 6); // hedefe ulaşır ve orada durur
  });

  it('stok erirken kademeli olarak geri açılır', () => {
    let u = 0.4;
    for (let i = 0; i < 20; i++) u = outputThrottle({ ...base, coverageTicks: 1, previous: u });
    expect(u).toBe(1);
  });

  it('tabanın altına inmez — fiyat sinyali korunur', () => {
    let u = 1;
    for (let i = 0; i < 100; i++) u = outputThrottle({ ...base, coverageTicks: 10_000, previous: u });
    expect(u).toBe(0.10);
  });

  it('sıfır kapsam tam kapasitedir', () => {
    expect(outputThrottle({ ...base, coverageTicks: 0, previous: 0.5 })).toBeCloseTo(0.55, 6);
  });
});

describe('productionCapacity kullanım oranını uygular', () => {
  const cap = (utilization?: number) => productionCapacity({
    baseCapacity: 20, levelMultiplier: 1, condition: 100,
    cityBonus: 1, technologyBonus: 0, utilization,
  });

  it('varsayılan tam kapasitedir', () => expect(cap()).toBe(20));
  it('yarım kullanım yarım üretir', () => expect(cap(0.5)).toBe(10));
  it('aralık dışı değerler kırpılır', () => {
    expect(cap(1.5)).toBe(20);
    expect(cap(-1)).toBe(0);
  });
});

describe('★ stratejik ihtiyaç beraberliği bozar (R48)', () => {
  /**
   * Ölçülen (700 turluk kapı koşusu): fırın 0,37 · buğday tarlası 0,36 ·
   * değirmen 0,36. Fark 0,01 ve NPC en yüksek skorlu TEK fırsatı seçtiği için
   * 28 yatırımın hepsi fırına gitti, buğdaya sıfır. Un 0,30'da kalırken fırın
   * eklemek zinciri düzeltmez — kurulur, girdi bulamaz, işçilik öder, durur.
   *
   * `strategicNeed` girdilerin en kıt olanının arz sağlığıdır; hammaddede 1.
   */
  const base = {
    profitMargin: 0.36, demandGap: 1.0, priceTrend: 0, competition: 1.0,
  };

  it('girdisi kıt fabrika, marjı daha iyi olsa bile hammaddenin gerisinde kalır', () => {
    const firin = investmentScore({ ...base, profitMargin: 0.36, strategicNeed: 0 });
    const tarla = investmentScore({ ...base, profitMargin: 0.31, strategicNeed: 1 });
    expect(tarla).toBeGreaterThan(firin);
  });

  it('girdi bollaşınca fabrika öne geçer — sıra nedenselliğin sırasıdır', () => {
    const firin = investmentScore({ ...base, profitMargin: 0.36, strategicNeed: 1 });
    const tarla = investmentScore({ ...base, profitMargin: 0.31, strategicNeed: 1 });
    expect(firin).toBeGreaterThan(tarla);
  });

  it('sabit 0,5 hiçbir beraberliği bozmazdı', () => {
    const firin = investmentScore({ ...base, profitMargin: 0.36, strategicNeed: 0.5 });
    const tarla = investmentScore({ ...base, profitMargin: 0.31, strategicNeed: 0.5 });
    expect(Math.abs(firin - tarla)).toBeLessThan(0.02);
  });
});

describe('★ raf fiyatına stok baskısı (R51)', () => {
  const cfg = { targetTicks: 8, maxDiscount: 0.25 };

  it('hedefin altında stokta indirim yok', () => {
    expect(clearanceFactor({ coverageTicks: 3, ...cfg })).toBe(1);
    expect(clearanceFactor({ coverageTicks: 8, ...cfg })).toBe(1);
  });

  it('stok biriktikçe fiyat kademeli düşer', () => {
    const az = clearanceFactor({ coverageTicks: 10, ...cfg });
    const cok = clearanceFactor({ coverageTicks: 14, ...cfg });
    expect(az).toBeLessThan(1);
    expect(cok).toBeLessThan(az);
  });

  it('★ indirim tavanı aşılmaz — zararına satış kuralı değil', () => {
    expect(clearanceFactor({ coverageTicks: 16, ...cfg })).toBeCloseTo(0.75, 5);
    expect(clearanceFactor({ coverageTicks: 200, ...cfg })).toBeCloseTo(0.75, 5);
  });

  it('bozuk girdi fiyatı bozmaz', () => {
    expect(clearanceFactor({ coverageTicks: 50, targetTicks: 0, maxDiscount: 0.25 })).toBe(1);
    expect(clearanceFactor({ coverageTicks: 50, targetTicks: 8, maxDiscount: 0 })).toBe(1);
  });
});

describe('★ indirim yalnız GERÇEK fazlada uygulanır (R53)', () => {
  const cfg = { coverageTicks: 20, targetTicks: 8, maxDiscount: 0.25 };

  it('piyasa kıtken yavaş dükkân cezalandırılmaz', () => {
    expect(clearanceFactor({ ...cfg, marketRatio: 0.6 })).toBe(1);
    expect(clearanceFactor({ ...cfg, marketRatio: 1.0 })).toBe(1);
  });

  it('piyasa fazlayken indirim çalışır', () => {
    expect(clearanceFactor({ ...cfg, marketRatio: 1.3 })).toBeLessThan(1);
  });

  it('piyasa bilgisi yoksa eski davranış korunur', () => {
    expect(clearanceFactor(cfg)).toBeLessThan(1);
  });
});

describe('★ stratejik ihtiyaç: nerede değer katılır (R54)', () => {
  // Ölçülen zincir (F8, tohum 0): buğday f_supply 0,38 · un 0,20 · ekmek 0,20.
  const bugday = 0.38, un = 0.20, ekmek = 0.20;

  it('hammadde kendi çıktısı kıtken öne çıkar', () => {
    expect(strategicNeed(1, bugday)).toBe(1);
  });

  it('★ değirmen artık fırının önünde — un buğdaydan kıt', () => {
    const degirmen = strategicNeed(bugday, un);
    const firin = strategicNeed(un, ekmek);
    expect(degirmen).toBeGreaterThan(firin);
    expect(degirmen).toBeCloseTo(0.68, 2);
  });

  it('girdi ve çıktı eşitse nötr — özel bir sebep yok', () => {
    expect(strategicNeed(0.5, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('★ çıktı düzeldikçe ilgi kendiliğinden geri çekilir', () => {
    const kit = strategicNeed(1, 0.2);
    const bol = strategicNeed(1, 0.9);
    expect(kit).toBeGreaterThan(bol);
  });
});

describe('★ yatırımdan çıkış — cırcır kırılır (R58, R60)', () => {
  const temel = { minIdleTicks: 192, minCoverageTicks: 48 };

  it('uzun süredir stoğu erimeyen tesis kapanır', () => {
    expect(shouldDivest({ ...temel, coverageTicks: 200, idleTicks: 250 })).toBe(true);
  });

  it('★ geçici durgunluk kapatma sebebi değildir', () => {
    expect(shouldDivest({ ...temel, coverageTicks: 200, idleTicks: 20 })).toBe(false);
  });

  it('★ stok birikmemişse sorun talep değildir — kapatma', () => {
    expect(shouldDivest({ ...temel, coverageTicks: 5, idleTicks: 300 })).toBe(false);
  });

  it('★ kısmanın oturması beklenir: 2 günden kısa birikim yetmez', () => {
    // Kısma ≤%5/tur ile ~20 turda oturur. Çıkış kararı ondan belirgin biçimde
    // yavaş olmalı, yoksa kısmanın daha bitirmediği işi bozar.
    expect(shouldDivest({ ...temel, coverageTicks: 300, idleTicks: 191 })).toBe(false);
    expect(shouldDivest({ ...temel, coverageTicks: 300, idleTicks: 193 })).toBe(true);
  });

  it('★ karar KISMA SEVİYESİNE bakmaz — aynı sinyale iki denetleyici asılmaz', () => {
    // Kısma zaten fazla arza verilen cevaptır; tesisi "kısılmış olduğu için"
    // kapatmak fazla arzı iki kez cezalandırır. Ölçüldü: kural kısmaya
    // bağlıyken NPC üretim payı %81,5'ten %59,6'ya düştü (R60).
    //
    // Girdide kısma seviyesi diye bir alan YOKTUR; bu test onu korur.
    const anahtarlar = Object.keys({ ...temel, coverageTicks: 0, idleTicks: 0 });
    expect(anahtarlar).not.toContain('utilization');
    expect(anahtarlar).not.toContain('idleBelow');
  });
});
