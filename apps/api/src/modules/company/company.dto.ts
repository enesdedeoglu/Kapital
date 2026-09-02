import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().min(2, 'Şirket adı en az 2 karakter olmalı').max(60),
  cityCode: z.string().length(3, 'Şehir kodu 3 harf olmalı').toUpperCase(),
  /** Onboarding 1. adım: ilk işletme Manav veya Büfe (madde 4). */
  facilityTypeCode: z.enum(['GREENGROCER', 'KIOSK']),
});
export type CreateCompanyDto = z.infer<typeof createCompanySchema>;
