import {
  asMoney, asQty, DomainError, divRoundHalfEven, type Money, type Qty,
} from '@kapital/shared';
import type { Sql } from '../client.js';

export interface AddBatchInput {
  inventoryId: string;
  productId: number;
  quantity: Qty;
  /** 0–100 */
  quality: number | string;
  unitCost: Money;
  producedInTick?: bigint | null;
  expiresAtTick?: bigint | null;
  sourceCompanyId?: string | null;
  sourceFacilityId?: string | null;
}

export interface Pick {
  batchId: bigint;
  /** Bu lottan alınan miktar. */
  take: Qty;
  /** Lotun alım anındaki toplam miktarı — commit'te tam tüketim tespiti için. */
  batchQuantity: Qty;
  quality: number;
  unitCost: Money;
}

export interface Allocation {
  picks: Pick[];
  /** Gerçekten ayrılan toplam. İstenenden az olabilir. */
  allocated: Qty;
  /** Ayrılan lotların miktar ağırlıklı ortalama kalitesi. */
  weightedQuality: number;
  /** Ağırlıklı ortalama birim maliyet — COGS'un kaynağı. */
  weightedUnitCost: Money;
  /** İstenen tamamen karşılandı mı? */
  complete: boolean;
}

const EMPTY: Allocation = {
  picks: [], allocated: asQty(0n), weightedQuality: 0,
  weightedUnitCost: asMoney(0n), complete: false,
};

/** Depo kapasitesi aşılırsa DB kısıtı patlar; onu alan hatasına çeviriyoruz. */
function translateCapacityError(error: unknown): never {
  const err = error as { code?: string; constraint_name?: string };
  if (err.code === '23514' && err.constraint_name === 'used_within_capacity') {
    throw new DomainError('STORAGE_FULL', 'Depo kapasitesi yetersiz');
  }
  throw error;
}

export async function addBatch(tx: Sql, input: AddBatchInput): Promise<bigint> {
  if (input.quantity <= 0n) throw new RangeError('parti miktarı pozitif olmalı');
  try {
    const [row] = await tx<{ id: bigint }[]>`
      INSERT INTO inventory_batches
        (inventory_id, product_id, quantity, quality, unit_cost,
         produced_in_tick, expires_at_tick, source_company_id, source_facility_id)
      VALUES (${input.inventoryId}::uuid, ${input.productId}, ${input.quantity},
              ${String(input.quality)}, ${input.unitCost}, ${input.producedInTick ?? null},
              ${input.expiresAtTick ?? null}, ${input.sourceCompanyId ?? null}::uuid,
              ${input.sourceFacilityId ?? null}::uuid)
      RETURNING id`;
    return row!.id;
  } catch (error) {
    return translateCapacityError(error);
  }
}

export interface PickInput {
  inventoryId: string;
  productId: number;
  quantity: Qty;
  /** Reçete girdisi minimum kalite isteyebilir (madde 15). */
  minQuality?: number;
}

/**
 * FEFO ile lot ayırır ve `reserved_quantity`'yi artırır.
 *
 * `FOR UPDATE SKIP LOCKED` kritiktir (docs/06 §4): P2 fazında paralel worker'lar
 * aynı ürünün lotlarına bakar. Onsuz hepsi ilk lotta sıraya girer ve faz süresi
 * saniyelerden dakikalara çıkar.
 *
 * Kısmi ayırma normaldir — çağıran `complete` alanına bakmalıdır.
 */
export async function reserveFefo(tx: Sql, input: PickInput): Promise<Allocation> {
  if (input.quantity <= 0n) return EMPTY;

  const rows = await tx<
    { id: bigint; take: bigint; batch_quantity: bigint; quality: string; unit_cost: bigint }[]
  >`
    WITH avail AS (
      SELECT id, quantity, quantity - reserved_quantity AS free, quality, unit_cost, expires_at_tick
      FROM inventory_batches
      WHERE inventory_id = ${input.inventoryId}::uuid
        AND product_id = ${input.productId}
        AND quality >= ${String(input.minQuality ?? 0)}
        AND quantity > reserved_quantity
      ORDER BY expires_at_tick NULLS LAST, id
      FOR UPDATE SKIP LOCKED
    ),
    running AS (
      -- ::bigint şart: Postgres'te SUM(bigint) → numeric, o da string olarak gelir
      -- ve JS tarafında bigint ile karıştırılamaz.
      SELECT *, COALESCE(
        SUM(free) OVER (ORDER BY expires_at_tick NULLS LAST, id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::bigint AS before
      FROM avail
    ),
    alloc AS (
      SELECT id, quantity, quality, unit_cost,
             LEAST(free, ${input.quantity}::bigint - before)::bigint AS take
      FROM running WHERE before < ${input.quantity}::bigint
    )
    UPDATE inventory_batches b
       SET reserved_quantity = b.reserved_quantity + a.take
      FROM alloc a
     WHERE b.id = a.id AND a.take > 0
    RETURNING b.id, a.take, a.quantity AS batch_quantity, a.quality, a.unit_cost`;

  return summarizePicks(rows);
}

function summarizePicks(
  rows: { id: bigint; take: bigint; batch_quantity: bigint; quality: string; unit_cost: bigint }[],
): Allocation {
  if (rows.length === 0) return EMPTY;

  let allocated = 0n;
  let qualityWeighted = 0;
  let costWeighted = 0n;
  const picks: Pick[] = [];

  for (const row of rows) {
    allocated += row.take;
    qualityWeighted += Number(row.quality) * Number(row.take);
    costWeighted += row.unit_cost * row.take;
    picks.push({
      batchId: row.id,
      take: asQty(row.take),
      batchQuantity: asQty(row.batch_quantity),
      quality: Number(row.quality),
      unitCost: asMoney(row.unit_cost),
    });
  }

  return {
    picks,
    allocated: asQty(allocated),
    weightedQuality: qualityWeighted / Number(allocated),
    // Para hassasiyeti bigint'te korunur; float'a düşürülmez.
    weightedUnitCost: asMoney(divRoundHalfEven(costWeighted, allocated)),
    complete: false, // çağıran istenen miktarla karşılaştırır
  };
}

/**
 * Rezervasyonu kesinleştirir: mal gerçekten çıkar.
 * Tamamen tükenen lotlar SİLİNİR — `quantity > 0` kısıtı korunur, boş satır birikmez.
 */
export async function commitPicks(tx: Sql, picks: readonly Pick[]): Promise<void> {
  if (picks.length === 0) return;

  const fullyConsumed = picks.filter((p) => p.take === p.batchQuantity).map((p) => p.batchId);
  const partial = picks.filter((p) => p.take < p.batchQuantity);

  if (fullyConsumed.length > 0) {
    // Metin dizisi olarak gönderilir: postgres.js bigint dizisini skaler bigint
    // olarak tiplendiriyor ve `::bigint[]` cast'i patlıyor.
    const ids = fullyConsumed.map(String);
    await tx`DELETE FROM inventory_batches WHERE id = ANY(${ids}::bigint[])`;
  }
  for (const pick of partial) {
    await tx`
      UPDATE inventory_batches
         SET quantity = quantity - ${pick.take},
             reserved_quantity = reserved_quantity - ${pick.take}
       WHERE id = ${pick.batchId}`;
  }
}

/** Rezervasyonu bırakır: miktar dokunulmaz, yalnız rezerv çözülür (sevkiyat iptali). */
export async function releasePicks(tx: Sql, picks: readonly Pick[]): Promise<void> {
  if (picks.length === 0) return;
  for (const pick of picks) {
    await tx`
      UPDATE inventory_batches
         SET reserved_quantity = reserved_quantity - ${pick.take}
       WHERE id = ${pick.batchId}`;
  }
}

/** Aynı tur içinde tüketim (üretim girdisi, perakende satışı): rezerve et + kesinleştir. */
export async function consumeFefo(tx: Sql, input: PickInput): Promise<Allocation> {
  const allocation = await reserveFefo(tx, input);
  if (allocation.allocated === 0n) return { ...allocation, complete: false };
  await commitPicks(tx, allocation.picks);
  return { ...allocation, complete: allocation.allocated >= input.quantity };
}

export interface StockSummary {
  productId: number;
  productCode: string;
  productName: string;
  unit: string;
  total: Qty;
  available: Qty;
  reserved: Qty;
  /** Miktar ağırlıklı ortalama kalite. */
  avgQuality: number;
  /** Ağırlıklı ortalama maliyet — UI'da gösterilir, saklanmaz (docs/04 §2.3). */
  weightedAvgCost: Money;
  batchCount: number;
}

/** Toplamlar TÜRETİLİR, saklanmaz — lot sistemi tek doğruluk kaynağıdır. */
export async function summarizeInventory(sql: Sql, inventoryId: string): Promise<StockSummary[]> {
  const rows = await sql<{
    product_id: number; code: string; name: string; unit: string;
    total: bigint; available: bigint; reserved: bigint;
    avg_quality: string; wavg_cost: bigint; batch_count: bigint;
  }[]>`
    SELECT b.product_id, p.code, p.name, p.unit,
           SUM(b.quantity)::bigint                                     AS total,
           SUM(b.quantity - b.reserved_quantity)::bigint               AS available,
           SUM(b.reserved_quantity)::bigint                            AS reserved,
           (SUM(b.quantity * b.quality) / SUM(b.quantity))::text       AS avg_quality,
           (SUM(b.quantity * b.unit_cost) / SUM(b.quantity))::bigint   AS wavg_cost,
           COUNT(*)                                                    AS batch_count
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
     WHERE b.inventory_id = ${inventoryId}::uuid
     GROUP BY b.product_id, p.id, p.code, p.name, p.unit
     ORDER BY p.id`;

  return rows.map((r) => ({
    productId: r.product_id,
    productCode: r.code,
    productName: r.name,
    unit: r.unit,
    total: asQty(r.total),
    available: asQty(r.available),
    reserved: asQty(r.reserved),
    avgQuality: Number(r.avg_quality),
    weightedAvgCost: asMoney(r.wavg_cost),
    batchCount: Number(r.batch_count),
  }));
}
