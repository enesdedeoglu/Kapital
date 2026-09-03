import { z } from 'zod';

export const placeOrderSchema = z.object({
  side: z.enum(['BUY', 'SELL']),
  /** BUY: malın teslim edileceği tesis · SELL: malın çıkacağı tesis. */
  facilityId: z.string().uuid(),
  productCode: z.string().min(2).max(40).toUpperCase(),
  quantity: z.number().positive().max(10_000_000),
  /**
   * BUY için NAKLİYE DAHİL tavan birim fiyat (madde 16, C2).
   * SELL için satıcının istediği birim fiyat (nakliyeyi alıcı öder).
   */
  pricePerUnit: z.number().positive().max(100_000_000),
  /** BUY: kabul edilen en düşük kalite. */
  minQuality: z.number().min(0).max(100).optional(),
  /** BUY: bu mesafe endeksinin ötesindeki satıcılar elenir. */
  maxDeliveryDistance: z.number().positive().max(100).optional(),
  /** Emrin kaç tur açık kalacağı (varsayılan 96 = 1 gün). */
  expiresInTicks: z.number().int().positive().max(2688).optional(),
});
export type PlaceOrderDto = z.infer<typeof placeOrderSchema>;
