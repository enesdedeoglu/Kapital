import { z } from 'zod';

export const takeLoanSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  /** Vade (tur). Verilmezse kademenin azami vadesi kullanılır. */
  termTicks: z.number().int().positive().max(10_000).optional(),
});
export type TakeLoanDto = z.infer<typeof takeLoanSchema>;

/**
 * Önizleme girdisi — `take` ile AYNI alanlar, ama tutar limiti aşabilir.
 *
 * ★ Önizleme reddetmez, RAPOR EDER: oyuncu "ne kadar alabilirim"i denerken
 * her fazla rakamda hata almamalı; yanıt `exceedsLimit` diyip limiti söyler.
 */
export const previewLoanSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  termTicks: z.coerce.number().int().positive().max(10_000).optional(),
});
export type PreviewLoanDto = z.infer<typeof previewLoanSchema>;

