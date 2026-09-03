import { z } from 'zod';

export const takeLoanSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  /** Vade (tur). Verilmezse kademenin azami vadesi kullanılır. */
  termTicks: z.number().int().positive().max(10_000).optional(),
});
export type TakeLoanDto = z.infer<typeof takeLoanSchema>;
