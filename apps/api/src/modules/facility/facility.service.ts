import { Inject, Injectable } from '@nestjs/common';
import {
  currentTickSeq, runInTransaction, summarizeInventory, transfer, type Sql,
} from '@kapital/db';
import {
  asMoney, asQty, DomainError, formatMoney, formatQty, InsufficientFunds,
  mulMoney, NotFound, type Money,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { BuildFacilityDto } from './facility.dto.js';

export interface FacilityView {
  id: string;
  name: string;
  type: { code: string; name: string; category: string };
  city: { id: number; code: string; name: string };
  level: number;
  condition: string;
  storageCapacity: string;
  usedCapacity: string;
  storageUsedPct: number;
  productionEnabled: boolean;
  isUnderConstruction: boolean;
  readyAtTick: string;
  ticksRemaining: number;
  createdAt: string;
}

@Injectable()
export class FacilityService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async build(userId: string, dto: BuildFacilityDto): Promise<FacilityView> {
    const company = await this.companyOf(userId);

    const [type] = await this.sql<{
      id: number; code: string; name: string; base_cost: bigint; storage_capacity: bigint;
      construction_ticks: number; unlock_level: number; requires_port: boolean;
    }[]>`SELECT id, code, name, base_cost, storage_capacity, construction_ticks,
                unlock_level, requires_port
         FROM facility_types WHERE code = ${dto.facilityTypeCode} AND is_active`;
    if (!type) throw new NotFound('Tesis türü', dto.facilityTypeCode);

    if (company.level < type.unlock_level) {
      throw new DomainError('LEVEL_LOCKED', `${type.name} için seviye ${type.unlock_level} gerekli`, {
        required: type.unlock_level, current: company.level,
      });
    }

    const [city] = await this.sql<{ id: number; name: string; land_cost_index: number; has_port: boolean }[]>`
      SELECT id, name, land_cost_index, has_port FROM cities
      WHERE code = ${dto.cityCode} AND is_active`;
    if (!city) throw new NotFound('Şehir', dto.cityCode);

    if (type.requires_port && !city.has_port) {
      throw new DomainError('VALIDATION', `${type.name} yalnız limanı olan şehirlerde kurulabilir`, {
        city: city.name,
      });
    }

    // Kurulum maliyeti şehrin arsa endeksiyle ölçeklenir. Katsayı float'tır ama
    // para sınırına BİR KEZ gelinir ve yuvarlama artığı deftere yazılır (ADR-0001).
    const { value: cost, residue } = mulMoney(asMoney(type.base_cost), city.land_cost_index);
    if (company.cash < cost) {
      throw new InsufficientFunds({
        required: cost.toString(), available: company.cash.toString(),
        requiredFormatted: formatMoney(cost),
      });
    }

    const tickSeq = await currentTickSeq(this.sql);

    const facilityId = await runInTransaction(this.sql, async (tx) => {
      const [sink] = await tx<{ id: string }[]>`
        SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;

      const [facility] = await tx<{ id: string }[]>`
        INSERT INTO facilities (company_id, facility_type_id, city_id, name,
                                storage_capacity, construction_complete_at_tick)
        VALUES (${company.id}::uuid, ${type.id}, ${city.id},
                ${dto.name ?? type.name}, ${type.storage_capacity},
                ${tickSeq + BigInt(type.construction_ticks)})
        RETURNING id`;

      await transfer(tx, {
        tickId: tickSeq,
        fromCompanyId: company.id,
        toCompanyId: sink!.id,
        amount: cost,
        account: 'CAPEX',
        reason: `${type.name} kurulumu — ${city.name}`,
        refType: 'facility',
        refId: facility!.id,
        roundingResidue: residue,
      });

      await tx`UPDATE company_stats SET facilities_built = facilities_built + 1
               WHERE company_id = ${company.id}::uuid`;

      return facility!.id;
    });

    return this.getById(company.id, facilityId);
  }

  async list(userId: string): Promise<FacilityView[]> {
    const company = await this.companyOf(userId);
    const rows = await this.sql<Record<string, never>[]>`
      ${this.selectFacility} WHERE f.company_id = ${company.id}::uuid AND f.closed_at IS NULL
      ORDER BY f.created_at`;
    const tickSeq = await currentTickSeq(this.sql);
    return rows.map((r) => this.toView(r, tickSeq));
  }

  async getById(companyId: string, facilityId: string): Promise<FacilityView> {
    const [row] = await this.sql<Record<string, never>[]>`
      ${this.selectFacility} WHERE f.id = ${facilityId}::uuid AND f.company_id = ${companyId}::uuid`;
    if (!row) throw new NotFound('Tesis', facilityId);
    return this.toView(row, await currentTickSeq(this.sql));
  }

  async getByUser(userId: string, facilityId: string): Promise<FacilityView> {
    const company = await this.companyOf(userId);
    return this.getById(company.id, facilityId);
  }

  async stock(userId: string, facilityId: string) {
    const company = await this.companyOf(userId);
    const [inv] = await this.sql<{ id: string; capacity: bigint; used_capacity: bigint }[]>`
      SELECT i.id, i.capacity, i.used_capacity FROM inventories i
      JOIN facilities f ON f.id = i.facility_id
      WHERE i.facility_id = ${facilityId}::uuid AND f.company_id = ${company.id}::uuid`;
    if (!inv) throw new NotFound('Tesis', facilityId);

    const summary = await summarizeInventory(this.sql, inv.id);
    return {
      facilityId,
      capacity: inv.capacity.toString(),
      usedCapacity: inv.used_capacity.toString(),
      freeCapacity: (inv.capacity - inv.used_capacity).toString(),
      products: summary.map((s) => ({
        productId: s.productId,
        code: s.productCode,
        name: s.productName,
        unit: s.unit,
        total: s.total.toString(),
        totalFormatted: formatQty(s.total, s.unit),
        available: s.available.toString(),
        reserved: s.reserved.toString(),
        avgQuality: Number(s.avgQuality.toFixed(2)),
        weightedAvgCost: s.weightedAvgCost.toString(),
        weightedAvgCostFormatted: formatMoney(s.weightedAvgCost),
        batchCount: s.batchCount,
      })),
    };
  }

  /** Lot detayı — UI'da bottom sheet olarak açılır (docs/09 F9). */
  async batches(userId: string, facilityId: string, productId?: number) {
    const company = await this.companyOf(userId);
    const rows = await this.sql<Record<string, never>[]>`
      SELECT b.id, b.product_id, p.code, p.name, p.unit, b.quantity, b.reserved_quantity,
             b.quality, b.unit_cost, b.expires_at_tick, b.produced_in_tick, b.created_at
      FROM inventory_batches b
      JOIN inventories i ON i.id = b.inventory_id
      JOIN facilities f ON f.id = i.facility_id
      JOIN products p ON p.id = b.product_id
      WHERE i.facility_id = ${facilityId}::uuid
        AND f.company_id = ${company.id}::uuid
        AND (${productId ?? null}::smallint IS NULL OR b.product_id = ${productId ?? null}::smallint)
      ORDER BY b.expires_at_tick NULLS LAST, b.id`;

    return rows.map((r) => {
      const b = r as unknown as Record<string, never>;
      const cost = asMoney(b.unit_cost as unknown as bigint);
      const quantity = asQty(b.quantity as unknown as bigint);
      return {
        id: (b.id as unknown as bigint).toString(),
        product: { id: b.product_id, code: b.code, name: b.name, unit: b.unit },
        quantity: quantity.toString(),
        quantityFormatted: formatQty(quantity, b.unit as unknown as string),
        reserved: (b.reserved_quantity as unknown as bigint).toString(),
        quality: Number(b.quality),
        unitCost: cost.toString(),
        unitCostFormatted: formatMoney(cost),
        expiresAtTick: b.expires_at_tick ? (b.expires_at_tick as unknown as bigint).toString() : null,
        producedInTick: b.produced_in_tick ? (b.produced_in_tick as unknown as bigint).toString() : null,
      };
    });
  }

  private get selectFacility() {
    return this.sql`
      SELECT f.id, f.name, f.level, f.condition, f.storage_capacity, f.production_enabled,
             f.construction_complete_at_tick, f.created_at,
             ft.code AS type_code, ft.name AS type_name, ft.category AS type_category,
             c.id AS city_id, c.code AS city_code, c.name AS city_name,
             COALESCE(i.used_capacity, 0) AS used_capacity
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN cities c ON c.id = f.city_id
      LEFT JOIN inventories i ON i.facility_id = f.id`;
  }

  private toView(row: Record<string, never>, tickSeq: bigint): FacilityView {
    const f = row as unknown as Record<string, never>;
    const capacity = f.storage_capacity as unknown as bigint;
    const used = f.used_capacity as unknown as bigint;
    const readyAt = f.construction_complete_at_tick as unknown as bigint;
    const remaining = readyAt > tickSeq ? Number(readyAt - tickSeq) : 0;
    return {
      id: f.id as unknown as string,
      name: (f.name ?? f.type_name) as unknown as string,
      type: {
        code: f.type_code as unknown as string,
        name: f.type_name as unknown as string,
        category: f.type_category as unknown as string,
      },
      city: {
        id: f.city_id as unknown as number,
        code: f.city_code as unknown as string,
        name: f.city_name as unknown as string,
      },
      level: f.level as unknown as number,
      condition: f.condition as unknown as string,
      storageCapacity: capacity.toString(),
      usedCapacity: used.toString(),
      storageUsedPct: capacity > 0n ? Number((used * 10000n) / capacity) / 100 : 0,
      productionEnabled: f.production_enabled as unknown as boolean,
      isUnderConstruction: remaining > 0,
      readyAtTick: readyAt.toString(),
      ticksRemaining: remaining,
      createdAt: new Date(f.created_at as unknown as string).toISOString(),
    };
  }

  private async companyOf(userId: string): Promise<{ id: string; level: number; cash: Money }> {
    const [row] = await this.sql<{ id: string; level: number; cash: bigint }[]>`
      SELECT id, level, cash FROM companies WHERE user_id = ${userId}::uuid`;
    if (!row) throw new NotFound('Şirket');
    return { id: row.id, level: row.level, cash: asMoney(row.cash) };
  }
}
