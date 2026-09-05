import { createHash } from 'node:crypto';
import {
  CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, catchError, concatMap, from, of, throwError } from 'rxjs';
import type { Sql } from '@kapital/db';
import { Conflict, DomainError } from '@kapital/shared';
import { SQL } from './db.module.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Gate = { replay: true; body: unknown } | { replay: false };

/**
 * Mobilde çift dokunma ve ağ retry gerçek bir risktir: bunsuz oyuncu tesisi
 * iki kez satın alır (docs/06 §6).
 *
 * Anahtar, işleyici ÇALIŞMADAN ÖNCE rezerve edilir. Yanıtı gönderdikten sonra
 * yazmak yeterli değildir: iki istek arka arkaya gelirse ikincisi kaydı henüz
 * göremez ve işlem iki kez uygulanır.
 *
 *   ilk istek        → satırı rezerve et → çalıştır → yanıtı satıra yaz
 *   aynı gövde       → kayıtlı yanıtı döndür, çalıştırma
 *   farklı gövde     → 409 IDEMPOTENCY_MISMATCH
 *   hâlâ işleniyor   → 409 CONFLICT (istemci sonra tekrar dener)
 *   işleyici hata    → rezervasyon bırakılır, istemci tekrar deneyebilir
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: { sub: string } }>();
    const key = req.header('idempotency-key');
    const userId = req.user?.sub;

    if (!MUTATING.has(req.method) || !key || !userId) return next.handle();

    const endpoint = `${req.method} ${req.route?.path ?? req.path}`;
    const hash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');

    return from(this.reserve(key, userId, endpoint, hash)).pipe(
      concatMap((gate) => {
        if (gate.replay) return of(gate.body);
        return next.handle().pipe(
          // Yanıt İSTEMCİYE GİTMEDEN önce kaydedilir; yarış kapanır.
          concatMap((body) => from(this.complete(key, body)).pipe(concatMap(() => of(body)))),
          catchError((error) =>
            from(this.release(key)).pipe(concatMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  private async reserve(key: string, userId: string, endpoint: string, hash: string): Promise<Gate> {
    const reserved = await this.sql`
      INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash)
      VALUES (${key}, ${userId}::uuid, ${endpoint}, ${hash})
      ON CONFLICT (key) DO NOTHING
      RETURNING key`;
    if (reserved.length > 0) return { replay: false };

    const [row] = await this.sql<
      { user_id: string; request_hash: string; response_body: unknown; status_code: number | null }[]
    >`SELECT user_id, request_hash, response_body, status_code
      FROM idempotency_keys WHERE key = ${key}`;
    if (!row) return { replay: false }; // arada silinmiş; yeniden çalıştır

    if (row.user_id !== userId || row.request_hash !== hash) {
      throw new DomainError(
        'IDEMPOTENCY_MISMATCH',
        'Bu Idempotency-Key farklı bir istekle kullanılmış',
        { key, endpoint },
      );
    }
    if (row.status_code === null) {
      throw new Conflict('Aynı istek hâlâ işleniyor, birazdan tekrar deneyin', { key });
    }
    return { replay: true, body: row.response_body ?? {} };
  }

  private async complete(key: string, body: unknown): Promise<void> {
    // ::text::jsonb — parametreyi açıkça metin olarak gönderip Postgres'e
    // ayrıştırtır. `sql.json()` parametre tipi çıkarımına bağlıdır ve bazı
    // sorgu şekillerinde serileştirici bulunamaz; düz `::jsonb` ise çift
    // kodlamaya yol açar (nesne yerine JSON string saklanır).
    await this.sql`
      UPDATE idempotency_keys
      SET response_body = ${JSON.stringify(body ?? null)}::text::jsonb, status_code = 200
      WHERE key = ${key}`;
  }

  /** İşleyici hata verdiyse rezervasyonu bırak — istemci tekrar deneyebilsin. */
  private async release(key: string): Promise<void> {
    await this.sql`DELETE FROM idempotency_keys WHERE key = ${key} AND status_code IS NULL`;
  }
}
