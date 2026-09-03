import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const envPath = join(process.cwd(), '../../.env');
if (existsSync(envPath)) {
  const parsed = parseEnv(readFileSync(envPath, 'utf8')) as Record<string, string>;
  for (const [k, v] of Object.entries(parsed)) if (process.env[k] === undefined) process.env[k] = v;
}
// API havuzu testte ASLA geliştirme veritabanına bağlanmaz.
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL gerekli');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
