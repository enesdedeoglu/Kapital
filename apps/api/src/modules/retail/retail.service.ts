import { Inject, Injectable } from '@nestjs/common';
import { getConfig, loadConfigSnapshot } from '@kapital/config';
import { currentTickSeq, type Sql } from '@kapital/db';
import { reservationCeiling } from '@kapital/economy';
import {
  asMoney, asQty, divRoundHalfEven, DomainError, formatMoney, formatQty, money,
  mulMoney, NotFound,
} from '@kapital/shared';
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

/**
 * Rafa KONABİLECEK ürün — henüz rafta olmayan perakende ürünleri.
 *
 * ★ BU LİSTE OLMADAN DÖNGÜ KAPANMIYORDU (R96). Rafa ürün koyan tek yol
 * `PUT /retail/:id/prices` ve o uç upsert yapıyor, yani yeni ürün EKLEYEBİLİR.
 * Ama arayüz yalnız `GET /retail/:id`in döndüğü MEVCUT teklifleri
 * düzenleyebiliyordu: raf boşsa düzenlenecek hiçbir şey yok, ekleyecek yol da
 * yok. Oyuncu piyasadan domates alıyor, malı dükkâna geliyor, rafa
 * koyamıyordu — ciro sıfır kalıyordu.
 *
 * Ölçüldü (kapital_dev kopyası): manavda 100 kg domates varken
 * `GET /retail/:id` → `[]`, ve panelin boş hâli "piyasadan perakende ürün
 * alınca burada fiyat belirleyebilirsin" diyordu. Tam da yapılmış olan şey.
 */
export interface AddableProductView {
  productCode: string;
  productName: string;
  unit: string;
  /** Bu tesisin deposunda satılmayı bekleyen miktar (0 olabilir). */
  availableStock: string;
  availableStockFormatted: string;
  referencePrice: string;
  referencePriceFormatted: string;
  reservationCeiling: string;
  reservationCeilingFormatted: string;
  /**
   * Önerilen açılış fiyatı: `referans × economy.retail.retailMarkup`.
   *
   * ★ SUNUCUDA HESAPLANIR (ADR-0001): çarpım bigint + bankacı yuvarlamasıdır;
   * istemcide float ile yeniden yazmak para matematiğini ikinci bir yere
   * kopyalamak olurdu.
   *
   * ★ TAM KURUŞA YUVARLANIR, ve bu bir düzeltmedir. `referans × 1,35` çarpımı
   * Money ölçeğinde (1 ₺ = 10.000) kuruş altı artık bırakır; oyuncunun
   * girebileceği en küçük birim ise KURUŞ. Yuvarlanmadığında aynı ekranda iki
   * farklı sayı çıkıyordu: `formatMoney` kuruş altını KESİYOR (337469 →
   * "33,74 ₺"), panelin alana yazdığı ondalık ise yukarı yuvarlıyordu
   * ("33,75"). Öneri artık girilebilir bir değer, yani gösterilen ile
   * kaydedilen aynı sayı.
   *
   * ★ TAVANA KIRPILMAZ: markup 1,35, rezervasyon çarpanı 3,0 — öneri tavanın
   * yanına bile yaklaşmaz. Kırpma dalı bugün ERİŞİLEMEZ olurdu; tavanın
   * üstündeki fiyat uyarısını panel zaten `aboveCeiling` ile veriyor.
   */
  suggestedPrice: string;
  suggestedPriceFormatted: string;
}

export interface ShelfView {
  offers: RetailOfferView[];
  addable: AddableProductView[];
}

@Injectable()
export class RetailService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async list(userId: string, facilityId: string): Promise<ShelfView> {
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

    const offers = rows.map((r) => {
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

    return { offers, addable: await this.addable(facilityId, tickSeq) };
  }

  /**
   * Rafta olmayan perakende ürünleri. Sıralama STOKLU ÜRÜN ÖNCE: oyuncunun
   * elinde olan mal, listenin dibinde aranacak bir şey değil.
   */
  private async addable(facilityId: string, tickSeq: bigint): Promise<AddableProductView[]> {
    const snapshot = await loadConfigSnapshot(this.sql, tickSeq);
    const { retailMarkup } = getConfig<{ retailMarkup: number }>(snapshot, 'economy.retail');

    const rows = await this.sql<Record<string, never>[]>`
      SELECT p.code, p.name, p.unit, p.reservation_price_mult,
             COALESCE(h.ema_reference, p.base_reference_price) AS reference,
             COALESCE(st.available, 0) AS available
      FROM products p
      LEFT JOIN LATERAL (
        SELECT ema_reference FROM price_history
        WHERE product_id = p.id AND city_id = 0 AND tick_id <= ${tickSeq}
        ORDER BY tick_id DESC LIMIT 1
      ) h ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(b.quantity - b.reserved_quantity)::bigint AS available
        FROM inventories i JOIN inventory_batches b ON b.inventory_id = i.id
        WHERE i.facility_id = ${facilityId}::uuid AND b.product_id = p.id
      ) st ON TRUE
      WHERE p.is_active AND p.is_retail_product
        AND NOT EXISTS (
          SELECT 1 FROM retail_offers ro
           WHERE ro.facility_id = ${facilityId}::uuid AND ro.product_id = p.id
        )
      ORDER BY COALESCE(st.available, 0) DESC, p.id`;

    return rows.map((r) => {
      const a = r as unknown as Record<string, never>;
      const reference = asMoney(a.reference as unknown as bigint);
      const ceiling = reservationCeiling({
        productId: 0, baseDemand: 0, referencePrice: reference,
        reservationPriceMult: a.reservation_price_mult as unknown as number,
        priceSensitivity: 1,
      });
      // Kuruş = Money ölçeğinde 100 birim; öneri tam kuruşa oturtulur.
      const suggested = asMoney(
        divRoundHalfEven(mulMoney(reference, retailMarkup).value, 100n) * 100n,
      );
      const stock = asQty(a.available as unknown as bigint);
      const unit = a.unit as unknown as string;
      return {
        productCode: a.code as unknown as string,
        productName: a.name as unknown as string,
        unit,
        availableStock: (stock as bigint).toString(),
        availableStockFormatted: formatQty(stock, unit),
        referencePrice: reference.toString(),
        referencePriceFormatted: formatMoney(reference),
        reservationCeiling: ceiling.toString(),
        reservationCeilingFormatted: formatMoney(ceiling),
        suggestedPrice: suggested.toString(),
        suggestedPriceFormatted: formatMoney(suggested),
      };
    });
  }

  async setPrices(userId: string, facilityId: string, dto: SetPricesDto): Promise<ShelfView> {
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
