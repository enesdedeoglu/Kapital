import { describe, expect, it } from 'vitest';
import { money, qty } from '@kapital/shared';
import {
  experienceGain, nextLevel, DEFAULT_EXPERIENCE_RATES,
  type CompanyProgress, type LevelRequirement,
} from './progression.js';

const bosFaaliyet = {
  retailRevenue: money(0), tradeVolume: money(0),
  unitsProduced: qty(0), facilitiesBuilt: 0,
};

describe('deneyim kazanımı (madde 11)', () => {
  it('faaliyet yoksa deneyim yok', () => {
    expect(experienceGain(bosFaaliyet)).toBe(0);
  });

  it('perakende cirosu deneyim üretir', () => {
    // 100 ₺ = 1 XP
    expect(experienceGain({ ...bosFaaliyet, retailRevenue: money(5_000) })).toBe(50);
  });

  it('toptan ticaret perakendeden daha az XP verir — asıl iş satıştır', () => {
    const perakende = experienceGain({ ...bosFaaliyet, retailRevenue: money(10_000) });
    const toptan = experienceGain({ ...bosFaaliyet, tradeVolume: money(10_000) });
    expect(toptan).toBeLessThan(perakende);
  });

  it('üretim ve tesis kurma da sayılır', () => {
    expect(experienceGain({ ...bosFaaliyet, unitsProduced: qty(500) })).toBe(50);
    expect(experienceGain({ ...bosFaaliyet, facilitiesBuilt: 2 })).toBe(200);
  });

  it('kalemler toplanır ve aşağı yuvarlanır', () => {
    const gain = experienceGain({
      retailRevenue: money(250), tradeVolume: money(250),
      unitsProduced: qty(5), facilitiesBuilt: 0,
    });
    // 2,5 + 1,25 + 0,5 = 4,25 → 4
    expect(gain).toBe(4);
  });

  it('oranlar config ile değiştirilebilir', () => {
    const cömert = { ...DEFAULT_EXPERIENCE_RATES, retailPerXp: 10 };
    expect(experienceGain({ ...bosFaaliyet, retailRevenue: money(1_000) }, cömert)).toBe(100);
  });

  it('★ aktif bir oyuncunun ilk günü Lv2 şartına (700 XP) yaklaşır', () => {
    // Onboarding zinciri 7 adımda tam 700 XP verir (docs/08). Sürekli oyunun
    // da benzer büyüklükte olması gerekir, yoksa iki yol tutarsız olur.
    const ilkGun = experienceGain({
      retailRevenue: money(40_000), tradeVolume: money(20_000),
      unitsProduced: qty(0), facilitiesBuilt: 2,
    });
    expect(ilkGun).toBeGreaterThan(500);
    expect(ilkGun).toBeLessThan(900);
  });
});

describe('seviye atlama', () => {
  const requirements: LevelRequirement[] = [
    { level: 1, requiredXp: 0n, requiredCompanyValue: 0n, requiredTradeVolume: 0n,
      requiredUnitsProduced: 0n, requiredDistinctProducts: 0 },
    { level: 2, requiredXp: 700n, requiredCompanyValue: money(45_000),
      requiredTradeVolume: money(15_000), requiredUnitsProduced: 0n, requiredDistinctProducts: 1 },
    { level: 3, requiredXp: 2000n, requiredCompanyValue: money(80_000),
      requiredTradeVolume: money(60_000), requiredUnitsProduced: 0n, requiredDistinctProducts: 1 },
  ];

  const hazir: CompanyProgress = {
    level: 1, experience: 700n, companyValue: money(45_000),
    tradeVolume: money(15_000), unitsProduced: 0n, distinctProducts: 1,
  };

  it('tüm şartlar sağlanırsa seviye atlanır', () => {
    expect(nextLevel(hazir, requirements)).toBe(2);
  });

  it('★ tek bir şart eksikse atlanmaz — sadece XP toplamak yetmez', () => {
    expect(nextLevel({ ...hazir, companyValue: money(44_999) }, requirements)).toBe(1);
    expect(nextLevel({ ...hazir, tradeVolume: money(14_999) }, requirements)).toBe(1);
    expect(nextLevel({ ...hazir, distinctProducts: 0 }, requirements)).toBe(1);
    expect(nextLevel({ ...hazir, experience: 699n }, requirements)).toBe(1);
  });

  it('şartlar fazlasıyla sağlanırsa birden çok seviye atlanabilir', () => {
    const zengin: CompanyProgress = {
      level: 1, experience: 5000n, companyValue: money(200_000),
      tradeVolume: money(100_000), unitsProduced: 0n, distinctProducts: 3,
    };
    expect(nextLevel(zengin, requirements)).toBe(3);
  });

  it('seviye asla düşmez', () => {
    const dusmus: CompanyProgress = {
      level: 3, experience: 0n, companyValue: 0n,
      tradeVolume: 0n, unitsProduced: 0n, distinctProducts: 0,
    };
    expect(nextLevel(dusmus, requirements)).toBe(3);
  });

  it('sıra atlanmaz: Lv2 sağlanmadan Lv3 verilmez', () => {
    // XP ve değer Lv3'e yeter ama ticaret hacmi Lv2'yi karşılamıyor.
    const carpik: CompanyProgress = {
      level: 1, experience: 2000n, companyValue: money(80_000),
      tradeVolume: money(10_000), unitsProduced: 0n, distinctProducts: 1,
    };
    expect(nextLevel(carpik, requirements)).toBe(1);
  });
});
