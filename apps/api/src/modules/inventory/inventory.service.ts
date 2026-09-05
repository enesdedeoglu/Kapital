import { Inject, Injectable } from '@nestjs/common';
import { addBatch, reserveFefo, commitPicks, runInTransaction, type Sql } from '@kapital/db';
import {
  asQty, DomainError, formatQty, NotFound, qtyFromNumber,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { TransferStockDto } from './inventory.dto.js';

@Injectable()
export class InventoryService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /**
   * Kendi tesisleri arasında stok taşır — "kendi ürettiğini kendi mağazasında sat".
   *
   * F3'te YALNIZ AYNI ŞEHİR içinde ve anında. Şehirler arası taşıma nakliye
   * maliyeti ve transit süresi gerektirir; o F4'te sevkiyat sistemine bağlanır
   * (docs/12 A3). Aksi halde lojistik bedavaya atlanabilirdi.
   */
  async transfer(userId: string, dto: TransferStockDto) {
    if (dto.fromFacilityId === dto.toFacilityId) {
      throw new DomainError('VALIDATION', 'Kaynak ve hedef tesis aynı olamaz');
    }

    const [company] = await this.sql<{ id: string }[]>`
      SELECT id FROM companies WHERE user_id = ${userId}::uuid`;
    if (!company) throw new NotFound('Şirket');

    const facilities = await this.sql<{
      id: string; city_id: number; inventory_id: string; name: string;
    }[]>`
      SELECT f.id, f.city_id, i.id AS inventory_id, COALESCE(f.name, ft.name) AS name
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN inventories i ON i.facility_id = f.id
      WHERE f.id IN (${dto.fromFacilityId}::uuid, ${dto.toFacilityId}::uuid)
        AND f.company_id = ${company.id}::uuid AND f.closed_at IS NULL`;
    if (facilities.length !== 2) throw new NotFound('Tesis');

    const from = facilities.find((f) => f.id === dto.fromFacilityId)!;
    const to = facilities.find((f) => f.id === dto.toFacilityId)!;
    if (from.city_id !== to.city_id) {
      throw new DomainError('VALIDATION',
        'Şehirler arası taşıma nakliye gerektirir — piyasa üzerinden satın alın (lojistik F4)', {
          fromCity: from.city_id, toCity: to.city_id,
        });
    }

    const [product] = await this.sql<{ id: number; unit: string; shelf_life_ticks: number | null }[]>`
      SELECT id, unit, shelf_life_ticks FROM products WHERE code = ${dto.productCode} AND is_active`;
    if (!product) throw new NotFound('Ürün', dto.productCode);

    const wanted = qtyFromNumber(dto.quantity);

    const moved = await runInTransaction(this.sql, async (tx) => {
      // Lotlar FEFO ile alınır; kalite ve maliyet HER LOT İÇİN korunur —
      // taşıma sırasında bilgi kaybı olmaz.
      const allocation = await reserveFefo(tx, {
        inventoryId: from.inventory_id, productId: product.id, quantity: wanted,
      });
      if (allocation.allocated <= 0n) return { units: 0n, picks: 0 };

      for (const pick of allocation.picks) {
        const [source] = await tx<{ expires_at_tick: bigint | null; produced_in_tick: bigint | null }[]>`
          SELECT expires_at_tick, produced_in_tick FROM inventory_batches WHERE id = ${pick.batchId}`;
        await addBatch(tx, {
          inventoryId: to.inventory_id,
          productId: product.id,
          quantity: pick.take,
          quality: pick.quality,
          unitCost: pick.unitCost,
          producedInTick: source?.produced_in_tick ?? null,
          expiresAtTick: source?.expires_at_tick ?? null,
          sourceFacilityId: from.id,
          sourceCompanyId: company.id,
        });
      }
      await commitPicks(tx, allocation.picks);
      return { units: allocation.allocated as bigint, picks: allocation.picks.length };
    });

    return {
      from: from.name,
      to: to.name,
      productCode: dto.productCode,
      requested: wanted.toString(),
      moved: moved.units.toString(),
      movedFormatted: formatQty(asQty(moved.units), product.unit),
      lots: moved.picks,
      complete: moved.units >= wanted,
    };
  }
}
