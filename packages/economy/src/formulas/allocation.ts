import {
  asQty, mulQty, priceTimesQty, QTY_SCALE, ZERO_MONEY, ZERO_QTY,
  type Money, type Qty,
} from '@kapital/shared';
import type { CityDemand, RetailAllocation, RetailOutcome, ScoredOffer } from '../types.js';

const min = (...values: bigint[]): bigint => values.reduce((a, b) => (a < b ? a : b));

/** Verilen bütçeyle bu fiyattan kaç birim alınabilir (aşağı yuvarlar). */
export function affordableUnits(budget: Money, unitPrice: Money): Qty {
  if (unitPrice <= 0n || budget <= 0n) return ZERO_QTY;
  return asQty((budget * QTY_SCALE) / unitPrice);
}

/**
 * Pazar payı ve satış dağıtımı — madde 21 + R1 azaltımı.
 *
 *   market_share = çekicilik_i / Σ çekicilik
 *   satış_i      = min(talep × pay, stok, bütçenin karşıladığı miktar)
 *
 * Karşılanmayan talep kalan mağazalara YENİDEN DAĞITILIR ama **sabit tur
 * sayısıyla**: naif "stok bitene kadar döngü" mağaza sayısı arttıkça O(n²)
 * olur ve faz süresini patlatır (R1). Turlar bitince kalan talep karşılanmaz
 * — bu bir hata değil, "şehirde mal yok" sinyalidir.
 *
 * Bütçe bağlayıcı olduğunda en çekici mağaza önce hizmet alır: tüketici
 * parası bittiğinde en cazip rafı tercih etmiş olur.
 */
export function allocateRetail(input: {
  demand: CityDemand;
  offers: readonly ScoredOffer[];
  maxRounds?: number;
}): RetailOutcome {
  const maxRounds = input.maxRounds ?? 3;
  const { units: totalDemand, budget: totalBudget } = input.demand;

  if (totalDemand <= 0n || input.offers.length === 0) {
    return {
      allocations: [], soldUnits: ZERO_QTY, revenue: ZERO_MONEY,
      unmetUnits: totalDemand, budgetLimitedUnits: ZERO_QTY, roundsUsed: 0,
    };
  }

  const stockLeft = new Map<string, bigint>(
    input.offers.map((o) => [o.facilityId, o.availableStock as bigint]),
  );
  const sold = new Map<string, { units: bigint; revenue: bigint; offer: ScoredOffer }>();

  let remainingUnits = totalDemand as bigint;
  let remainingBudget = totalBudget as bigint;
  let budgetLimited = 0n;
  let roundsUsed = 0;

  for (let round = 0; round < maxRounds; round++) {
    if (remainingUnits <= 0n || remainingBudget <= 0n) break;

    const eligible = input.offers.filter(
      (o) => o.attractiveness > 0 && (stockLeft.get(o.facilityId) ?? 0n) > 0n,
    );
    if (eligible.length === 0) break;
    roundsUsed = round + 1;

    const totalAttr = eligible.reduce((sum, o) => sum + o.attractiveness, 0);
    if (!(totalAttr > 0)) break;

    // Pay hesabı tur başındaki talebe göre sabittir; aksi halde sıradaki
    // mağazalar hak ettiklerinden az alır.
    const roundDemand = remainingUnits;
    const ordered = [...eligible].sort((a, b) => b.attractiveness - a.attractiveness);

    for (const offer of ordered) {
      if (remainingUnits <= 0n || remainingBudget <= 0n) break;

      const share = offer.attractiveness / totalAttr;
      const want = mulQty(asQty(roundDemand), share).value as bigint;
      const stock = stockLeft.get(offer.facilityId) ?? 0n;
      const wantedNow = min(want, stock, remainingUnits);
      if (wantedNow <= 0n) continue;

      const affordable = affordableUnits(remainingBudget as Money, offer.sellingPrice) as bigint;
      const take = min(wantedNow, affordable);
      if (take <= 0n) {
        budgetLimited += wantedNow;
        continue;
      }
      if (take < wantedNow) budgetLimited += wantedNow - take;

      const revenue = priceTimesQty(offer.sellingPrice, asQty(take)).value as bigint;
      const prev = sold.get(offer.facilityId);
      sold.set(offer.facilityId, {
        units: (prev?.units ?? 0n) + take,
        revenue: (prev?.revenue ?? 0n) + revenue,
        offer,
      });

      stockLeft.set(offer.facilityId, stock - take);
      remainingUnits -= take;
      remainingBudget -= revenue;
    }
  }

  const allocations: RetailAllocation[] = [];
  let soldUnits = 0n;
  let revenue = 0n;
  for (const entry of sold.values()) {
    soldUnits += entry.units;
    revenue += entry.revenue;
    allocations.push({
      facilityId: entry.offer.facilityId,
      companyId: entry.offer.companyId,
      units: asQty(entry.units),
      revenue: entry.revenue as Money,
      unitPrice: entry.offer.sellingPrice,
      marketShare: Number(entry.units) / Number(totalDemand),
    });
  }
  allocations.sort((a, b) => (b.units > a.units ? 1 : b.units < a.units ? -1 : 0));

  return {
    allocations,
    soldUnits: asQty(soldUnits),
    revenue: revenue as Money,
    unmetUnits: asQty(remainingUnits),
    budgetLimitedUnits: asQty(budgetLimited),
    roundsUsed,
  };
}
