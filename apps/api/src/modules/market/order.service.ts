import { Inject, Injectable } from '@nestjs/common';
import { currentTickSeq, type Sql } from '@kapital/db';
import { shippingPerUnit } from '@kapital/economy';
import {
  asMoney, asQty, DomainError, formatMoney, formatQty, money, NotFound,
  qtyFromNumber, TICKS_PER_DAY,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { PlaceOrderDto } from './order.dto.js';

@Injectable()
export class OrderService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /**
   * Emir verir. Eşleşme burada DEĞİL, tur motorunun P2 fazında yapılır:
   * bütün oyuncular aynı defterde, aynı anda, aynı kurallarla eşleşir.
   *
   * Bakiye/stok burada BLOKE EDİLMEZ (escrow yok — bkz. P2 fazı açıklaması):
   * eşleşme anında doğrulanır. Karşılanamayan emir açık kalır.
   */
  async place(userId: string, dto: PlaceOrderDto) {
    const company = await this.companyOf(userId);

    const [facility] = await this.sql<{ id: string; city_id: number; city_name: string }[]>`
      SELECT f.id, f.city_id, c.name AS city_name
      FROM facilities f JOIN cities c ON c.id = f.city_id
      WHERE f.id = ${dto.facilityId}::uuid AND f.company_id = ${company.id}::uuid
        AND f.closed_at IS NULL`;
    if (!facility) throw new NotFound('Tesis', dto.facilityId);

    const [product] = await this.sql<{ id: number; unit: string; unlock_level: number; name: string }[]>`
      SELECT id, unit, unlock_level, name FROM products
      WHERE code = ${dto.productCode} AND is_active`;
    if (!product) throw new NotFound('Ürün', dto.productCode);
    if (company.level < product.unlock_level) {
      throw new DomainError('LEVEL_LOCKED',
        `${product.name} ticareti için seviye ${product.unlock_level} gerekli`,
        { required: product.unlock_level, current: company.level });
    }

    const quantity = qtyFromNumber(dto.quantity);
    const price = money(dto.pricePerUnit);
    const tickSeq = await currentTickSeq(this.sql);

    // SELL emri, tesiste bulunan stoğun ortalama kalitesiyle etiketlenir:
    // alıcının `minQuality` filtresi buna bakar.
    let quality = 70;
    if (dto.side === 'SELL') {
      const [stock] = await this.sql<{ available: bigint; quality: string }[]>`
        SELECT COALESCE(SUM(b.quantity - b.reserved_quantity), 0)::bigint AS available,
               COALESCE(SUM(b.quantity * b.quality) / NULLIF(SUM(b.quantity), 0), 70)::text AS quality
        FROM inventories i JOIN inventory_batches b ON b.inventory_id = i.id
        WHERE i.facility_id = ${facility.id}::uuid AND b.product_id = ${product.id}`;
      if ((stock?.available ?? 0n) <= 0n) {
        throw new DomainError('INSUFFICIENT_STOCK',
          `${facility.city_name} tesisinde satılacak ${product.name} yok`);
      }
      quality = Number(stock!.quality);
    }

    const [order] = await this.sql<{ id: bigint }[]>`
      INSERT INTO market_orders (company_id, facility_id, product_id, city_id, side,
                                 quantity, remaining_quantity, price_per_unit, quality,
                                 min_quality, max_delivery_distance, expires_at_tick)
      VALUES (${company.id}::uuid, ${facility.id}::uuid, ${product.id}, ${facility.city_id},
              ${dto.side}::order_side, ${quantity}, ${quantity}, ${price},
              ${quality.toFixed(3)}, ${(dto.minQuality ?? 0).toFixed(3)},
              ${dto.maxDeliveryDistance ?? null},
              ${tickSeq + BigInt(dto.expiresInTicks ?? TICKS_PER_DAY)})
      RETURNING id`;

    return this.getOne(company.id, order!.id);
  }

  async cancel(userId: string, orderId: string) {
    const company = await this.companyOf(userId);
    const cancelled = await this.sql`
      UPDATE market_orders SET status = 'CANCELLED'
       WHERE id = ${orderId}::bigint AND company_id = ${company.id}::uuid
         AND status IN ('OPEN','PARTIAL')
      RETURNING id`;
    if (cancelled.length === 0) throw new NotFound('Açık emir', orderId);
    return { cancelled: true, orderId };
  }

  async list(userId: string, includeClosed = false) {
    const company = await this.companyOf(userId);
    const rows = await this.sql<Record<string, never>[]>`
      SELECT o.id, o.side, o.status, o.quantity, o.remaining_quantity, o.price_per_unit,
             o.quality, o.min_quality, o.expires_at_tick, o.created_at,
             p.code AS product_code, p.name AS product_name, p.unit,
             c.code AS city_code, c.name AS city_name
      FROM market_orders o
      JOIN products p ON p.id = o.product_id
      JOIN cities c ON c.id = o.city_id
      WHERE o.company_id = ${company.id}::uuid
        AND (${includeClosed} OR o.status IN ('OPEN','PARTIAL'))
      ORDER BY o.created_at DESC LIMIT 200`;
    return rows.map((r) => this.toOrderView(r));
  }

  private async getOne(companyId: string, orderId: bigint) {
    const [row] = await this.sql<Record<string, never>[]>`
      SELECT o.id, o.side, o.status, o.quantity, o.remaining_quantity, o.price_per_unit,
             o.quality, o.min_quality, o.expires_at_tick, o.created_at,
             p.code AS product_code, p.name AS product_name, p.unit,
             c.code AS city_code, c.name AS city_name
      FROM market_orders o
      JOIN products p ON p.id = o.product_id
      JOIN cities c ON c.id = o.city_id
      WHERE o.id = ${orderId} AND o.company_id = ${companyId}::uuid`;
    if (!row) throw new NotFound('Emir', String(orderId));
    return this.toOrderView(row);
  }

  /**
   * Emir defteri — alıcı için "ürün fiyatı / nakliye / toplam maliyet" ayrı
   * gösterilir (madde 16). Bu ayrım olmadan uzak satıcı yanıltıcı biçimde
   * ucuz görünür.
   */
  async book(userId: string, productCode: string, deliveryCityCode?: string) {
    const company = await this.companyOf(userId);
    const [product] = await this.sql<{ id: number; unit: string; weight_per_unit: number; name: string }[]>`
      SELECT id, unit, weight_per_unit, name FROM products WHERE code = ${productCode} AND is_active`;
    if (!product) throw new NotFound('Ürün', productCode);

    const targetCity = deliveryCityCode
      ? (await this.sql<{ id: number }[]>`SELECT id FROM cities WHERE code = ${deliveryCityCode.toUpperCase()}`)[0]
      : (await this.sql<{ id: number }[]>`SELECT home_city_id AS id FROM companies WHERE id = ${company.id}::uuid`)[0];
    if (!targetCity) throw new NotFound('Şehir', deliveryCityCode ?? '');

    const [cfg] = await this.sql<{ value: { baseRatePerKgDistance: string } }[]>`
      SELECT value FROM game_configs WHERE key = 'economy.shipping'
      ORDER BY version DESC LIMIT 1`;
    const baseRate = asMoney(BigInt(cfg?.value.baseRatePerKgDistance ?? '3500'));

    const sells = await this.sql<{
      id: bigint; company_name: string; company_kind: string; city_code: string;
      city_name: string; remaining_quantity: bigint; price_per_unit: bigint; quality: string;
      distance_index: number; transit_ticks: number;
    }[]>`
      SELECT o.id, co.name AS company_name, co.kind::text AS company_kind,
             c.code AS city_code, c.name AS city_name,
             o.remaining_quantity, o.price_per_unit, o.quality::text,
             COALESCE(d.distance_index, 0) AS distance_index,
             COALESCE(d.transit_ticks, 0) AS transit_ticks
      FROM market_orders o
      JOIN companies co ON co.id = o.company_id
      JOIN cities c ON c.id = o.city_id
      LEFT JOIN city_distances d ON d.origin_city_id = o.city_id
                                AND d.destination_city_id = ${targetCity.id}
      WHERE o.product_id = ${product.id} AND o.side = 'SELL'
        AND o.status IN ('OPEN','PARTIAL') AND o.remaining_quantity > 0
      ORDER BY o.price_per_unit LIMIT 100`;

    const buys = await this.sql<{
      id: bigint; company_name: string; city_code: string;
      remaining_quantity: bigint; price_per_unit: bigint; min_quality: string;
    }[]>`
      SELECT o.id, co.name AS company_name, c.code AS city_code,
             o.remaining_quantity, o.price_per_unit, o.min_quality::text
      FROM market_orders o
      JOIN companies co ON co.id = o.company_id
      JOIN cities c ON c.id = o.city_id
      WHERE o.product_id = ${product.id} AND o.side = 'BUY'
        AND o.status IN ('OPEN','PARTIAL') AND o.remaining_quantity > 0
      ORDER BY o.price_per_unit DESC LIMIT 100`;

    return {
      product: { code: productCode, name: product.name, unit: product.unit },
      deliveryCityId: targetCity.id,
      sell: sells.map((s) => {
        const goods = asMoney(s.price_per_unit);
        const ship = shippingPerUnit({
          weightPerUnit: product.weight_per_unit,
          distanceIndex: s.distance_index,
          baseRate,
          logisticsModifier: company.logisticsModifier,
        });
        const total = asMoney((goods as bigint) + (ship as bigint));
        return {
          orderId: s.id.toString(),
          seller: { name: s.company_name, kind: s.company_kind },
          city: { code: s.city_code, name: s.city_name },
          available: s.remaining_quantity.toString(),
          availableFormatted: formatQty(asQty(s.remaining_quantity), product.unit),
          quality: Number(s.quality),
          // ★ Madde 16: üç rakam da ayrı gösterilir
          goodsPrice: goods.toString(), goodsPriceFormatted: formatMoney(goods),
          shippingPerUnit: ship.toString(), shippingPerUnitFormatted: formatMoney(ship),
          totalPerUnit: total.toString(), totalPerUnitFormatted: formatMoney(total),
          distanceIndex: s.distance_index,
          transitTicks: s.transit_ticks,
        };
      }),
      buy: buys.map((b) => ({
        orderId: b.id.toString(),
        buyer: b.company_name,
        cityCode: b.city_code,
        wanted: b.remaining_quantity.toString(),
        maxTotalPerUnit: b.price_per_unit.toString(),
        maxTotalPerUnitFormatted: formatMoney(asMoney(b.price_per_unit)),
        minQuality: Number(b.min_quality),
      })),
    };
  }

  /** Yoldaki mal — hiçbir envanterde değildir, ayrı gösterilir (A3). */
  async shipments(userId: string) {
    const company = await this.companyOf(userId);
    const tickSeq = await currentTickSeq(this.sql);
    const rows = await this.sql<Record<string, never>[]>`
      SELECT s.id, s.quantity, s.delivered_quantity, s.quality, s.unit_cost, s.shipping_cost,
             s.dispatched_tick, s.arrival_tick, s.status,
             p.code AS product_code, p.name AS product_name, p.unit,
             seller.name AS seller_name,
             COALESCE(tf.name, tft.name) AS to_facility, tc.name AS to_city
      FROM shipments s
      JOIN products p ON p.id = s.product_id
      JOIN companies seller ON seller.id = s.from_company_id
      JOIN facilities tf ON tf.id = s.to_facility_id
      JOIN facility_types tft ON tft.id = tf.facility_type_id
      JOIN cities tc ON tc.id = tf.city_id
      WHERE s.to_company_id = ${company.id}::uuid AND s.status IN ('IN_TRANSIT','PARTIAL')
      ORDER BY s.arrival_tick`;

    return rows.map((r) => {
      const s = r as unknown as Record<string, never>;
      const arrival = s.arrival_tick as unknown as bigint;
      return {
        id: (s.id as unknown as bigint).toString(),
        product: { code: s.product_code, name: s.product_name, unit: s.unit },
        seller: s.seller_name,
        destination: `${s.to_facility} · ${s.to_city}`,
        quantity: (s.quantity as unknown as bigint).toString(),
        quantityFormatted: formatQty(asQty(s.quantity as unknown as bigint), s.unit as unknown as string),
        delivered: (s.delivered_quantity as unknown as bigint).toString(),
        quality: Number(s.quality),
        shippingCost: (s.shipping_cost as unknown as bigint).toString(),
        arrivalTick: arrival.toString(),
        ticksRemaining: arrival > tickSeq ? Number(arrival - tickSeq) : 0,
        status: s.status,
      };
    });
  }

  private toOrderView(row: Record<string, never>) {
    const o = row as unknown as Record<string, never>;
    const price = asMoney(o.price_per_unit as unknown as bigint);
    return {
      id: (o.id as unknown as bigint).toString(),
      side: o.side,
      status: o.status,
      product: { code: o.product_code, name: o.product_name, unit: o.unit },
      city: { code: o.city_code, name: o.city_name },
      quantity: (o.quantity as unknown as bigint).toString(),
      remaining: (o.remaining_quantity as unknown as bigint).toString(),
      remainingFormatted: formatQty(asQty(o.remaining_quantity as unknown as bigint), o.unit as unknown as string),
      pricePerUnit: price.toString(),
      pricePerUnitFormatted: formatMoney(price),
      quality: Number(o.quality),
      minQuality: Number(o.min_quality),
      expiresAtTick: (o.expires_at_tick as unknown as bigint).toString(),
      createdAt: new Date(o.created_at as unknown as string).toISOString(),
    };
  }

  private async companyOf(userId: string) {
    const [row] = await this.sql<{ id: string; level: number; logistics_modifier: number }[]>`
      SELECT id, level, logistics_modifier FROM companies WHERE user_id = ${userId}::uuid`;
    if (!row) throw new NotFound('Şirket');
    return { id: row.id, level: row.level, logisticsModifier: row.logistics_modifier };
  }
}
