import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

let loaded = false;

/**
 * Depo kökündeki .env dosyasını yükler.
 *
 * ÖNEMLİ: zaten tanımlı değişkenlerin ÜZERİNE YAZMAZ. `process.loadEnvFile()`
 * üzerine yazar; testler ve CI kendi DATABASE_URL'ini vermek zorunda olduğu
 * için bu davranış kabul edilemez (testler geliştirme veritabanına bağlanırdı).
 */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      try {
        const parsed = parseEnv(readFileSync(candidate, 'utf8')) as Record<string, string>;
        for (const [key, value] of Object.entries(parsed)) {
          if (process.env[key] === undefined) process.env[key] = value;
        }
      } catch { /* okunamadıysa sessiz geç */ }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} ortam değişkeni tanımlı değil`);
  return value;
}
