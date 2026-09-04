import { z } from 'zod';

export const setStandingOrderSchema = z.object({
  facilityId: z.string().uuid(),
  productCode: z.string().min(2).max(40).toUpperCase(),
  /** RESTOCK: hedefin altına düşünce al · SELL_SURPLUS: hedefin üstünü sat. */
  kind: z.enum(['RESTOCK', 'SELL_SURPLUS']),
  /** Elde tutulmak istenen miktar. */
  targetQuantity: z.number().positive().max(10_000_000),
  /** RESTOCK: bu fiyatın üstüne teklif verilmez. */
  maxPricePerUnit: z.number().positive().max(100_000_000).optional(),
  /** SELL_SURPLUS: bu fiyatın altına satılmaz. */
  minPricePerUnit: z.number().positive().max(100_000_000).optional(),
  enabled: z.boolean().default(true),
});
export type SetStandingOrderDto = z.infer<typeof setStandingOrderSchema>;
