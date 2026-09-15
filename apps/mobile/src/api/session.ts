/**
 * Oturum saklama ve yenileme.
 *
 * Jeton `expo-secure-store` ile cihazın anahtarlığında tutulur —
 * AsyncStorage düz metindir ve yenileme jetonu orada durmamalı.
 */
import * as SecureStore from 'expo-secure-store';
import { request } from './client';
import type { OturumYaniti } from './types';

const ERISIM = 'kapital.accessToken';
const YENILEME = 'kapital.refreshToken';

export async function oturumuOku(): Promise<{ access: string; refresh: string } | null> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ERISIM),
    SecureStore.getItemAsync(YENILEME),
  ]);
  return access && refresh ? { access, refresh } : null;
}

export async function oturumuYaz(yanit: OturumYaniti): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ERISIM, yanit.accessToken),
    SecureStore.setItemAsync(YENILEME, yanit.refreshToken),
  ]);
}

export async function oturumuSil(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ERISIM),
    SecureStore.deleteItemAsync(YENILEME),
  ]);
}

export async function girisYap(email: string, password: string): Promise<OturumYaniti> {
  const yanit = await request<OturumYaniti>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  await oturumuYaz(yanit);
  return yanit;
}

export async function kayitOl(
  email: string, password: string, displayName: string,
): Promise<OturumYaniti> {
  const yanit = await request<OturumYaniti>('/auth/register', {
    method: 'POST',
    body: { email, password, displayName },
  });
  await oturumuYaz(yanit);
  return yanit;
}

/** Erişim jetonu süresi dolduğunda yenileme jetonuyla tazeler. */
export async function yenile(refreshToken: string): Promise<OturumYaniti> {
  const yanit = await request<OturumYaniti>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
  await oturumuYaz(yanit);
  return yanit;
}
