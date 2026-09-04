import { describe, expect, it } from 'vitest';
import { money, qty } from '@kapital/shared';
import { standingRestock, standingSurplus } from './standing.js';

const restockBase = {
  targetQuantity: qty(400),
  freeCapacity: qty(1000),
  reference: money(15),
  freightAllowance: money(1.5),
  budget: money(100_000),
};

describe('kalıcı stok emri', () => {
  it('raf doluyken alım yapılmaz', () => {
    expect(standingRestock({ ...restockBase, onHand: qty(400) })).toBeNull();
    expect(standingRestock({ ...restockBase, onHand: qty(250) })).toBeNull(); // eşiğin üstü
  });

  it('★ eşiğin altına düşünce hedefe kadar alır', () => {
    const decision = standingRestock({ ...restockBase, onHand: qty(100) })!;
    expect(decision.quantity).toBe(qty(300));
  });

  it('teklif referansın üstünde ve navlun dahildir (R20)', () => {
    const decision = standingRestock({ ...restockBase, onHand: qty(0) })!;
    // 15 × 1,06 + 1,5 = 17,4
    expect(decision.bidPrice).toBeGreaterThan(money(15));
    expect(decision.bidPrice).toBe(money(15.9) + money(1.5));
  });

  it('★ oyuncunun tavanı türetilen fiyatı geçemez', () => {
    const decision = standingRestock({
      ...restockBase, onHand: qty(0), maxPrice: money(16),
    })!;
    expect(decision.bidPrice).toBe(money(16));
    expect(decision.reason).toContain('tavan');
  });

  it('tavan türetilenden yüksekse türetilen kullanılır — boşuna pahalı alınmaz', () => {
    const serbest = standingRestock({ ...restockBase, onHand: qty(0) })!;
    const yuksek = standingRestock({ ...restockBase, onHand: qty(0), maxPrice: money(99) })!;
    expect(yuksek.bidPrice).toBe(serbest.bidPrice);
  });

  it('depo yeri kadarını alır', () => {
    const decision = standingRestock({
      ...restockBase, onHand: qty(0), freeCapacity: qty(120),
    })!;
    expect(decision.quantity).toBe(qty(120));
  });

  it('depo doluysa alım yok', () => {
    expect(standingRestock({
      ...restockBase, onHand: qty(0), freeCapacity: qty(0),
    })).toBeNull();
  });

  it('★ nakit yetmiyorsa miktar kısılır, emir iptal edilmez', () => {
    // 17,4 ₺'den 300 birim = 5.220 ₺; bütçe 1.000 ₺ → ~57 birim
    const decision = standingRestock({
      ...restockBase, onHand: qty(100), budget: money(1_000),
    })!;
    expect(decision.quantity).toBeGreaterThan(0n);
    expect(decision.quantity).toBeLessThan(qty(300));
  });

  it('★ nakit sıfırsa alım yok — kalıcı emir oyuncuyu batıramaz', () => {
    expect(standingRestock({
      ...restockBase, onHand: qty(0), budget: money(0),
    })).toBeNull();
  });

  it('tetik oranı ayarlanabilir', () => {
    // %90 eşikle 350 birim bile alım tetikler
    expect(standingRestock({
      ...restockBase, onHand: qty(350), triggerRatio: 0.9,
    })).not.toBeNull();
  });
});

describe('kalıcı fazla satış emri', () => {
  const surplusBase = {
    targetQuantity: qty(200),
    unitCost: money(10),
    reference: money(15),
  };

  it('fazla yoksa satış yok', () => {
    expect(standingSurplus({ ...surplusBase, onHand: qty(200) })).toBeNull();
    expect(standingSurplus({ ...surplusBase, onHand: qty(50) })).toBeNull();
  });

  it('hedefin üstündeki fazlayı satar', () => {
    const decision = standingSurplus({ ...surplusBase, onHand: qty(500) })!;
    expect(decision.quantity).toBe(qty(300));
  });

  it('★ maliyetin altına satılmaz — kalıcı emir zarar ettiremez', () => {
    const decision = standingSurplus({
      ...surplusBase, onHand: qty(500), unitCost: money(30), reference: money(15),
    })!;
    expect(decision.askPrice).toBeGreaterThan(money(30));
  });

  it('referans maliyetin üstündeyse referans kullanılır', () => {
    const decision = standingSurplus({ ...surplusBase, onHand: qty(500) })!;
    expect(decision.askPrice).toBe(money(15)); // 10×1,15=11,5 < 15
  });

  it('★ oyuncunun tabanı her ikisini de aşabilir — mal beklemek onun kararı', () => {
    const decision = standingSurplus({
      ...surplusBase, onHand: qty(500), minPrice: money(40),
    })!;
    expect(decision.askPrice).toBe(money(40));
    expect(decision.reason).toContain('taban');
  });
});
