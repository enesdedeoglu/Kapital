import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Geçerli bir e-posta girin').max(200),
  password: z.string().min(8, 'Parola en az 8 karakter olmalı').max(200),
  displayName: z.string().min(2, 'İsim en az 2 karakter olmalı').max(60),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });
export type RefreshDto = z.infer<typeof refreshSchema>;
