import { z } from 'zod';

export const transferStockSchema = z.object({
  fromFacilityId: z.string().uuid(),
  toFacilityId: z.string().uuid(),
  productCode: z.string().min(2).max(40).toUpperCase(),
  quantity: z.number().positive().max(10_000_000),
});
export type TransferStockDto = z.infer<typeof transferStockSchema>;
