import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '@kapital/db';
import { prepareTestDb } from '@kapital/db/testing';
import { CONFIG_KEYS, getConfig, loadConfigSnapshot, publishConfig, type StartConfig } from './index.js';

let sql: Sql;
beforeAll(async () => { sql = await prepareTestDb(); });
afterAll(async () => { await sql?.end({ timeout: 5 }); });
beforeEach(async () => { await sql`DELETE FROM game_configs WHERE key LIKE 'test.%'`; });

describe('config anlık görüntüsü', () => {
  it('seed edilmiş değerleri nesne olarak okur (JSON çift kodlanmamış)', async () => {
    const snapshot = await loadConfigSnapshot(sql, 0n);
    const start = getConfig<StartConfig>(snapshot, CONFIG_KEYS.start);
    expect(typeof start).toBe('object');
    expect(start.cash).toBe('300000000');           // 30.000 ₺
    expect(start.facilityChoices).toEqual(['GREENGROCER', 'KIOSK']);
  });

  it('her anahtar için EN SON sürümü döndürür', async () => {
    await publishConfig(sql, 'test.demo', { v: 1 });
    const v2 = await publishConfig(sql, 'test.demo', { v: 2 });
    expect(v2).toBe(2);

    const snapshot = await loadConfigSnapshot(sql, 0n);
    expect(getConfig<{ v: number }>(snapshot, 'test.demo').v).toBe(2);
    expect(snapshot.versions['test.demo']).toBe(2);
  });

  it('geleceğe planlanmış sürüm bugünkü turu etkilemez (R12)', async () => {
    await publishConfig(sql, 'test.plan', { v: 'simdi' });
    await publishConfig(sql, 'test.plan', { v: 'sonra' }, { effectiveFromTick: 500n });

    const now = await loadConfigSnapshot(sql, 100n);
    expect(getConfig<{ v: string }>(now, 'test.plan').v).toBe('simdi');

    const later = await loadConfigSnapshot(sql, 600n);
    expect(getConfig<{ v: string }>(later, 'test.plan').v).toBe('sonra');
  });

  it('eski sürüm silinmez — denetlenebilir kalır', async () => {
    await publishConfig(sql, 'test.audit', { rate: 0.1 });
    await publishConfig(sql, 'test.audit', { rate: 0.2 });
    const rows = await sql`SELECT version FROM game_configs WHERE key = 'test.audit' ORDER BY version`;
    expect(rows).toHaveLength(2);
  });

  it('bilinmeyen anahtar için anlaşılır hata verir', async () => {
    const snapshot = await loadConfigSnapshot(sql, 0n);
    expect(() => getConfig(snapshot, 'yok.boyle.bir.anahtar')).toThrow(/bulunamadı/);
  });
});
