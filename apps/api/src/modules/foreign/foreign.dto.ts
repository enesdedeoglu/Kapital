import { z } from 'zod';

export const foreignTradeSchema = z.object({
  /** Liman tesisi — yalnız limanı olan şehirlerde kurulabilir (docs/12 §3.5). */
  facilityId: z.string().uuid(),
  productCode: z.string().min(2).max(40).toUpperCase(),
  quantity: z.number().positive().max(10_000_000),
});
export type ForeignTradeDto = z.infer<typeof foreignTradeSchema>;

export const fxConvertSchema = z.object({
  side: z.enum(['BUY_USD', 'SELL_USD']),
  usdAmount: z.number().positive().max(100_000_000),
});
export type FxConvertDto = z.infer<typeof fxConvertSchema>;
