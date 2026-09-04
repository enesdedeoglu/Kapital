import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from '@kapital/db';
import { asMoney, asQty, DomainError, formatMoney, money, NotFound, qtyFromNumber } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { SetStandingOrderDto } from './standing.dto.js';

export interface StandingOrderView {
  id: string;
  facilityId: string;
  product: { code: string; name: string };
  kind: 'RESTOCK' | 'SELL_SURPLUS';
  targetQuantity: string;
  maxPricePerUnit: string | null;
  minPricePerUnit: string | null;
  enabled: boolean;
  lastRunTick: string | null;
  explanation: string;
}

/**
 * Kalıcı emirler — oyuncunun önceden tanımladığı kural.
 *
 * docs/00'ın 3. ilkesi "oyuncu offline'ken ekonomi devam eder" der. Motor
 * devam ediyordu ama oyuncuya katılma yolu yoktu: girmeyen oyuncunun rafı
 * boşalıyor, bakımı işlemeye devam ediyordu.
 *
 * Bu bir otomasyon değil, DELEGE EDİLMİŞ KARARdır: hedefi ve fiyat sınırını
 * oyuncu koyar, motor yalnız uygular (ADR-0004'ün NPC ilkesiyle aynı çizgi).
 */
@Injectable()
export class StandingService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async list(userId: string): Promise<StandingOrderView[]> {
    const company = await this.companyOf(userId);
    const rows = await this.sql<Record<string, never>[]>`
      SELECT so.id, so.facility_id, p.code, p.name, so.kind, so.target_quantity,
             so.max_price, so.min_price, so.enabled, so.last_run_tick
        FROM standing_orders so
        JOIN products p ON p.id = so.product_id
       WHERE so.company_id = ${company.id}::uuid
       ORDER BY so.facility_id, p.id`;
    return rows.map((r) => this.toView(r as never));
  }

  async set(userId: string, dto: SetStandingOrderDto): Promise<StandingOrderView> {
    const company = await this.companyOf(userId);

    const [facility] = await this.sql<{ id: string }[]>`
      SELECT id FROM facilities
       WHERE id = ${dto.facilityId}::uuid AND company_id = ${company.id}::uuid
         AND closed_at IS NULL`;
    if (!facility) throw new NotFound('Tesis', dto.facilityId);

    const [product] = await this.sql<{ id: number; name: string; unlock_level: number }[]>`
      SELECT id, name, unlock_level FROM products WHERE code = ${dto.productCode} AND is_active`;
    if (!product) throw new NotFound('Ürün', dto.productCode);
    if (company.level < product.unlock_level) {
      throw new DomainError('LEVEL_LOCKED',
        `${product.name} için seviye ${product.unlock_level} gerekli`,
        { required: product.unlock_level, current: company.level });
    }

    if (dto.kind === 'RESTOCK' && dto.minPricePerUnit !== undefined) {
      throw new DomainError('VALIDATION', 'Stok tamamlama kuralında taban fiyat kullanılmaz');
    }
    if (dto.kind === 'SELL_SURPLUS' && dto.maxPricePerUnit !== undefined) {
      throw new DomainError('VALIDATION', 'Fazla satış kuralında tavan fiyat kullanılmaz');
    }

    const [row] = await this.sql<Record<string, never>[]>`
      INSERT INTO standing_orders (company_id, facility_id, product_id, kind,
                                   target_quantity, max_price, min_price, enabled)
      VALUES (${company.id}::uuid, ${facility.id}::uuid, ${product.id}, ${dto.kind},
              ${qtyFromNumber(dto.targetQuantity)},
              ${dto.maxPricePerUnit === undefined ? null : money(dto.maxPricePerUnit)},
              ${dto.minPricePerUnit === undefined ? null : money(dto.minPricePerUnit)},
              ${dto.enabled})
      ON CONFLICT (facility_id, product_id, kind) DO UPDATE
        SET target_quantity = EXCLUDED.target_quantity,
            max_price = EXCLUDED.max_price,
            min_price = EXCLUDED.min_price,
            enabled = EXCLUDED.enabled,
            updated_at = now()
      RETURNING id, facility_id, ${dto.productCode} AS code, ${product.name} AS name,
                kind, target_quantity, max_price, min_price, enabled, last_run_tick`;
    return this.toView(row as never);
  }

  async remove(userId: string, id: string): Promise<{ removed: boolean }> {
    const company = await this.companyOf(userId);
    const removed = await this.sql`
      DELETE FROM standing_orders
       WHERE id = ${id}::bigint AND company_id = ${company.id}::uuid
      RETURNING id`;
    if (removed.length === 0) throw new NotFound('Kalıcı emir', id);
    return { removed: true };
  }

  private toView(r: {
    id: bigint; facility_id: string; code: string; name: string;
    kind: 'RESTOCK' | 'SELL_SURPLUS'; target_quantity: bigint;
    max_price: bigint | null; min_price: bigint | null;
    enabled: boolean; last_run_tick: bigint | null;
  }): StandingOrderView {
    const target = Number(asQty(r.target_quantity)) / 1000;
    return {
      id: r.id.toString(),
      facilityId: r.facility_id,
      product: { code: r.code, name: r.name },
      kind: r.kind,
      targetQuantity: r.target_quantity.toString(),
      maxPricePerUnit: r.max_price === null ? null : formatMoney(asMoney(r.max_price)),
      minPricePerUnit: r.min_price === null ? null : formatMoney(asMoney(r.min_price)),
      enabled: r.enabled,
      lastRunTick: r.last_run_tick?.toString() ?? null,
      // Oyuncu kuralın ne yapacağını okuyarak anlamalı; deneyerek değil.
      explanation: r.kind === 'RESTOCK'
        ? `Raf ${target.toLocaleString('tr-TR')} ${r.name} altına düşünce otomatik alım yapılır` +
          (r.max_price === null ? '.' : `, birim fiyat ${formatMoney(asMoney(r.max_price))} üstüne çıkmaz.`)
        : `${target.toLocaleString('tr-TR')} ${r.name} üstündeki fazla otomatik satışa çıkar` +
          (r.min_price === null ? '.' : `, birim fiyat ${formatMoney(asMoney(r.min_price))} altına inmez.`),
    };
  }

  private async companyOf(userId: string) {
    const [company] = await this.sql<{ id: string; level: number }[]>`
      SELECT id, level FROM companies WHERE user_id = ${userId}::uuid`;
    if (!company) throw new NotFound('Şirket', userId);
    return company;
  }
}
