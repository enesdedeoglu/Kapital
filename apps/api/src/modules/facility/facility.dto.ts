import { z } from 'zod';

export const buildFacilitySchema = z.object({
  facilityTypeCode: z.string().min(2).max(40).toUpperCase(),
  cityCode: z.string().length(3, 'Şehir kodu 3 harf olmalı').toUpperCase(),
  name: z.string().min(2).max(60).optional(),
});
export type BuildFacilityDto = z.infer<typeof buildFacilitySchema>;
