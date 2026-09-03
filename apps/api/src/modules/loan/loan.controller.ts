import { Body, Controller, Get, Inject, Param, Post, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { LoanService } from './loan.service.js';
import { takeLoanSchema, type TakeLoanDto } from './loan.dto.js';

@Controller('loans')
export class LoanController {
  constructor(@Inject(LoanService) private readonly loans: LoanService) {}

  /** Limit, faiz, açık krediler ve ödeme yükü uyarısı. */
  @Get()
  overview(@Req() req: Request & { user: AuthUser }) {
    return this.loans.overview(req.user.sub);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  take(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(takeLoanSchema)) dto: TakeLoanDto,
  ) {
    return this.loans.take(req.user.sub, dto);
  }

  @Post(':id/repay')
  @UseInterceptors(IdempotencyInterceptor)
  repay(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.loans.repay(req.user.sub, id);
  }
}
