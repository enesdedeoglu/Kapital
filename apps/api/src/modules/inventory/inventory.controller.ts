import { Body, Controller, Get, Inject, Post, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { summarizeInventory, type Sql } from '@kapital/db';
import { asMoney, formatMoney, formatQty, NotFound } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { transferStockSchema, type TransferStockDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

/** Şirketin tüm tesislerindeki stoğun birleşik görünümü. */
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  /** Kendi tesisleri arasında stok taşır (aynı şehir; şehirler arası F4). */
  @Post('transfer')
  @UseInterceptors(IdempotencyInterceptor)
  transferStock(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(transferStockSchema)) dto: TransferStockDto,
  ) {
    return this.inventory.transfer(req.user.sub, dto);
  }

  @Get()
  async all(@Req() req: Request & { user: AuthUser }) {
    const [company] = await this.sql<{ id: string }[]>`
      SELECT id FROM companies WHERE user_id = ${req.user.sub}::uuid`;
    if (!company) throw new NotFound('Şirket');

    const inventories = await this.sql<{
      id: string; facility_id: string; capacity: bigint; used_capacity: bigint;
      facility_name: string; type_name: string; city_name: string;
    }[]>`
      SELECT i.id, i.facility_id, i.capacity, i.used_capacity,
             COALESCE(f.name, ft.name) AS facility_name, ft.name AS type_name, c.name AS city_name
      FROM inventories i
      JOIN facilities f ON f.id = i.facility_id
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN cities c ON c.id = f.city_id
      WHERE i.company_id = ${company.id}::uuid AND f.closed_at IS NULL
      ORDER BY f.created_at`;

    const result = [];
    for (const inv of inventories) {
      const summary = await summarizeInventory(this.sql, inv.id);
      result.push({
        facilityId: inv.facility_id,
        facilityName: inv.facility_name,
        facilityType: inv.type_name,
        city: inv.city_name,
        capacity: inv.capacity.toString(),
        usedCapacity: inv.used_capacity.toString(),
        products: summary.map((s) => ({
          productId: s.productId, code: s.productCode, name: s.productName, unit: s.unit,
          total: s.total.toString(),
          totalFormatted: formatQty(s.total, s.unit),
          available: s.available.toString(),
          reserved: s.reserved.toString(),
          avgQuality: Number(s.avgQuality.toFixed(2)),
          weightedAvgCost: s.weightedAvgCost.toString(),
          weightedAvgCostFormatted: formatMoney(s.weightedAvgCost),
          batchCount: s.batchCount,
        })),
      });
    }

    const totalValue = result
      .flatMap((r) => r.products)
      .reduce((sum, p) => sum + BigInt(p.total) * BigInt(p.weightedAvgCost) / 1000n, 0n);

    return {
      facilities: result,
      /** Stok maliyet değeri. Piyasa değerlemesi F4'te (docs/11 C3 likidite iskontosu). */
      totalCostValue: totalValue.toString(),
      totalCostValueFormatted: formatMoney(asMoney(totalValue)),
    };
  }
}
