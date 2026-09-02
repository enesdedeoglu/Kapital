import type { Sql } from '../client.js';

/**
 * Zaman kaynağı `NOW()` değil, en son turun sırasıdır (docs/04 §2.8).
 * İş mantığında tarih/saat kullanılmaz; her etki bir tura aittir.
 */
export async function currentTickSeq(sql: Sql): Promise<bigint> {
  const [row] = await sql<{ seq: bigint }[]>`
    SELECT seq FROM economic_ticks ORDER BY seq DESC LIMIT 1`;
  return row?.seq ?? 0n;
}
