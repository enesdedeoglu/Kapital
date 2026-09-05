import { Body, Controller, Get, Inject, Post, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import {
  foreignTradeSchema, fxConvertSchema, type ForeignTradeDto, type FxConvertDto,
} from './foreign.dto.js';
import { ForeignService } from './foreign.service.js';

@Controller('foreign')
export class ForeignController {
  constructor(@Inject(ForeignService) private readonly foreign: ForeignService) {}

  /** Bu turda kalan derinlik ve dünya fiyatları — oyuncu fiyatı belirleyemez. */
  @Get('capacity')
  capacity() {
    return this.foreign.capacity();
  }

  @Post('import')
  @UseInterceptors(IdempotencyInterceptor)
  import(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(foreignTradeSchema)) dto: ForeignTradeDto,
  ) {
    return this.foreign.import(req.user.sub, dto);
  }

  @Post('export')
  @UseInterceptors(IdempotencyInterceptor)
  export(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(foreignTradeSchema)) dto: ForeignTradeDto,
  ) {
    return this.foreign.export(req.user.sub, dto);
  }

  /** ₺ ↔ $ dönüşümü. Spread SYS_SINK'e gider — round-trip bedava değildir. */
  @Post('fx/convert')
  @UseInterceptors(IdempotencyInterceptor)
  convert(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(fxConvertSchema)) dto: FxConvertDto,
  ) {
    return this.foreign.convert(req.user.sub, dto);
  }
}
