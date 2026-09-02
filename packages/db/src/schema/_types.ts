import { customType, bigint } from 'drizzle-orm/pg-core';

/** PostgreSQL citext — büyük/küçük harf duyarsız metin (e-posta). */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** Para: BIGINT, 1 ₺ = 10.000 (ADR-0001). TS tarafında `Money` olarak işaretlenir. */
export const moneyCol = (name: string) => bigint(name, { mode: 'bigint' });
/** Miktar: BIGINT, 1 birim = 1.000. */
export const qtyCol = (name: string) => bigint(name, { mode: 'bigint' });
