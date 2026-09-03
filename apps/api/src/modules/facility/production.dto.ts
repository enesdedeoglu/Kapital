import { z } from 'zod';

export const setRecipeSchema = z.object({
  /** Üretilecek ürünün kodu; tesis tipi bu ürünü üretebiliyor olmalı. */
  outputProductCode: z.string().min(2).max(40).toUpperCase(),
  enabled: z.boolean().default(true),
});
export type SetRecipeDto = z.infer<typeof setRecipeSchema>;
