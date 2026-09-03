import { describe, expect, it } from 'vitest';
import { validateProductGraph, type GraphProduct, type GraphRecipe } from '@kapital/economy';
import { companyLevels, facilityTypes, products, recipes } from './data.js';

/**
 * Tohum verisi doğrulaması.
 *
 * `validateProductGraph` (I8 / R13) her zaman vardı ama yalnızca admin panelden
 * girilen reçetelere uygulanıyordu; TOHUM verisine kimse uygulamamıştı. Sonuç:
 * FURNITURE tanımlıydı, perakende ürünüydü, referans fiyatı vardı — ama onu
 * üretecek ne bir tesis tipi ne bir reçete vardı. Çelik fabrikaları üretim
 * yapıyor, çeliği kimse almıyor, deposu doluyor ve üretim duruyordu.
 *
 * Bu dosya doğrulayıcıyı tohumun kendisine bağlar: eksik uçlu bir zincir artık
 * CI'da düşer.
 */
describe('tohum verisi ürün grafı (I8)', () => {
  const graphProducts: GraphProduct[] = products.map((p) => ({
    id: p.id, code: p.code, unlockLevel: p.unlock,
    isRawMaterial: p.raw, isRetailProduct: p.retail,
  }));

  const byFacility = new Map(facilityTypes.map((f) => [f.code, f]));
  const productIdByCode = new Map(products.map((p) => [p.code, p.id]));

  const graphRecipes: GraphRecipe[] = recipes.map((r, index) => ({
    recipeId: index + 1,
    facilityTypeCode: r.facilityCode,
    outputProductId: productIdByCode.get(r.outputCode)!,
    unlockLevel: r.unlock,
    inputProductIds: r.inputs.map((i) => productIdByCode.get(i.code)!),
  }));

  it('graf geçerlidir: döngü, ulaşılamaz ürün veya kilit sırası hatası yok', () => {
    const report = validateProductGraph(graphRecipes, graphProducts);
    expect(report.issues.map((i) => i.message)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('her reçetenin tesis tipi tanımlıdır', () => {
    for (const recipe of recipes) {
      expect(byFacility.has(recipe.facilityCode), `${recipe.facilityCode} tanımsız`).toBe(true);
    }
  });

  it('her reçetenin girdi ve çıktı ürünleri tanımlıdır', () => {
    for (const recipe of recipes) {
      expect(productIdByCode.has(recipe.outputCode), `${recipe.outputCode} tanımsız`).toBe(true);
      for (const input of recipe.inputs) {
        expect(productIdByCode.has(input.code), `${input.code} tanımsız`).toBe(true);
      }
    }
  });

  it('üretim kapasitesi olan her tesis tipinin bir reçetesi vardır', () => {
    // Kapasitesi 0 olanlar perakende/lojistiktir: üretmezler.
    const withRecipe = new Set(recipes.map((r) => r.facilityCode));
    for (const facility of facilityTypes) {
      if (facility.capacity <= 0) continue;
      expect(withRecipe.has(facility.code), `${facility.code} üretebiliyor ama reçetesi yok`).toBe(true);
    }
  });

  /**
   * Referans fiyat ile üretim maliyeti tutarlı olmalıdır.
   *
   * Referans fiyat bir tasarım sabiti değil, fiyat keşfinin BAŞLANGIÇ ÇIPASIdır.
   * Çıpa maliyetle tutarsızsa piyasa yüzlerce tur boyunca doğru fiyata yürür ve
   * bu yürüyüş enflasyon/deflasyon gibi görünür. Ölçülen örnek: sigara referansı
   * 80 ₺ iken tarif maliyeti 1,95 ₺ idi; 500 turluk koşuda sigara 5,06 ₺'ye indi
   * ve Game CPI'yı tek başına 1,00'dan 0,53'e çekti.
   *
   * Bant: her aşama maliyetin 1,15–1,75 katına satmalı. Altı zarar, üstü ise
   * piyasanın hemen aşağı çekeceği yapay bir çıpadır.
   */
  it('referans fiyat üretim maliyetiyle tutarlıdır (marj bandı 1,15–1,75)', () => {
    const price = new Map(products.map((p) => [p.code, p.price]));
    const report: string[] = [];
    for (const recipe of recipes) {
      const inputCost = recipe.inputs.reduce(
        (sum, i) => sum + (price.get(i.code) ?? 0) * i.qty, 0,
      );
      const unitCost = (inputCost + recipe.labor + recipe.energy) / recipe.outputQty;
      const markup = price.get(recipe.outputCode)! / unitCost;
      if (markup < 1.15 || markup > 1.75) {
        report.push(`${recipe.outputCode}: marj ${markup.toFixed(2)} (maliyet ${unitCost.toFixed(2)})`);
      }
    }
    expect(report).toEqual([]);
  });
});

/**
 * Seviye merdiveni tırmanabilir olmalı.
 *
 * Bir seviyenin şartı, o seviyeye gelene kadar YAPILABİLECEK şeylerle
 * sınırlıdır. İlk tasarımda değildi: Lv2 "1 farklı ürün üret" istiyor, ama en
 * düşük üretim tesisi Lv4'te açılıyordu. Hiçbir oyuncu seviye 1'i geçemiyordu
 * ve bu ancak F8 simülasyonunda görüldü — 200 turda 184 LEVEL_LOCKED reddi.
 */
describe('seviye merdiveni tırmanabilir (madde 11)', () => {
  const producibleAt = (level: number) => {
    const facilityUnlock = new Map(facilityTypes.map((f) => [f.code, f.unlock]));
    return new Set(
      recipes
        .filter((r) => (facilityUnlock.get(r.facilityCode) ?? 99) <= level && r.unlock <= level)
        .map((r) => r.outputCode),
    ).size;
  };

  it('★ hiçbir seviye, önceki seviyede üretilemeyecek kadar ürün istemez', () => {
    const deadlocks: string[] = [];
    for (const level of companyLevels) {
      if (level.level === 1) continue;
      const available = producibleAt(level.level - 1);
      if (level.products > available) {
        deadlocks.push(
          `Lv${level.level}: ${level.products} farklı ürün istiyor, ` +
          `Lv${level.level - 1}'de ${available} üretilebiliyor`,
        );
      }
    }
    expect(deadlocks).toEqual([]);
  });

  it('üretim şartı olan seviyede en az bir üretim tesisi açılmış olmalı', () => {
    for (const level of companyLevels) {
      if (level.units <= 0) continue;
      expect(producibleAt(level.level - 1), `Lv${level.level}`).toBeGreaterThan(0);
    }
  });

  it('şartlar seviyeyle birlikte artar — merdiven geriye gitmez', () => {
    for (let i = 1; i < companyLevels.length; i++) {
      const prev = companyLevels[i - 1]!;
      const cur = companyLevels[i]!;
      expect(cur.xp, `Lv${cur.level} xp`).toBeGreaterThan(prev.xp);
      expect(cur.value, `Lv${cur.level} değer`).toBeGreaterThan(prev.value);
      expect(cur.products, `Lv${cur.level} ürün`).toBeGreaterThanOrEqual(prev.products);
      expect(cur.units, `Lv${cur.level} üretim`).toBeGreaterThanOrEqual(prev.units);
    }
  });
});
