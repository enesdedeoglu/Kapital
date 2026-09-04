/**
 * Dünya olayı üretimi ve etkilerinin çözülmesi.
 *
 * Saf çekirdek (ADR-0003): rastgelelik enjekte edilir, zaman `tick.seq`tir.
 * Aynı tohum aynı dünyayı üretir — denge koşuları tekrarlanabilir olmalı.
 */
import { WORLD_EVENTS, type EventScope, type WorldEventTemplate } from './catalog.js';

export interface EventGeneratorConfig {
  /** Bir turda yeni olay çıkma olasılığı. */
  readonly chancePerTick: number;
  /** Aynı anda yürürlükte olabilecek en fazla olay. */
  readonly maxConcurrent: number;
  /** Aynı olay kodu bitince kaç tur tekrar çıkamaz. */
  readonly cooldownTicks: number;
}

export const DEFAULT_EVENT_CONFIG: EventGeneratorConfig = {
  chancePerTick: 0.012, maxConcurrent: 3, cooldownTicks: 288,
};

export interface RolledEvent {
  readonly template: WorldEventTemplate;
  readonly durationTicks: number;
  /** PRODUCT kapsamında seçilen ürün, CITY kapsamında seçilen şehir. */
  readonly productCode?: string;
  readonly cityIndex?: number;
}

export interface RollInput {
  readonly rng: () => number;
  readonly activeCount: number;
  /** Kod → o kodun en son bittiği tur. Soğuma penceresi için. */
  readonly lastEndedByCode: ReadonlyMap<string, bigint>;
  readonly tickSeq: bigint;
  /** PRODUCT kapsamı için seçilebilecek ürün kodları. */
  readonly productCodes: readonly string[];
  /** CITY kapsamı için şehir sayısı. */
  readonly cityCount: number;
  readonly config?: EventGeneratorConfig;
}

/**
 * Bu turda yeni bir olay çıkar mı, çıkarsa hangisi?
 *
 * ★ Zar HER ZAMAN atılır, eleme sonra yapılır. Önce "yer var mı" diye bakıp
 * zarı atlamak, RNG dizisini dünyanın durumuna bağlar ve aynı tohumun aynı
 * sonucu vermesini bozar (ADR-0003).
 */
export function rollWorldEvent(input: RollInput): RolledEvent | null {
  const config = input.config ?? DEFAULT_EVENT_CONFIG;
  const roll = input.rng();
  const pick = input.rng();
  const durationRoll = input.rng();
  const scopeRoll = input.rng();

  if (roll >= config.chancePerTick) return null;
  if (input.activeCount >= config.maxConcurrent) return null;

  // Soğumadaki olaylar havuz dışıdır.
  const available = WORLD_EVENTS.filter((template) => {
    const ended = input.lastEndedByCode.get(template.code);
    if (ended !== undefined && input.tickSeq - ended < BigInt(config.cooldownTicks)) return false;
    if (template.scope === 'PRODUCT') return applicableProducts(template, input.productCodes).length > 0;
    if (template.scope === 'CITY') return input.cityCount > 0;
    return true;
  });
  if (available.length === 0) return null;

  const template = weightedPick(available, pick);
  if (!template) return null;

  const span = template.maxTicks - template.minTicks;
  const durationTicks = template.minTicks + Math.floor(durationRoll * (span + 1));

  if (template.scope === 'PRODUCT') {
    const products = applicableProducts(template, input.productCodes);
    return {
      template, durationTicks,
      productCode: products[Math.floor(scopeRoll * products.length)],
    };
  }
  if (template.scope === 'CITY') {
    return { template, durationTicks, cityIndex: Math.floor(scopeRoll * input.cityCount) };
  }
  return { template, durationTicks };
}

function applicableProducts(
  template: WorldEventTemplate, productCodes: readonly string[],
): string[] {
  if (!template.productCodes || template.productCodes.length === 0) return [...productCodes];
  return template.productCodes.filter((code) => productCodes.includes(code));
}

function weightedPick(
  templates: readonly WorldEventTemplate[], roll: number,
): WorldEventTemplate | null {
  const total = templates.reduce((sum, t) => sum + t.weight, 0);
  if (total <= 0) return null;
  let threshold = roll * total;
  for (const template of templates) {
    threshold -= template.weight;
    if (threshold < 0) return template;
  }
  return templates[templates.length - 1] ?? null;
}

/* ------------------------------------------------------------------ */

export interface ActiveEvent {
  readonly scope: EventScope;
  readonly productId: number | null;
  readonly cityId: number | null;
  readonly category: string | null;
  readonly demandMultiplier: number;
  readonly supplyMultiplier: number;
  readonly costMultiplier: number;
}

export interface EventMultipliers {
  readonly demand: number;
  readonly supply: number;
  readonly cost: number;
}

export const NEUTRAL_MULTIPLIERS: EventMultipliers = { demand: 1, supply: 1, cost: 1 };

export interface EffectTarget {
  readonly productId?: number;
  readonly cityId?: number;
  /** Tesis kategorisi (üretim için) veya ürün kategorisi (talep için). */
  readonly category?: string;
}

/**
 * Bir hedefe uygulanan toplam çarpanlar.
 *
 * Olaylar ÇARPILARAK birikir: kuraklık (arz ×0,55) ile enerji krizi
 * (maliyet ×1,45) aynı anda yürürlükte olabilir ve ikisi de geçerlidir.
 * Toplama yapılsaydı iki olumsuz olay birbirini kısmen götürürdü.
 */
export function eventMultipliersFor(
  events: readonly ActiveEvent[], target: EffectTarget,
): EventMultipliers {
  let demand = 1;
  let supply = 1;
  let cost = 1;

  for (const event of events) {
    if (!applies(event, target)) continue;
    demand *= event.demandMultiplier;
    supply *= event.supplyMultiplier;
    cost *= event.costMultiplier;
  }
  return { demand, supply, cost };
}

function applies(event: ActiveEvent, target: EffectTarget): boolean {
  switch (event.scope) {
    case 'GLOBAL':
      return true;
    case 'PRODUCT':
      return event.productId !== null && event.productId === target.productId;
    case 'CITY':
      return event.cityId !== null && event.cityId === target.cityId;
    case 'SECTOR':
      return event.category !== null && event.category === target.category;
  }
}
