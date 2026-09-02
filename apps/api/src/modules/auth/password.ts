import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

interface ScryptParams { N: number; r: number; p: number; maxmem: number }

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number, options: ScryptParams,
) => Promise<Buffer>;

/**
 * OWASP önerisi seviyesinde scrypt. Yerleşik crypto — native bağımlılık yok.
 * `maxmem` AÇIKÇA verilmeli: N=2^15, r=8 tam 128·N·r = 32 MiB ister ve Node'un
 * varsayılan 32 MiB sınırını sıyırıp ERR_CRYPTO_INVALID_SCRYPT_PARAMS verir.
 */
const PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const derived = await scrypt(password, Buffer.from(saltB64!, 'base64'), KEYLEN, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
  });
  const expected = Buffer.from(hashB64!, 'base64');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
