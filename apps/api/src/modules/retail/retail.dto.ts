import { z } from 'zod';

export const setPricesSchema = z.object({
  prices: z.array(z.object({
    productCode: z.string().min(2).max(40).toUpperCase(),
    sellingPrice: z.number().positive().max(100_000_000),
    enabled: z.boolean().default(true),
  })).min(1).max(40),
});
export type SetPricesDto = z.infer<typeof setPricesSchema>;
