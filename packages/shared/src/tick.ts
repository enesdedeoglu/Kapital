/**
 * Oyun takvimi — docs/00 §5.
 * İş mantığında `Date.now()` KULLANILMAZ; tek zaman kaynağı tick sırasıdır.
 */
export const TICK_MINUTES = 15;
export const TICKS_PER_HOUR = 4;
export const TICKS_PER_DAY = 96;
export const TICKS_PER_SEASON = 672; // 7 gerçek gün
export const TICKS_PER_YEAR = 2688; // 28 gerçek gün · 4 mevsim

export type Season = 0 | 1 | 2 | 3; // İlkbahar, Yaz, Sonbahar, Kış

export function seasonOf(tickSeq: number): Season {
  return (Math.floor((tickSeq % TICKS_PER_YEAR) / TICKS_PER_SEASON) % 4) as Season;
}

export const SEASON_NAMES = ['İlkbahar', 'Yaz', 'Sonbahar', 'Kış'] as const;

/** Deterministik RNG — docs/05 §6. `Math.random()` tick içinde yasaktır. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tick + faz + shard + varlık için çakışmayan tohum üretir. */
export function deriveSeed(tickSeed: bigint, phase: number, shard: number, entity: string): number {
  let h = Number(BigInt.asUintN(32, tickSeed)) ^ (phase * 0x9e3779b1) ^ (shard * 0x85ebca6b);
  for (let i = 0; i < entity.length; i++) {
    h = Math.imul(h ^ entity.charCodeAt(i), 0xc2b2ae35);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/**
 * Deterministik UUID (RFC 4122 v5 benzeri, SHA-1 tabanlı).
 *
 * Tick etkilerinin idempotency anahtarı buradan üretilir: aynı tur + aynı
 * varlık her zaman aynı `tx_id`'yi verir, dolayısıyla defter çifti
 * `ON CONFLICT DO NOTHING` ile bir kez yazılır (docs/05 §3, katman 2).
 */
export function deterministicUuid(namespace: string, ...parts: (string | number | bigint)[]): string {
  // Sabit, bağımlılıksız FNV-1a tabanlı 128-bit karışım.
  const input = namespace + '|' + parts.join('|');
  const h = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    for (let k = 0; k < 4; k++) {
      h[k] = Math.imul((h[k]! ^ c) >>> 0, 0x01000193) >>> 0;
      h[k] = ((h[k]! << 13) | (h[k]! >>> 19)) >>> 0;
      h[(k + 1) % 4] = (h[(k + 1) % 4]! ^ h[k]!) >>> 0;
    }
  }
  const hex = h.map((x) => x.toString(16).padStart(8, '0')).join('');
  // Sürüm 5 ve varyant bitlerini ayarla
  const v = hex.slice(0, 12) + '5' + hex.slice(13, 16) +
            ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 32);
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20, 32)}`;
}
