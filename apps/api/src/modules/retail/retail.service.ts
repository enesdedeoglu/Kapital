import { Inject, Injectable } from '@nestjs/common';
import { currentTickSeq, type Sql } from '@kapital/db';
import { reservationCeiling } from '@kapital/economy';
import { asMoney, DomainError, formatMoney, money, NotFound } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { SetPricesDto } from './retail.dto.js';

export interface RetailOfferView {
  productCode: string;
  productName: string;
  unit: string;
  sellingPrice: string;
  sellingPriceFormatted: string;
  enabled: boolean;
  referencePrice: string;
  referencePriceFormatted: string;
  /** Bu fiyatın üstünde tüketici almaz (R10). UI'da uyarı gösterir. */
  reservationCeiling: string;
  reservationCeilingFormatted: string;
  aboveCeiling: boolean;
  availableStock: string;
}

@Injectable()
export class RetailService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async list(userId: string, facilityId: string): Promise<RetailOfferView[]> {
    await this.assertOwned(userId, facilityId);
    const tickSeq = await currentTickSeq(this.sql);

    const rows = await this.sql<Record<string, never>[]>`
      SELECT p.code, p.name, p.unit, p.reservation_price_mult,
             ro.selling_price, ro.enabled,
             COALESCE(h.ema_reference, p.base_reference_price) AS reference,
             COALESCE(st.available, 0) AS available
      FROM retail_offers ro
      JOIN products p ON p.id = ro.product_id
      LEFT JOIN LATERAL (
        SELECT ema_reference FROM price_history
        WHERE product_id = p.id AND city_id = 0 AND tick_id <= ${tickSeq}
        ORDER BY tick_id DESC LIMIT 1
      ) h ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(b.quantity - b.reserved_quantity)::bigint AS available
        FROM inventories i JOIN inventory_batches b ON b.inventory_id = i.id
        WHERE i.facility_id = ro.facility_id AND b.product_id = ro.product_id
      ) st ON TRUE
      WHERE ro.facility_id = ${facilityId}::uuid
      ORDER BY p.id`;

    return rows.map((r) => {
      const o = r as unknown as Record<string, never>;
      const price = asMoney(o.selling_price as unknown as bigint);
      const reference = asMoney(o.reference as unknown as bigint);
      const ceiling = reservationCeiling({
        productId: 0, baseDemand: 0, referencePrice: reference,
        reservationPriceMult: o.reservation_price_mult as unknown as number,
        priceSensitivity: 1,
      });
      return {
        productCode: o.code as unknown as string,
        productName: o.name as unknown as string,
        unit: o.unit as unknown as string,
        sellingPrice: price.toString(),
        sellingPriceFormatted: formatMoney(price),
        enabled: o.enabled as unknown as boolean,
        referencePrice: reference.toString(),
        referencePriceFormatted: formatMoney(reference),
        reservationCeiling: ceiling.toString(),
        reservationCeilingFormatted: formatMoney(ceiling),
        aboveCeiling: price > ceiling,
        availableStock: (o.available as unknown as bigint).toString(),
      };
    });
  }

  async setPrices(userId: string, facilityId: string, dto: SetPricesDto): Promise<RetailOfferView[]> {
    await this.assertOwned(userId, facilityId);

    for (const entry of dto.prices) {
      const [product] = await this.sql<{ id: number; is_retail_product: boolean }[]>`
        SELECT id, is_retail_product FROM products WHERE code = ${entry.productCode} AND is_active`;
      if (!product) throw new NotFound('Ürün', entry.productCode);
      if (!product.is_retail_product) {
        throw new DomainError('VALIDATION', `${entry.productCode} perakende ürünü değil`, {
          productCode: entry.productCode,
        });
      }
      await this.sql`
        INSERT INTO retail_offers (facility_id, product_id, selling_price, enabled)
        VALUES (${facilityId}::uuid, ${product.id}, ${money(entry.sellingPrice)}, ${entry.enabled})
        ON CONFLICT (facility_id, product_id)
        DO UPDATE SET selling_price = EXCLUDED.selling_price,
                      enabled = EXCLUDED.enabled, updated_at = NOW()`;
    }
    return this.list(userId, facilityId);
  }

  private async assertOwned(userId: string, facilityId: string): Promise<void> {
    const [row] = await this.sql`
      SELECT 1 FROM facilities f JOIN companies c ON c.id = f.company_id
      WHERE f.id = ${facilityId}::uuid AND c.user_id = ${userId}::uuid AND f.closed_at IS NULL`;
    if (!row) throw new NotFound('Tesis', facilityId);
  }
}
