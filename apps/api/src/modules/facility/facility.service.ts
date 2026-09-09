import { Inject, Injectable } from '@nestjs/common';
import { getConfig, loadConfigSnapshot } from '@kapital/config';
import {
  currentTickSeq, runInTransaction, summarizeInventory, transfer, type Sql,
} from '@kapital/db';
import { cityBonusFor, productionCapacity, upgradeCost, type FacilityCategory } from '@kapital/economy';
import {
  asMoney, asQty, deterministicUuid, DomainError, formatMoney, formatQty, InsufficientFunds,
  mulMoney, NotFound, type Money,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { BuildFacilityDto } from './facility.dto.js';
import type { SetRecipeDto } from './production.dto.js';

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

      /*
       * ★ Kimlik deterministik (R79). Sıra numarası şart: bir oyuncu aynı
       * turda aynı şehirde aynı tipten iki tesis kurabilir.
       */
      const [sayi] = await tx<{ n: string }[]>`
        SELECT COUNT(*)::text AS n FROM facilities WHERE company_id = ${company.id}::uuid`;
      const [facility] = await tx<{ id: string }[]>`
        INSERT INTO facilities (id, company_id, facility_type_id, city_id, name,
                                storage_capacity, construction_complete_at_tick)
        VALUES (${deterministicUuid('facility', company.id, tickSeq, type.id, sayi!.n)}::uuid,
                ${company.id}::uuid, ${type.id}, ${city.id},
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

  /** Tesisin üreteceği ürünü seçer. Perakende tesislerinin reçetesi yoktur. */
  async setRecipe(userId: string, facilityId: string, dto: SetRecipeDto): Promise<FacilityView> {
    const company = await this.companyOf(userId);

    const [row] = await this.sql<{
      facility_type_id: number; type_name: string; recipe_id: number | null;
      recipe_unlock: number | null; product_name: string | null;
    }[]>`
      SELECT f.facility_type_id, ft.name AS type_name,
             r.id AS recipe_id, r.unlock_level AS recipe_unlock, p.name AS product_name
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      LEFT JOIN products p           ON p.code = ${dto.outputProductCode} AND p.is_active
      LEFT JOIN production_recipes r ON r.facility_type_id = f.facility_type_id
                                    AND r.output_product_id = p.id AND r.is_active
      WHERE f.id = ${facilityId}::uuid AND f.company_id = ${company.id}::uuid
        AND f.closed_at IS NULL`;
    if (!row) throw new NotFound('Tesis', facilityId);
    if (!row.recipe_id) {
      throw new DomainError('VALIDATION',
        `${row.type_name} ${dto.outputProductCode} üretemez`, {
          facilityType: row.type_name, product: dto.outputProductCode,
        });
    }
    if (company.level < (row.recipe_unlock ?? 1)) {
      throw new DomainError('LEVEL_LOCKED',
        `${row.product_name} üretimi için seviye ${row.recipe_unlock} gerekli`, {
          required: row.recipe_unlock, current: company.level,
        });
    }

    await this.sql`
      UPDATE facilities
         SET active_recipe_id = ${row.recipe_id}, production_enabled = ${dto.enabled},
             halted_reason = NULL
       WHERE id = ${facilityId}::uuid`;
    return this.getById(company.id, facilityId);
  }

  /**
   * Tesis yükseltme — madde 12: `taban × 0,75 × seviye^1,55`.
   * Kapasite ve depo, seviye eğrisiyle birlikte büyür.
   */
  async upgrade(userId: string, facilityId: string): Promise<FacilityView> {
    const company = await this.companyOf(userId);

    const [row] = await this.sql<{
      level: number; base_cost: bigint; base_storage: bigint; type_name: string;
      next_multiplier: number | null;
    }[]>`
      SELECT f.level, ft.base_cost, ft.storage_capacity AS base_storage, ft.name AS type_name,
             lc.capacity_multiplier AS next_multiplier
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      LEFT JOIN facility_level_curve lc ON lc.level = f.level + 1
      WHERE f.id = ${facilityId}::uuid AND f.company_id = ${company.id}::uuid
        AND f.closed_at IS NULL`;
    if (!row) throw new NotFound('Tesis', facilityId);

    const snapshot = await loadConfigSnapshot(this.sql, 0n);
    const cfg = getConfig<{ costMultiplier: number; costExponent: number; maxLevel: number }>(
      snapshot, 'economy.upgrade',
    );
    const nextLevel = row.level + 1;
    if (nextLevel > cfg.maxLevel || row.next_multiplier === null) {
      throw new DomainError('VALIDATION', `${row.type_name} en yüksek seviyede`, {
        level: row.level, maxLevel: cfg.maxLevel,
      });
    }

    const cost = upgradeCost(asMoney(row.base_cost), nextLevel, cfg.costMultiplier, cfg.costExponent);
    if (company.cash < cost) {
      throw new InsufficientFunds({
        required: cost.toString(), requiredFormatted: formatMoney(cost),
        available: company.cash.toString(),
      });
    }

    const newStorage = BigInt(Math.round(Number(row.base_storage) * row.next_multiplier));
    const tickSeq = await currentTickSeq(this.sql);

    await runInTransaction(this.sql, async (tx) => {
      const [sink] = await tx<{ id: string }[]>`
        SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;
      await transfer(tx, {
        tickId: tickSeq,
        fromCompanyId: company.id,
        toCompanyId: sink!.id,
        amount: cost,
        account: 'CAPEX',
        reason: `${row.type_name} seviye ${nextLevel} yükseltmesi`,
        refType: 'facility',
        refId: facilityId,
      });
      await tx`UPDATE facilities SET level = ${nextLevel}, storage_capacity = ${newStorage}
                WHERE id = ${facilityId}::uuid`;
      await tx`UPDATE inventories SET capacity = ${newStorage}
                WHERE facility_id = ${facilityId}::uuid`;
    });

    return this.getById(company.id, facilityId);
  }

  /** Üretim durumu: kapasite, aktif reçete, son turların çıktısı. */
  async production(userId: string, facilityId: string) {
    const company = await this.companyOf(userId);
    const [row] = await this.sql<{
      category: FacilityCategory; level: number; condition: string; base_capacity: number;
      level_multiplier: number; technology_bonus: number; staff_score: number;
      agriculture_bonus: number; industrial_bonus: number;
      production_enabled: boolean; halted_reason: string | null;
      recipe_id: number | null; product_code: string | null; product_name: string | null;
      product_unit: string | null; output_quantity: bigint | null; cycle_ticks: number | null;
    }[]>`
      SELECT ft.category, f.level, f.condition::text, ft.base_capacity,
             COALESCE(lc.capacity_multiplier, 1) AS level_multiplier,
             f.technology_bonus, f.staff_score, c.agriculture_bonus, c.industrial_bonus,
             f.production_enabled, f.halted_reason,
             r.id AS recipe_id, p.code AS product_code, p.name AS product_name,
             p.unit AS product_unit, r.output_quantity, r.cycle_ticks
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN cities c ON c.id = f.city_id
      LEFT JOIN facility_level_curve lc ON lc.level = f.level
      LEFT JOIN production_recipes r ON r.id = f.active_recipe_id
      LEFT JOIN products p ON p.id = r.output_product_id
      WHERE f.id = ${facilityId}::uuid AND f.company_id = ${company.id}::uuid
        AND f.closed_at IS NULL`;
    if (!row) throw new NotFound('Tesis', facilityId);

    const capacity = productionCapacity({
      baseCapacity: row.base_capacity,
      levelMultiplier: row.level_multiplier,
      condition: Number(row.condition),
      cityBonus: cityBonusFor(row.category, {
        agricultureBonus: row.agriculture_bonus,
        industrialBonus: row.industrial_bonus,
      }),
      technologyBonus: row.technology_bonus,
    });

    const inputs = row.recipe_id === null ? [] : await this.sql<
      { code: string; name: string; unit: string; quantity: bigint; min_quality: string }[]
    >`SELECT p.code, p.name, p.unit, ri.quantity, ri.min_quality::text
      FROM recipe_inputs ri JOIN products p ON p.id = ri.product_id
      WHERE ri.recipe_id = ${row.recipe_id} ORDER BY p.id`;

    const history = await this.sql<{
      tick_id: bigint; capacity: bigint; produced: bigint; output_quality: string;
      halted_reason: string | null;
    }[]>`
      SELECT tick_id, capacity, produced, output_quality::text, halted_reason
      FROM production_records WHERE facility_id = ${facilityId}::uuid
      ORDER BY tick_id DESC LIMIT 12`;

    return {
      facilityId,
      productionEnabled: row.production_enabled,
      haltedReason: row.halted_reason,
      condition: Number(row.condition),
      level: row.level,
      capacityPerTick: capacity.toFixed(2),
      recipe: row.recipe_id === null ? null : {
        outputProduct: { code: row.product_code, name: row.product_name, unit: row.product_unit },
        outputQuantity: (row.output_quantity ?? 0n).toString(),
        cycleTicks: row.cycle_ticks,
        inputs: inputs.map((i) => ({
          code: i.code, name: i.name, unit: i.unit,
          quantity: i.quantity.toString(),
          quantityFormatted: formatQty(asQty(i.quantity), i.unit),
          minQuality: Number(i.min_quality),
        })),
      },
      recentTicks: history.map((h) => ({
        tickSeq: h.tick_id.toString(),
        capacity: h.capacity.toString(),
        produced: h.produced.toString(),
        outputQuality: Number(h.output_quality),
        haltedReason: h.halted_reason,
      })),
    };
  }

  // Alan (readonly field) YAPILAMAZ: `this.sql`...`` her erişimde YENİ bir
  // postgres.js Query nesnesi kurar ve bu nesneler tek kullanımlıktır.
  // Alan olarak bir kez kurulsa tüm istekler aynı Query'yi paylaşırdı.
  // eslint-disable-next-line @typescript-eslint/class-literal-property-style
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
