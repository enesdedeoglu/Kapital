import type { Sql } from '@kapital/db';
import { NotFound } from '@kapital/shared';

/**
 * Versiyonlu denge config'i — madde 47 ve R12.
 *
 * Hiçbir denge değeri koda gömülmez. Her anahtarın birden çok sürümü vardır;
 * çalışan bir tur, P0'da aldığı ANLIK GÖRÜNTÜYÜ kullanır — böylece admin
 * ortada bir değişiklik yapsa bile tur yarısı eski yarısı yeni parametreyle
 * hesaplanmaz.
 */
export interface ConfigSnapshot {
  /** Anahtar → o tur için geçerli değer. */
  values: Readonly<Record<string, unknown>>;
  /** Anahtar → kullanılan sürüm. `economic_ticks.config_version`'a yazılır. */
  versions: Readonly<Record<string, number>>;
}

/**
 * Belirli bir tur için geçerli config'i okur.
 * `effective_from_tick` gelecekteki sürümleri dışarıda bırakır.
 */
export async function loadConfigSnapshot(sql: Sql, tickSeq: bigint): Promise<ConfigSnapshot> {
  const rows = await sql<{ key: string; version: number; value: unknown }[]>`
    SELECT DISTINCT ON (key) key, version, value
    FROM game_configs
    WHERE effective_from_tick IS NULL OR effective_from_tick <= ${tickSeq}
    ORDER BY key, version DESC`;

  const values: Record<string, unknown> = {};
  const versions: Record<string, number> = {};
  for (const row of rows) {
    values[row.key] = row.value;
    versions[row.key] = row.version;
  }
  return { values, versions };
}

export function getConfig<T>(snapshot: ConfigSnapshot, key: string): T {
  const value = snapshot.values[key];
  if (value === undefined) throw new NotFound(`config anahtarı "${key}"`);
  return value as T;
}

/** Yeni sürüm ekler; eski sürüm tarihte kalır ve denetlenebilir. */
export async function publishConfig(
  sql: Sql,
  key: string,
  value: unknown,
  opts: { adminId?: string; effectiveFromTick?: bigint } = {},
): Promise<number> {
  const [row] = await sql<{ version: number }[]>`
    INSERT INTO game_configs (key, version, value, effective_from_tick, created_by)
    SELECT ${key}, COALESCE(MAX(version), 0) + 1, ${JSON.stringify(value)}::text::jsonb,
           ${opts.effectiveFromTick ?? null}, ${opts.adminId ?? null}::uuid
    FROM game_configs WHERE key = ${key}
    RETURNING version`;
  return row!.version;
}

/* --- Tipli config şekilleri: anahtar başına ne beklendiği tek yerde --- */
export interface StartConfig { cash: string; level: number; facilityChoices: string[] }
export interface CalendarConfig {
  tickMinutes: number; ticksPerDay: number; ticksPerSeason: number; ticksPerYear: number;
}
export interface PricingConfig {
  emaAlpha: number; trimLowPct: number; trimHighPct: number;
  shockClampPct: number; referenceWindowTicks: number;
}
export interface FxConfig {
  rate0: number; alpha: number; tradeBalanceK: number; spreadPct: number;
  clampPerTick: number; clampPerDay: number; unlockLevel: number;
}
export const CONFIG_KEYS = {
  start: 'economy.start',
  calendar: 'economy.calendar',
  retail: 'economy.retail',
  pricing: 'economy.pricing',
  shipping: 'economy.shipping',
  fx: 'economy.fx',
  foreign: 'economy.foreign',
  inventory: 'economy.inventory',
  directorBands: 'director.bands',
  directorLevers: 'director.levers',
  healthWeights: 'health.weights',
  npcPopulation: 'npc.population',
  npcInventory: 'npc.inventory',
} as const;
