/** Alan hataları. HTTP katmanı bunları status koduna çevirir; domain HTTP bilmez. */

export type ErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_STOCK'
  | 'STORAGE_FULL'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'LEVEL_LOCKED'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'INVARIANT_VIOLATION';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InsufficientFunds extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super('INSUFFICIENT_FUNDS', 'Yetersiz bakiye', details);
  }
}

export class NotFound extends DomainError {
  constructor(what: string, id?: string) {
    super('NOT_FOUND', `${what} bulunamadı`, id ? { id } : undefined);
  }
}

export class Conflict extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, details);
  }
}

/** Değişmez ihlali (I1–I8). Asla kullanıcı hatası değildir — alarm üretir. */
export class InvariantViolation extends DomainError {
  constructor(
    readonly invariant: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super('INVARIANT_VIOLATION', `[${invariant}] ${message}`, details);
  }
}
