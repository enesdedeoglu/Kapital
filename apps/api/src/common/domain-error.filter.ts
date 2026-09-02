import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, InvariantViolation } from '@kapital/shared';

const STATUS: Record<string, number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  LEVEL_LOCKED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_MISMATCH: 409,
  INSUFFICIENT_FUNDS: 422,
  INSUFFICIENT_STOCK: 422,
  STORAGE_FULL: 422,
  RATE_LIMITED: 429,
  INVARIANT_VIOLATION: 500,
};

/** Alan hataları HTTP'yi bilmez; çeviri tek noktada yapılır. */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (error instanceof InvariantViolation) {
      // Kullanıcı hatası değil — ekonomi tutarsız demektir, alarm konusudur.
      this.logger.error(`DEĞİŞMEZ İHLALİ ${error.invariant}: ${error.message}`, error.details);
      return res.status(500).json({ code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu' });
    }
    if (error instanceof DomainError) {
      return res.status(STATUS[error.code] ?? 400)
        .json({ code: error.code, message: error.message, details: error.details });
    }
    if (error instanceof HttpException) {
      const body = error.getResponse();
      return res.status(error.getStatus())
        .json(typeof body === 'string' ? { code: 'ERROR', message: body } : body);
    }
    this.logger.error(error instanceof Error ? error.stack : String(error));
    return res.status(500).json({ code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu' });
  }
}
