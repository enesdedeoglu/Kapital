import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { DomainError } from '@kapital/shared';
import type { ZodSchema } from 'zod';

@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
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
