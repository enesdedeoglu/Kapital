import { transfer, type Sql } from '@kapital/db';
import { asMoney, deterministicUuid, InsufficientFunds } from '@kapital/shared';
import type { EngineTick } from '../context.js';
import { collectLoanPayments, type LoanPhaseResult } from './loans.js';

export interface UpkeepPhaseResult {
  decayedBatches: number;
  expiredBatches: number;
  maintenanceCharged: bigint;
  facilitiesHalted: number;
  wornFacilities: number;
  criticalCondition: number;
  loans: LoanPhaseResult;
}

/**
 * P4 — BAKIM. Stok bozulur, tesis giderleri tahsil edilir.
 *
 * Nakit yetmezse tesis KAPATILMAZ: `condition` düşer ve `halted_reason`
 * yazılır. Madde 40'ın "yeni kullanıcıyı yanlışlıkla oyundan silme" şartının
 * uygulama noktalarından biri budur (docs/05 P4).
 */
export async function runUpkeepPhase(sql: Sql, tick: EngineTick): Promise<UpkeepPhaseResult> {
  // Bozulma lot bazında ve çarpımsal (madde 37). Bozulmayan ürünlere
  // (çelik, cam, elektronik) decay_rate = 0 olduğu için dokunulmaz.
  const decayed = await sql`
    UPDATE inventory_batches b
       SET quality = GREATEST(0, ROUND((b.quality * (1 - p.quality_decay_rate))::numeric, 3))
      FROM products p
     WHERE p.id = b.product_id AND p.quality_decay_rate > 0
    RETURNING b.id`;

  const expired = await sql`
    DELETE FROM inventory_batches
    WHERE expires_at_tick IS NOT NULL AND expires_at_tick <= ${tick.seq}
    RETURNING id`;

  // Tesis aşınması (docs/11 C6): tur başına −0,05. Bakım harcaması onarır (F11).
  const worn = await sql`
    UPDATE facilities
       SET condition = GREATEST(0, condition - 0.05)
     WHERE closed_at IS NULL AND construction_complete_at_tick <= ${tick.seq} AND condition > 0
    RETURNING id`;

  // condition < 30 → üretim durur (C6). Tesis KAPATILMAZ, onarılabilir.
  const critical = await sql`
    UPDATE facilities
       SET production_enabled = FALSE, halted_reason = 'tesis durumu kritik (<30)'
     WHERE closed_at IS NULL AND condition < 30 AND production_enabled
    RETURNING id`;

  const [sink] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;

  const facilities = await sql<{
    id: string; company_id: string; maintenance_cost: bigint; name: string;
  }[]>`
    SELECT f.id, f.company_id, ft.maintenance_cost, ft.name
    FROM facilities f
    JOIN facility_types ft ON ft.id = f.facility_type_id
    JOIN companies c ON c.id = f.company_id AND c.status = 'ACTIVE'
    WHERE f.closed_at IS NULL
      AND f.construction_complete_at_tick <= ${tick.seq}
      AND ft.maintenance_cost > 0`;

  let charged = 0n;
  let halted = 0;

  for (const facility of facilities) {
    try {
      await sql.begin(async (tx) => {
        await transfer(tx as unknown as Sql, {
          tickId: tick.seq,
          txId: deterministicUuid('maintenance', tick.seq, facility.id),
          fromCompanyId: facility.company_id,
          toCompanyId: sink!.id,
          amount: asMoney(facility.maintenance_cost),
          account: 'MAINTENANCE',
          reason: `${facility.name} bakım gideri`,
          refType: 'facility',
          refId: facility.id,
        });
      });
      charged += facility.maintenance_cost;
    } catch (error) {
      if (!(error instanceof InsufficientFunds)) throw error;
      // Kademeli ceza: tesis kapatılmaz, yıpranır ve durdurulur.
      await sql`
        UPDATE facilities
           SET condition = GREATEST(0, condition - 2),
               halted_reason = 'bakım gideri ödenemedi'
         WHERE id = ${facility.id}::uuid`;
      halted++;
    }
  }

  // Kredi taksitleri bakımdan SONRA tahsil edilir: tesis gideri önce ödenir,
  // böylece oyuncu üretimini sürdürebilir ve borcunu ödeyebilecek hale gelir.
  const loans = await collectLoanPayments(sql, tick);

  return {
    decayedBatches: decayed.length,
    expiredBatches: expired.length,
    maintenanceCharged: charged,
    facilitiesHalted: halted,
    wornFacilities: worn.length,
    criticalCondition: critical.length,
    loans,
  };
}
