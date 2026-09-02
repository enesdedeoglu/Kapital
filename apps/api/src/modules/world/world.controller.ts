import { Controller, Get, Inject, Param, ParseIntPipe } from '@nestjs/common';
import type { Sql } from '@kapital/db';
import { formatMoney, asMoney, NotFound } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import { Public } from '../auth/jwt.guard.js';

/** Dünya config'i — herkese açık, oturum gerektirmez. Salt okunur. */
@Public()
@Controller()
export class WorldController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get('cities')
  async cities() {
    const rows = await this.sql<Record<string, never>[]>`
      SELECT id, code, name, population_index, income_index, land_cost_index,
             industrial_bonus, agriculture_bonus, consumer_demand_index,
             logistics_modifier, has_port
      FROM cities WHERE is_active ORDER BY id`;
    return rows.map((r) => {
      const c = r as unknown as Record<string, number | string | boolean>;
      return {
        id: c.id, code: c.code, name: c.name,
        populationIndex: c.population_index,
        incomeIndex: c.income_index,
        landCostIndex: c.land_cost_index,
        industrialBonus: c.industrial_bonus,
        agricultureBonus: c.agriculture_bonus,
        consumerDemandIndex: c.consumer_demand_index,
        logisticsModifier: c.logistics_modifier,
        hasPort: c.has_port,
      };
    });
  }

  @Get('cities/:code/distances')
  async distances(@Param('code') code: string) {
    const [city] = await this.sql<{ id: number }[]>`
      SELECT id FROM cities WHERE code = ${code.toUpperCase()} AND is_active`;
    if (!city) throw new NotFound('Şehir', code);
    const rows = await this.sql<{ code: string; name: string; distance_index: number; transit_ticks: number }[]>`
      SELECT c.code, c.name, d.distance_index, d.transit_ticks
      FROM city_distances d JOIN cities c ON c.id = d.destination_city_id
      WHERE d.origin_city_id = ${city.id} AND c.is_active
      ORDER BY d.distance_index`;
    return rows.map((r) => ({
      cityCode: r.code, cityName: r.name,
      distanceIndex: r.distance_index,
      transitTicks: r.transit_ticks,
    }));
  }

  @Get('products')
  async products() {
    const rows = await this.sql<Record<string, never>[]>`
      SELECT p.id, p.code, p.name, p.unit, p.base_reference_price, p.unlock_level,
             p.shelf_life_ticks, p.quality_decay_rate, p.weight_per_unit,
             p.is_raw_material, p.is_intermediate, p.is_retail_product,
             pc.code AS category_code, pc.name AS category_name,
             w.importable, w.exportable
      FROM products p
      JOIN product_categories pc ON pc.id = p.category_id
      LEFT JOIN world_market w ON w.product_id = p.id
      WHERE p.is_active ORDER BY p.id`;
    return rows.map((r) => {
      const p = r as unknown as Record<string, never>;
      const price = asMoney(p.base_reference_price as unknown as bigint);
      return {
        id: p.id, code: p.code, name: p.name, unit: p.unit,
        category: { code: p.category_code, name: p.category_name },
        baseReferencePrice: price.toString(),
        baseReferencePriceFormatted: formatMoney(price),
        unlockLevel: p.unlock_level,
        shelfLifeTicks: p.shelf_life_ticks,
        qualityDecayRate: p.quality_decay_rate,
        weightPerUnit: p.weight_per_unit,
        isRawMaterial: p.is_raw_material,
        isIntermediate: p.is_intermediate,
        isRetailProduct: p.is_retail_product,
        trade: { importable: p.importable ?? false, exportable: p.exportable ?? false },
      };
    });
  }

  @Get('facility-types')
  async facilityTypes() {
    const rows = await this.sql<Record<string, never>[]>`
      SELECT id, code, name, category, base_cost, base_capacity, maintenance_cost,
             storage_capacity, construction_ticks, unlock_level, requires_port
      FROM facility_types WHERE is_active ORDER BY unlock_level, id`;
    return rows.map((r) => {
      const f = r as unknown as Record<string, never>;
      const cost = asMoney(f.base_cost as unknown as bigint);
      const maint = asMoney(f.maintenance_cost as unknown as bigint);
      return {
        id: f.id, code: f.code, name: f.name, category: f.category,
        baseCost: cost.toString(), baseCostFormatted: formatMoney(cost),
        baseCapacity: f.base_capacity,
        maintenanceCost: maint.toString(), maintenanceCostFormatted: formatMoney(maint),
        storageCapacity: (f.storage_capacity as unknown as bigint).toString(),
        constructionTicks: f.construction_ticks,
        unlockLevel: f.unlock_level,
        requiresPort: f.requires_port,
      };
    });
  }
}
