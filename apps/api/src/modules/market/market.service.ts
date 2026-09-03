import { Inject, Injectable } from '@nestjs/common';
import { addBatch, currentTickSeq, transfer, type Sql } from '@kapital/db';
import { expiryTick } from '@kapital/economy';
import {
  asMoney, asQty, DomainError, formatMoney, formatQty, InsufficientFunds,
  money, NotFound, priceTimesQty, qtyFromNumber, type Money, type Qty,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { BuyDto } from './market.dto.js';

export interface BuyResult {
  productCode: string;
  requested: string;
  purchased: string;
  purchasedFormatted: string;
  totalCost: string;
  totalCostFormatted: string;
  avgUnitPrice: string;
  avgUnitPriceFormatted: string;
  fills: { sellerName: string; quantity: string; unitPrice: string; quality: number }[];
  complete: boolean;
}

@Injectable()
export class MarketService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /** Şehirdeki açık satış emirlerini fiyat sırasıyla listeler. */
  async offers(cityCode: string, productCode?: string) {
    const rows = await this.sql<Record<string, never>[]>`
      SELECT o.id, o.price_per_unit, o.remaining_quantity, o.quality,
             p.code AS product_code, p.name AS product_name, p.unit,
             c.name AS seller_name, c.kind AS seller_kind,
             ct.code AS city_code
      FROM market_orders o
      JOIN products p  ON p.id = o.product_id
      JOIN companies c ON c.id = o.company_id
      JOIN cities ct   ON ct.id = o.city_id
      WHERE o.side = 'SELL' AND o.status IN ('OPEN','PARTIAL') AND o.remaining_quantity > 0
        AND ct.code = ${cityCode.toUpperCase()}
        AND (${productCode?.toUpperCase() ?? null}::text IS NULL
             OR p.code = ${productCode?.toUpperCase() ?? null}::text)
      ORDER BY p.id, o.price_per_unit`;

    return rows.map((r) => {
      const o = r as unknown as Record<string, never>;
      const price = asMoney(o.price_per_unit as unknown as bigint);
      const qty = asQty(o.remaining_quantity as unknown as bigint);
      return {
        orderId: (o.id as unknown as bigint).toString(),
        product: { code: o.product_code, name: o.product_name, unit: o.unit },
        seller: { name: o.seller_name, kind: o.seller_kind },
        cityCode: o.city_code,
        unitPrice: price.toString(),
        unitPriceFormatted: formatMoney(price),
        available: qty.toString(),
        availableFormatted: formatQty(qty, o.unit as unknown as string),
        quality: Number(o.quality),
      };
    });
  }

  /**
   * Anında doldurmalı satın alma — MVP-0.
   *
   * F4'te bunun yerine tam emir defteri gelir: BUY emri, escrow, asenkron
   * eşleştirme, nakliye maliyeti ve transit süresi. Şimdilik yalnız AYNI
   * ŞEHİRDEKİ arzdan alınır ve nakliye yoktur (docs/08 MVP-0).
   */
  async buy(userId: string, dto: BuyDto): Promise<BuyResult> {
    const [company] = await this.sql<{ id: string; cash: bigint }[]>`
      SELECT id, cash FROM companies WHERE user_id = ${userId}::uuid`;
    if (!company) throw new NotFound('Şirket');

    const [facility] = await this.sql<{ id: string; city_id: number; inventory_id: string }[]>`
      SELECT f.id, f.city_id, i.id AS inventory_id
      FROM facilities f JOIN inventories i ON i.facility_id = f.id
      WHERE f.id = ${dto.facilityId}::uuid AND f.company_id = ${company.id}::uuid
        AND f.closed_at IS NULL`;
    if (!facility) throw new NotFound('Tesis', dto.facilityId);

    const [product] = await this.sql<{ id: number; code: string; unit: string; shelf_life_ticks: number | null }[]>`
      SELECT id, code, unit, shelf_life_ticks FROM products
      WHERE code = ${dto.productCode} AND is_active`;
    if (!product) throw new NotFound('Ürün', dto.productCode);

    const wanted = qtyFromNumber(dto.quantity);
    const priceCeiling = dto.maxUnitPrice === undefined ? null : money(dto.maxUnitPrice);
    const tickSeq = await currentTickSeq(this.sql);

    const orders = await this.sql<{
      id: bigint; company_id: string; seller_name: string;
      price_per_unit: bigint; remaining_quantity: bigint; quality: string;
    }[]>`
      SELECT o.id, o.company_id, c.name AS seller_name,
             o.price_per_unit, o.remaining_quantity, o.quality
      FROM market_orders o JOIN companies c ON c.id = o.company_id
      WHERE o.side = 'SELL' AND o.status IN ('OPEN','PARTIAL')
        AND o.product_id = ${product.id} AND o.city_id = ${facility.city_id}
        AND o.remaining_quantity > 0
        AND o.company_id <> ${company.id}::uuid
        AND (${priceCeiling}::bigint IS NULL OR o.price_per_unit <= ${priceCeiling}::bigint)
      ORDER BY o.price_per_unit, o.id`;

    if (orders.length === 0) {
      throw new DomainError('NOT_FOUND', 'Bu şehirde uygun satış emri yok', {
        productCode: product.code, cityId: facility.city_id,
      });
    }

    const fills: BuyResult['fills'] = [];
    let purchased = 0n;
    let totalCost = 0n;

    for (const order of orders) {
      if (purchased >= wanted) break;
      const take = min(wanted - purchased, order.remaining_quantity);
      if (take <= 0n) continue;

      const unitPrice = asMoney(order.price_per_unit);
      const cost = priceTimesQty(unitPrice, asQty(take)).value;

      try {
        await this.fill(this.sql, {
          tickSeq, take, cost, unitPrice, order, product, facility, company,
        });
      } catch (error) {
        if (error instanceof InsufficientFunds) break; // parası bitti, kısmi alım
        throw error;
      }

      purchased += take;
      totalCost += cost as bigint;
      fills.push({
        sellerName: order.seller_name,
        quantity: take.toString(),
        unitPrice: unitPrice.toString(),
        quality: Number(order.quality),
      });
    }

    if (purchased === 0n) {
      throw new InsufficientFunds({
        message: 'Alım yapılamadı — bakiye yetersiz',
        available: company.cash.toString(),
      });
    }

    const avgUnitPrice = asMoney((totalCost * 1000n) / purchased);
    return {
      productCode: product.code,
      requested: wanted.toString(),
      purchased: purchased.toString(),
      purchasedFormatted: formatQty(asQty(purchased), product.unit),
      totalCost: totalCost.toString(),
      totalCostFormatted: formatMoney(asMoney(totalCost)),
      avgUnitPrice: avgUnitPrice.toString(),
      avgUnitPriceFormatted: formatMoney(avgUnitPrice),
      fills,
      complete: purchased >= wanted,
    };
  }

  /** Tek emir dolumu — para, stok ve işlem kaydı TEK transaction içinde. */
  private async fill(sql: Sql, ctx: {
    tickSeq: bigint; take: bigint; cost: Money; unitPrice: Money;
    order: { id: bigint; company_id: string; quality: string };
    product: { id: number; shelf_life_ticks: number | null };
    facility: { id: string; city_id: number; inventory_id: string };
    company: { id: string };
  }): Promise<void> {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;

      // Emri kilitle ve stoğu düş — aynı emrin iki kez satılmasını engeller
      const claimed = await t`
        UPDATE market_orders
           SET remaining_quantity = remaining_quantity - ${ctx.take},
               status = CASE WHEN remaining_quantity - ${ctx.take} = 0
                             THEN 'FILLED'::order_status ELSE 'PARTIAL'::order_status END
         WHERE id = ${ctx.order.id} AND remaining_quantity >= ${ctx.take}
        RETURNING id`;
      if (claimed.length === 0) return; // başkası kaptı

      await transfer(t, {
        tickId: ctx.tickSeq,
        fromCompanyId: ctx.company.id,
        toCompanyId: ctx.order.company_id,
        amount: ctx.cost,
        account: 'TRADE',
        reason: 'toptan alım',
        refType: 'order',
        refId: ctx.order.id.toString(),
      });

      await addBatch(t, {
        inventoryId: ctx.facility.inventory_id,
        productId: ctx.product.id,
        quantity: asQty(ctx.take),
        quality: ctx.order.quality,
        unitCost: ctx.unitPrice,
        producedInTick: ctx.tickSeq,
        expiresAtTick: expiryTick(ctx.tickSeq, ctx.product.shelf_life_ticks),
        sourceCompanyId: ctx.order.company_id,
      });

      await t`
        INSERT INTO market_trades (tick_id, sell_order_id, buyer_company_id, seller_company_id,
                                   product_id, from_city_id, to_city_id, quantity,
                                   price_per_unit, quality)
        VALUES (${ctx.tickSeq}, ${ctx.order.id}, ${ctx.company.id}::uuid,
                ${ctx.order.company_id}::uuid, ${ctx.product.id}, ${ctx.facility.city_id},
                ${ctx.facility.city_id}, ${ctx.take}, ${ctx.unitPrice}, ${ctx.order.quality})`;

      await t`UPDATE company_stats SET total_trade_volume = total_trade_volume + ${ctx.cost}
              WHERE company_id = ${ctx.company.id}::uuid`;
    });
  }
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
