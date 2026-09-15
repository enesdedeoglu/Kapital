import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TICK_MINUTES } from '@kapital/shared';
import type { Sql } from '../client.js';
import { prepareTestDb, truncateGameState } from '../testing/harness.js';
import { currentTickSeq, nextTickAt } from './current.js';

let sql: Sql;
/*
 * ★ `economic_ticks` PAYLAŞILAN bir temeldir; `truncateGameState` ona BİLEREK
 * dokunmaz ve `api.e2e.test.ts` yalnız `seq > 0` siler — tohumun 0. turu
 * dosyalar arası ayakta kalır. Bu testler ise boş tabloyu da denemek zorunda.
 *
 * Çözüm: tabloyu bu dosyanın başında yedekle, sonunda geri koy. Önce topyekûn
 * siliyordum; kalıntı sonraki DOSYALARA taşınıyordu — kendi dosyan geçse de
 * başkasını düşüren türden bir hata.
 */
let yedek: Record<string, unknown>[] = [];

beforeAll(async () => {
  sql = await prepareTestDb();
  yedek = await sql<Record<string, unknown>[]>`SELECT * FROM economic_ticks ORDER BY seq`;
});

afterAll(async () => {
  if (sql) {
    await sql.unsafe('DELETE FROM tick_phase_runs; DELETE FROM economic_ticks;');
    if (yedek.length > 0) await sql`INSERT INTO economic_ticks ${sql(yedek)}`;
    await sql.end({ timeout: 5 });
  }
});

beforeEach(async () => {
  await truncateGameState(sql);
  await sql.unsafe('DELETE FROM tick_phase_runs; DELETE FROM economic_ticks;');
});

/** Belirtilen durumda bir tur satırı yazar. */
async function tur(opts: {
  seq: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED';
  scheduledAt?: Date;
  completedAt?: Date | null;
}) {
  await sql`
    INSERT INTO economic_ticks (seq, scheduled_at, status, completed_at, rng_seed, season)
    VALUES (${opts.seq}, ${opts.scheduledAt ?? new Date()}, ${opts.status},
            ${opts.completedAt ?? null}, 1, 0)`;
}

describe('nextTickAt — "sıradaki tur ne zaman"', () => {
  it('hiç tur yoksa null döner — uydurma bir saat üretmez', async () => {
    expect(await nextTickAt(sql)).toBeNull();
  });

  it('planlanmış PENDING tur varsa onun saati bağlayıcıdır', async () => {
    const hedef = new Date('2026-03-01T12:00:00.000Z');
    await tur({ seq: 1, status: 'COMPLETED', completedAt: new Date('2026-03-01T10:00:00.000Z') });
    await tur({ seq: 2, status: 'PENDING', scheduledAt: hedef });

    expect((await nextTickAt(sql))?.toISOString()).toBe(hedef.toISOString());
  });

  /*
   * ★ ASIL DURUM BU. Normal işleyişte PENDING satırı HİÇ oluşmaz:
   * `orchestrator` bekleyen satır bulamazsa turu kendisi açıp anında koşar ve
   * COMPLETED bırakır. Zamanlayıcı da "ne zaman" sorusunu geçen süreden
   * cevaplar. Yalnız PENDING'e bakan bir kural burada null döner ve geri sayım
   * sonsuza dek "bekleniyor" der.
   */
  it('PENDING yoksa son TAMAMLANAN turun üstüne tur süresi eklenir', async () => {
    const bitis = new Date('2026-03-01T10:00:00.000Z');
    await tur({ seq: 1, status: 'COMPLETED', completedAt: new Date('2026-03-01T09:45:00.000Z') });
    await tur({ seq: 2, status: 'COMPLETED', completedAt: bitis });

    const sonraki = await nextTickAt(sql);
    expect(sonraki?.getTime()).toBe(bitis.getTime() + TICK_MINUTES * 60_000);
  });

  it('yalnız KOŞAN tur varsa ve tamamlanan yoksa null döner', async () => {
    await tur({ seq: 1, status: 'RUNNING' });
    expect(await nextTickAt(sql)).toBeNull();
  });

  /*
   * `currentTickSeq` DURUMA BAKMAZ: en büyük seq'i döner, PENDING de olsa.
   * "Sıradaki tur"u `seq > currentTickSeq` ile aramak bu yüzden hiçbir zaman
   * sonuç vermez — bir kez bu hataya düşüldü, test onu sabitliyor.
   */
  it('currentTickSeq bekleyen turu da sayar — seq aritmetiğiyle aranmaz', async () => {
    await tur({ seq: 5, status: 'COMPLETED', completedAt: new Date() });
    await tur({ seq: 6, status: 'PENDING' });

    expect(await currentTickSeq(sql)).toBe(6n);
  });
});
