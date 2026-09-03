import { z } from 'zod';

export const buySchema = z.object({
  /** Malın teslim edileceği tesis. F2'de yalnız AYNI ŞEHİRDEKİ arzdan alınır. */
  facilityId: z.string().uuid(),
  productCode: z.string().min(2).max(40).toUpperCase(),
  quantity: z.number().positive().max(1_000_000),
  /** Nakliye dahil kabul edilebilir en yüksek birim fiyat (madde 16). */
  maxUnitPrice: z.number().positive().optional(),
});
export type BuyDto = z.infer<typeof buySchema>;
