import { describe, expect, it } from 'vitest';
import { money } from '@kapital/shared';
import {
  DEFAULT_HEALTH_WEIGHTS, marketHealthScore, type HealthInput,
} from './health.js';
import {
  advanceHysteresis, classifyBand, directivesForBand, leverMultiplier, softFloor,
  type HealthBand,
} from './bands.js';
import { giniCoefficient } from './inequality.js';
import { marginScore, PRICE_MARKUP_BAND } from '../npc/decisions.js';

const healthy: HealthInput = {
  supply: 1000, demand: 1000, sellerCount: 8, buyerCount: 12,
  inventoryDepthTicks: 12, priceVolatility: 0.05, tradeCount: 40,
  playerShare: 0.8, targetPlayerShare: 0.8,
  targetSellers: 6, targetBuyers: 10,
};

describe('Market Health Score (madde 29)', () => {
  it('her şey yerindeyse 100 civarıdır', () => {
    const { score } = marketHealthScore(healthy);
    expect(score).toBeGreaterThan(95);
  });

  it('arz talebe eşitken f_supply tepe yapar', () => {
    const { components } = marketHealthScore(healthy);
    expect(components.supply).toBe(1);
  });

  it('KITLIK da AŞIRI ARZ da skoru düşürür — 1,0 iki yönlü tepedir', () => {
    const kitlik = marketHealthScore({ ...healthy, supply: 500 });   // oran 0,5
    const asiri = marketHealthScore({ ...healthy, supply: 1500 });   // oran 1,5
    expect(kitlik.components.supply).toBe(0);
    expect(asiri.components.supply).toBe(0);
    expect(kitlik.score).toBeLessThan(healthy.supply);
  });

  it('üretimi durmuş bir ürün EMERGENCY bandına düşer', () => {
    const { score } = marketHealthScore({
      ...healthy, supply: 0, sellerCount: 0, inventoryDepthTicks: 0,
      priceVolatility: 0.6, playerShare: 0, tradeCount: 0,
    });
    expect(classifyBand(score)).toBe('EMERGENCY');
  });

  it('oyuncu payı hedefi AŞMAK ceza değildir', () => {
    const hedefte = marketHealthScore({ ...healthy, playerShare: 0.8 });
    const asiri = marketHealthScore({ ...healthy, playerShare: 1.0 });
    expect(asiri.score).toBe(hedefte.score);
  });

  it('ağırlıklar toplamı 1 değilse normalize edilir — skor 100ü aşmaz', () => {
    const carpik = { ...DEFAULT_HEALTH_WEIGHTS, supply: 3 };
    const { score } = marketHealthScore(healthy, carpik);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThan(95);
  });

  it('talep sıfırken arz varsa aşırı arz sayılır', () => {
    const { components } = marketHealthScore({ ...healthy, demand: 0, supply: 100 });
    expect(components.supply).toBe(0);
  });
});

describe('ölü piyasa istikrarlı sayılmaz', () => {
  it('işlem yoksa istikrar sıfırdır — oynaklık düşük olsa bile', () => {
    const olu = marketHealthScore({ ...healthy, tradeCount: 0, priceVolatility: 0 });
    expect(olu.components.stability).toBe(0);
  });

  it('işlem varsa oynaklık normal ölçülür', () => {
    const canli = marketHealthScore({ ...healthy, tradeCount: 5, priceVolatility: 0 });
    expect(canli.components.stability).toBe(1);
  });
});

describe('müdahale bantları (madde 30)', () => {
  it('eşikleri doğru sınıflar', () => {
    expect(classifyBand(90)).toBe('HEALTHY');
    expect(classifyBand(75)).toBe('WATCH');    // 75 dahil değil → WATCH
    expect(classifyBand(60)).toBe('WATCH');
    expect(classifyBand(50)).toBe('ADJUST');
    expect(classifyBand(30)).toBe('STIMULATE');
    expect(classifyBand(20)).toBe('EMERGENCY'); // 20 dahil değil → EMERGENCY
    expect(classifyBand(0)).toBe('EMERGENCY');
  });

  it('HEALTHY hiçbir direktif yayınlamaz', () => {
    expect(directivesForBand('HEALTHY')).toEqual([]);
  });

  it('★ EMERGENCY önce ithalat kapısını açar (docs/07 §4.1)', () => {
    const directives = directivesForBand('EMERGENCY');
    expect(directives[0]!.lever).toBe('IMPORT_QUOTA');
    expect(directives[0]!.magnitude).toBe(1);
  });

  it('★ ithal EDİLEMEYEN üründe IMPORT_QUOTA yayınlanmaz', () => {
    // Ekmek, domates, sigara nihai tüketim ürünüdür: kota artsa da mal gelmez.
    // Boş kaldıraç yayınlamak oyuncuya yanlış bilgi vermektir.
    const acil = directivesForBand('EMERGENCY', 0, false);
    expect(acil.some((d) => d.lever === 'IMPORT_QUOTA')).toBe(false);
    expect(acil[0]!.lever).toBe('INVENTORY_TARGET');

    const canlandirma = directivesForBand('STIMULATE', 0, false);
    expect(canlandirma.some((d) => d.lever === 'IMPORT_QUOTA')).toBe(false);
    expect(canlandirma.some((d) => d.lever === 'INVESTMENT_BIAS')).toBe(true);
  });

  it('bant sertleştikçe kaldıraç sayısı artar', () => {
    const counts = (['HEALTHY', 'WATCH', 'ADJUST', 'STIMULATE', 'EMERGENCY'] as HealthBand[])
      .map((b) => directivesForBand(b).length);
    expect(counts).toEqual([0, 1, 3, 5, 5]);
    expect(counts.every((c, i) => i === 0 || c >= counts[i - 1]!)).toBe(true);
  });

  it('hiçbir direktif ±1 aralığını aşmaz', () => {
    for (const band of ['WATCH', 'ADJUST', 'STIMULATE', 'EMERGENCY'] as HealthBand[]) {
      for (const d of directivesForBand(band)) {
        expect(Math.abs(d.magnitude)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('kaldıraç çarpanı kendi sınırını aşmaz', () => {
    expect(leverMultiplier('INVENTORY_TARGET', 1)).toBeCloseTo(1.40, 6);
    expect(leverMultiplier('PRODUCTION_BIAS', 1)).toBeCloseTo(1.30, 6);
    expect(leverMultiplier('BUY_BIAS', -1)).toBeCloseTo(0.65, 6);
    // Aralık dışı büyüklük kırpılır
    expect(leverMultiplier('INVENTORY_TARGET', 5)).toBeCloseTo(1.40, 6);
  });

  it('WATCH bandı INVENTORY_TARGET için tam %10 verir', () => {
    const [d] = directivesForBand('WATCH');
    expect(leverMultiplier(d!.lever, d!.magnitude)).toBeCloseTo(1.10, 3);
  });
});

describe('histerezis (docs/07 §4)', () => {
  it('tek turluk sapma bandı değiştirmez', () => {
    const state = advanceHysteresis({ band: 'HEALTHY', streakBand: null, streakCount: 0 }, 'WATCH');
    expect(state.band).toBe('HEALTHY');
    expect(state.streakCount).toBe(1);
  });

  it('6 tur üst üste gözlemde bant değişir', () => {
    let state = { band: 'HEALTHY' as HealthBand, streakBand: null as HealthBand | null, streakCount: 0 };
    for (let i = 0; i < 5; i++) {
      state = advanceHysteresis(state, 'WATCH');
      expect(state.band).toBe('HEALTHY');
    }
    state = advanceHysteresis(state, 'WATCH');
    expect(state.band).toBe('WATCH');
    expect(state.streakCount).toBe(0);
  });

  it('araya giren farklı gözlem sayacı sıfırlar', () => {
    let state = { band: 'HEALTHY' as HealthBand, streakBand: null as HealthBand | null, streakCount: 0 };
    for (let i = 0; i < 4; i++) state = advanceHysteresis(state, 'WATCH');
    expect(state.streakCount).toBe(4);
    state = advanceHysteresis(state, 'ADJUST');
    expect(state.streakCount).toBe(1);
    expect(state.band).toBe('HEALTHY');
  });

  it('★ EMERGENCY beklemez — kriz anında histerezis atlanır', () => {
    const state = advanceHysteresis(
      { band: 'HEALTHY', streakBand: null, streakCount: 0 }, 'EMERGENCY',
    );
    expect(state.band).toBe('EMERGENCY');
  });

  it('EMERGENCY’den ÇIKIŞ histerezise tabidir — erken rahatlama olmaz', () => {
    let state = { band: 'EMERGENCY' as HealthBand, streakBand: null as HealthBand | null, streakCount: 0 };
    for (let i = 0; i < 5; i++) {
      state = advanceHysteresis(state, 'ADJUST');
      expect(state.band).toBe('EMERGENCY');
    }
    state = advanceHysteresis(state, 'ADJUST');
    expect(state.band).toBe('ADJUST');
  });

  it('geçmişi olmayan ürün gözlenen bantla başlar', () => {
    expect(advanceHysteresis(null, 'ADJUST').band).toBe('ADJUST');
  });
});

describe('alım desteği tabanı (madde 33)', () => {
  it('referansın %55i', () => {
    expect(softFloor(money(100))).toBe(money(55));
  });

  it('ED tabanın üstüne zorlayamaz — oyuncu zararı gerçektir', () => {
    const reference = money(20);
    expect(softFloor(reference)).toBeLessThan(reference);
  });
});

describe('Gini katsayısı', () => {
  it('tam eşitlikte 0', () => {
    expect(giniCoefficient([money(100), money(100), money(100)])).toBeCloseTo(0, 6);
  });

  it('tekelde 1e yaklaşır', () => {
    const values = [money(1), money(1), money(1), money(1), money(10_000)];
    expect(giniCoefficient(values)).toBeGreaterThan(0.75);
  });

  it('tek şirket varsa eşitsizlik tanımsızdır — 0 döner', () => {
    expect(giniCoefficient([money(500)])).toBe(0);
    expect(giniCoefficient([])).toBe(0);
  });

  it('sıfır ve negatif değerler elenir', () => {
    const withZeros = giniCoefficient([0n, money(100), money(200)]);
    const without = giniCoefficient([money(100), money(200)]);
    expect(withZeros).toBe(without);
  });

  it('her zaman 0..1 aralığındadır', () => {
    const g = giniCoefficient([money(1), money(999_999)]);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
  });
});

describe('★ kıtlık tavanı — mal yoksa piyasa "ayarlanmıyor"dur (R47)', () => {
  /**
   * Ölçülen: ekmek arzı talebin %21'i, stok derinliği 0,02. Satıcı, alıcı ve
   * istikrar bileşenleri tamken skor 40,3 çıkıyor ve bant ADJUST oluyordu.
   * ADJUST yatırım teşviki yayınlamaz — ED kıtlığı görüp hiçbir şey yapmadı.
   */
  const kitlik: HealthInput = {
    supply: 210, demand: 1000, sellerCount: 8, buyerCount: 12,
    inventoryDepthTicks: 0.2, priceVolatility: 0.05, tradeCount: 40,
    playerShare: 0.8, targetPlayerShare: 0.8,
    targetSellers: 6, targetBuyers: 10,
  };

  it('satıcı ve alıcı tam olsa da kıt piyasa ADJUST üstünde kalamaz', () => {
    const { score } = marketHealthScore(kitlik);
    expect(classifyBand(score)).toBe('STIMULATE');
  });

  it('STIMULATE yatırım teşviki yayınlar — kıtlık kendini düzeltebilir', () => {
    const { score } = marketHealthScore(kitlik);
    const plan = directivesForBand(classifyBand(score), 0.21, false);
    expect(plan.some((d) => d.lever === 'INVESTMENT_BIAS' && d.magnitude > 0)).toBe(true);
  });

  it('derin stoğu olan piyasa cezalandırılmaz — malı VARDIR', () => {
    // Aynı arz oranı, ama depoda 12 turluk mal duruyor.
    const { score } = marketHealthScore({ ...kitlik, inventoryDepthTicks: 12 });
    expect(score).toBeGreaterThan(marketHealthScore(kitlik).score);
    expect(classifyBand(score)).not.toBe('STIMULATE');
  });

  it('sağlıklı piyasaya tavan dokunmaz', () => {
    expect(marketHealthScore(healthy).score).toBeGreaterThan(95);
  });
});

describe('★ marj ölçeği ekonominin tasarım bandına oturur (R47)', () => {
  it('bandın altı sıfır, üstü bir', () => {
    expect(marginScore(PRICE_MARKUP_BAND.min)).toBe(0);
    expect(marginScore(PRICE_MARKUP_BAND.max)).toBe(1);
    expect(marginScore(1.0)).toBe(0);
    expect(marginScore(3.0)).toBe(1);
  });

  it('★ tohum ekonomisinin gerçek marjları terimi ayırt eder', () => {
    // Ölçülen tohum marjları: buğday 1,33 · ekmek 1,36 · kömür 1,40.
    // Eski ölçekte (2,5 katta doyum) üçü de 0,22–0,27'de sıkışıyordu.
    const bugday = marginScore(1.333), ekmek = marginScore(1.364), komur = marginScore(1.40);
    expect(komur - bugday).toBeGreaterThan(0.10);
    expect(ekmek).toBeGreaterThan(bugday);
  });
});
