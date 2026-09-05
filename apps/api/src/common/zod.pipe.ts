import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { DomainError } from '@kapital/shared';

@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  // ADR-0007 istisnası: bu pipe DI konteynerinden ÇÖZÜLMEZ, her kullanım
  // yerinde `new ZodPipe(schema)` ile elle kurulur. Şema bir bağımlılık
  // değil, sıradan bir kurucu argümanıdır — `design:paramtypes` devrede değil.
  // eslint-disable-next-line no-restricted-syntax
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown, _meta: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError('VALIDATION', 'Girdi geçersiz', {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
