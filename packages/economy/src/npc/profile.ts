/** NPC arketipleri — madde 24. Hepsi aynı davranmaz. */
export type NpcArchetype =
  | 'DISCOUNTER' | 'PREMIUM' | 'VOLUME' | 'SPECULATOR'
  | 'AGRI' | 'INDUSTRIAL' | 'ELECTRONICS' | 'RETAIL_CHAIN';

export interface ArchetypeTemplate {
  readonly archetype: NpcArchetype;
  readonly name: string;
  readonly role: string;
  readonly riskTolerance: number;
  readonly targetMargin: number;
  readonly qualityTarget: number;
  readonly inventoryTargetTicks: number;
  /** 0 = maliyet+marj · 1 = tamamen piyasa takibi. */
  readonly priceAggressiveness: number;
  readonly investmentAggressiveness: number;
  readonly maxDebtRatio: number;
  readonly cashReserveRatio: number;
  readonly strategyIntervalTicks: number;
}

/**
 * Arketip şablonları — docs/07 §9.
 *
 * Amaç NPC'lerin oyuncuları yenmesi DEĞİL, piyasaya likidite sağlaması ve
 * fiyat oluşumuna zemin hazırlamasıdır (madde 25). Bu yüzden karakterler
 * birbirini tamamlar: ucuzcu tabanı, premium tavanı, spekülatör arbitrajı
 * kapatır, hacimci likiditeyi taşır.
 */
export const ARCHETYPES: readonly ArchetypeTemplate[] = [
  { archetype: 'DISCOUNTER', name: 'Ucuzcu', role: 'fiyat tabanı oluşturur',
    riskTolerance: 0.35, targetMargin: 0.08, qualityTarget: 45, inventoryTargetTicks: 10,
    priceAggressiveness: 0.85, investmentAggressiveness: 0.35, maxDebtRatio: 0.55, cashReserveRatio: 0.10,
    strategyIntervalTicks: 96 },
  { archetype: 'PREMIUM', name: 'Premium Üretici', role: 'kalite tavanı oluşturur',
    riskTolerance: 0.25, targetMargin: 0.35, qualityTarget: 88, inventoryTargetTicks: 14,
    priceAggressiveness: 0.25, investmentAggressiveness: 0.30, maxDebtRatio: 0.35, cashReserveRatio: 0.25,
    strategyIntervalTicks: 128 },
  { archetype: 'VOLUME', name: 'Hacimci', role: 'likidite hacmi',
    riskTolerance: 0.50, targetMargin: 0.12, qualityTarget: 60, inventoryTargetTicks: 16,
    priceAggressiveness: 0.65, investmentAggressiveness: 0.55, maxDebtRatio: 0.60, cashReserveRatio: 0.12,
    strategyIntervalTicks: 96 },
  { archetype: 'SPECULATOR', name: 'Spekülatör', role: 'volatilite ve arbitraj',
    riskTolerance: 0.85, targetMargin: 0.45, qualityTarget: 55, inventoryTargetTicks: 20,
    priceAggressiveness: 0.90, investmentAggressiveness: 0.70, maxDebtRatio: 0.70, cashReserveRatio: 0.08,
    strategyIntervalTicks: 48 },
  { archetype: 'AGRI', name: 'Tarım Şirketi', role: 'hammadde arzı',
    riskTolerance: 0.30, targetMargin: 0.18, qualityTarget: 70, inventoryTargetTicks: 12,
    priceAggressiveness: 0.45, investmentAggressiveness: 0.40, maxDebtRatio: 0.45, cashReserveRatio: 0.18,
    strategyIntervalTicks: 96 },
  { archetype: 'INDUSTRIAL', name: 'Sanayi Holdingi', role: 'ara ürün arzı',
    riskTolerance: 0.40, targetMargin: 0.22, qualityTarget: 72, inventoryTargetTicks: 14,
    priceAggressiveness: 0.40, investmentAggressiveness: 0.50, maxDebtRatio: 0.50, cashReserveRatio: 0.20,
    strategyIntervalTicks: 128 },
  { archetype: 'ELECTRONICS', name: 'Elektronik Şirketi', role: 'üst zincir arzı',
    riskTolerance: 0.45, targetMargin: 0.28, qualityTarget: 82, inventoryTargetTicks: 12,
    priceAggressiveness: 0.35, investmentAggressiveness: 0.45, maxDebtRatio: 0.45, cashReserveRatio: 0.22,
    strategyIntervalTicks: 128 },
  { archetype: 'RETAIL_CHAIN', name: 'Perakende Zinciri', role: 'perakende rekabeti',
    riskTolerance: 0.35, targetMargin: 0.20, qualityTarget: 65, inventoryTargetTicks: 8,
    priceAggressiveness: 0.55, investmentAggressiveness: 0.45, maxDebtRatio: 0.50, cashReserveRatio: 0.15,
    strategyIntervalTicks: 96 },
];

/**
 * Arketip parametrelerini ±%15 dağıtır — 60 NPC'nin hiçbiri aynı olmasın.
 * Deterministiktir: aynı tohum aynı karakteri verir.
 */
export function varyTemplate(
  template: ArchetypeTemplate, rng: () => number, spread = 0.15,
): ArchetypeTemplate {
  const jitter = (value: number, min = 0, max = Number.POSITIVE_INFINITY) => {
    const factor = 1 + (rng() * 2 - 1) * spread;
    return Math.max(min, Math.min(max, value * factor));
  };
  return {
    ...template,
    riskTolerance: jitter(template.riskTolerance, 0.05, 1),
    targetMargin: jitter(template.targetMargin, 0.02, 2),
    qualityTarget: jitter(template.qualityTarget, 10, 100),
    inventoryTargetTicks: Math.max(4, Math.round(jitter(template.inventoryTargetTicks, 4, 24))),
    priceAggressiveness: jitter(template.priceAggressiveness, 0, 1),
    investmentAggressiveness: jitter(template.investmentAggressiveness, 0, 1),
    maxDebtRatio: jitter(template.maxDebtRatio, 0.1, 0.9),
    cashReserveRatio: jitter(template.cashReserveRatio, 0.05, 0.5),
  };
}
