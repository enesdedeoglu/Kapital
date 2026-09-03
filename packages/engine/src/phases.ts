/**
 * Tick fazları — docs/05 §2.
 *
 * Madde 53'teki 25 adım, bağımlılık ve shard anahtarına göre 8 faza gruplanır.
 * F2'de 5 faz uygulanır; kalanlar kendi fazlarında gelir:
 *   P1 PRODUCE  → F3 (üretim)
 *   P2 EXCHANGE → F4 (emir defteri, sevkiyat)
 *   P6 GOVERN   → F6/F7 (NPC stratejisi, Economic Director)
 *
 * Faz numaraları baştan sabittir: yeni fazlar araya girdiğinde mevcut
 * `tick_phase_runs` kayıtları anlamını korur.
 */
export const PHASE = {
  OPEN: 0,
  PRODUCE: 1,
  EXCHANGE: 2,
  RETAIL: 3,
  UPKEEP: 4,
  SETTLE: 5,
  GOVERN: 6,
  CLOSE: 7,
} as const;

export type PhaseNumber = (typeof PHASE)[keyof typeof PHASE];

export interface PhaseDefinition {
  readonly phase: PhaseNumber;
  readonly code: string;
  /** Shard anahtarı — çakışma yüzeyine göre seçilir (ADR-0005). */
  readonly shardKey: 'none' | 'company' | 'product' | 'city';
  /** docs/05 §4 süre bütçesi (ms). Aşımda alarm. */
  readonly budgetMs: number;
}

/** F2'de koşan fazlar, sırayla. Sıra atlanamaz. */
export const ACTIVE_PHASES: readonly PhaseDefinition[] = [
  { phase: PHASE.OPEN,   code: 'OPEN',   shardKey: 'none',    budgetMs: 1_000 },
  { phase: PHASE.RETAIL, code: 'RETAIL', shardKey: 'city',    budgetMs: 15_000 },
  { phase: PHASE.UPKEEP, code: 'UPKEEP', shardKey: 'company', budgetMs: 8_000 },
  { phase: PHASE.SETTLE, code: 'SETTLE', shardKey: 'company', budgetMs: 10_000 },
  { phase: PHASE.CLOSE,  code: 'CLOSE',  shardKey: 'none',    budgetMs: 3_000 },
];
