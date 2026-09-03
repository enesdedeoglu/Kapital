import { describe, expect, it } from 'vitest';
import { money } from '@kapital/shared';
import {
  actsThisTick, allocatePopulation, canInvest, PLAYER_PROFILES, profileShareSum,
  retailPrice, tradeAsk, tradeBid, type PlayerProfile,
} from './profiles.js';

const byCode = (code: string) => PLAYER_PROFILES.find((p) => p.code === code)!;

describe('profil nüfusu', () => {
  it('payların toplamı tam 1,0', () => {
    expect(profileShareSum()).toBeCloseTo(1, 10);
  });

  it('sekiz profil tanımlı ve kodları benzersiz', () => {
    expect(PLAYER_PROFILES).toHaveLength(8);
    expect(new Set(PLAYER_PROFILES.map((p) => p.code)).size).toBe(8);
  });

  it('nüfus tam bölünür — artık kaybolmaz', () => {
    for (const total of [10, 37, 100, 1000, 4321]) {
      const counts = allocatePopulation(total);
      const sum = [...counts.values()].reduce((a, b) => a + b, 0);
      expect(sum, `toplam ${total}`).toBe(total);
    }
  });

  it('büyük payları olan profiller daha kalabalık', () => {
    const counts = allocatePopulation(1000);
    expect(counts.get('PASSIVE')!).toBeGreaterThan(counts.get('SPECULATOR')!);
  });
});

describe('karar zamanlaması', () => {
  it('profilin aralığına uyar', () => {
    const retailer = byCode('RETAILER'); // her 8 turda
    let acted = 0;
    for (let t = 0; t < 80; t++) if (actsThisTick(retailer, 0, BigInt(t))) acted++;
    expect(acted).toBe(10);
  });

  it('★ aynı profildeki oyuncular aynı turda toplu hareket etmez', () => {
    const retailer = byCode('RETAILER');
    // Tek bir turda kaç oyuncu hareket ediyor? Kaydırma olmasaydı hepsi.
    const actingAtTick5 = Array.from({ length: 80 }, (_, i) => i)
      .filter((i) => actsThisTick(retailer, i, 5n)).length;
    expect(actingAtTick5).toBeLessThan(80);
    expect(actingAtTick5).toBeGreaterThan(0);
  });

  it('pasif oyuncu nadiren karar verir', () => {
    const passive = byCode('PASSIVE');
    const aggressive = byCode('AGGRESSIVE_TRADER');
    expect(passive.actEveryTicks).toBeGreaterThan(aggressive.actEveryTicks * 10);
  });
});

describe('fiyatlama', () => {
  const reference = money(15);
  const unitCost = money(10);

  it('kaliteci ucuzcudan pahalı satar', () => {
    const ucuz = retailPrice(byCode('DISCOUNTER'), unitCost, reference);
    const kalite = retailPrice(byCode('QUALITY'), unitCost, reference);
    expect(kalite).toBeGreaterThan(ucuz);
  });

  it('★ piyasa fiyatı biliniyorsa ona göre konumlanır, rakibin çok üstüne çıkmaz', () => {
    const piyasa = money(16);
    for (const profile of PLAYER_PROFILES) {
      const price = retailPrice(profile, money(12), reference, piyasa);
      // En kaliteci bile piyasanın %15'inden fazla üstüne çıkmaz
      expect(price, profile.code).toBeLessThanOrEqual((piyasa * 115n) / 100n);
    }
  });

  it('piyasa çok ucuzsa yine de maliyetin altına inilmez', () => {
    const price = retailPrice(byCode('DISCOUNTER'), money(20), reference, money(10));
    expect(price).toBeGreaterThan(money(20));
  });

  it('★ hiçbir profil maliyetin altına satmaz', () => {
    for (const profile of PLAYER_PROFILES) {
      const price = retailPrice(profile, unitCost, reference);
      expect(price, profile.code).toBeGreaterThanOrEqual(unitCost);
    }
  });

  it('maliyet fırlarsa fiyat maliyeti takip eder, referansta çakılı kalmaz', () => {
    const pahali = retailPrice(byCode('DISCOUNTER'), money(100), reference);
    expect(pahali).toBeGreaterThan(money(100));
  });

  it('spekülatör düşükten alır, tüccar piyasaya yakın', () => {
    expect(tradeBid(byCode('SPECULATOR'), reference))
      .toBeLessThan(tradeBid(byCode('AGGRESSIVE_TRADER'), reference));
  });

  it('toptan satış istemi referansın altına inmez', () => {
    const ask = tradeAsk(byCode('AGGRESSIVE_TRADER'), money(5), reference);
    expect(ask).toBeGreaterThanOrEqual(reference);
  });
});

describe('yatırım kararı', () => {
  const cost = money(30_000);

  const saglikli = {
    cost, roll: 0, recentProfit: money(5_000), stockedRatio: 1, owned: 1,
  };

  it('nakit tamponu yoksa yatırım yapılmaz', () => {
    const profile = byCode('VERTICAL');
    expect(canInvest(profile, { ...saglikli, cash: money(35_000) })).toBe(false); // 1,5× gerekli
    expect(canInvest(profile, { ...saglikli, cash: money(45_000) })).toBe(true);
  });

  it('tesis kurmayan profiller hiç yatırım yapmaz', () => {
    for (const code of ['AGGRESSIVE_TRADER', 'SPECULATOR'] as const) {
      expect(canInvest(byCode(code), { ...saglikli, cash: money(1_000_000) })).toBe(false);
    }
  });

  it('★ zarar ederken yeni tesis açılmaz', () => {
    const profile = byCode('VERTICAL');
    expect(canInvest(profile, {
      ...saglikli, cash: money(1_000_000), owned: 3, recentProfit: money(-1),
    })).toBe(false);
  });

  it('★ raflar boşken yeni tesis açılmaz — sorun tesis sayısı değil tedarik', () => {
    const profile = byCode('VERTICAL');
    expect(canInvest(profile, {
      ...saglikli, cash: money(1_000_000), owned: 3, stockedRatio: 0.2,
    })).toBe(false);
  });

  it('ilk tesis kanıt istemez — oyuncu bir yerden başlamalı', () => {
    const profile = byCode('RETAILER');
    expect(canInvest(profile, {
      ...saglikli, cash: money(1_000_000), owned: 1,
      recentProfit: money(-500), stockedRatio: 0,
    })).toBe(true);
  });

  it('iştah düşükse çoğu zaman yatırım yapılmaz', () => {
    const passive = byCode('PASSIVE'); // iştah 0,05
    const denemeler = Array.from({ length: 100 }, (_, i) => i / 100)
      .filter((roll) => canInvest(passive, { ...saglikli, cash: money(1_000_000), roll }));
    expect(denemeler.length).toBe(5);
  });
});
