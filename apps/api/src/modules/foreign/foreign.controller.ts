import {
  Body, Controller, Get, Inject, Post, Query, Req, UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import {
  foreignTradeSchema, fxConvertSchema, fxPreviewSchema,
  type ForeignTradeDto, type FxConvertDto, type FxPreviewDto,
} from './foreign.dto.js';
import { ForeignService } from './foreign.service.js';

@Controller('foreign')
export class ForeignController {
  constructor(@Inject(ForeignService) private readonly foreign: ForeignService) {}

  /**
   * Ekranın tek çağrısı: oyuncunun bağlamı (seviye, limanlar, $ bakiyesi) ile
   * dünya verisi birlikte. `capacity` dünyayı anlatır ama kim olduğunu
   * bilmez; "ticaret yapabilir miyim" sorusu oyuncuya ait üç şarta bağlı.
   */
  @Get()
  overview(@Req() req: Request & { user: AuthUser }) {
    return this.foreign.overview(req.user.sub);
  }

  /** Bu turda kalan derinlik ve dünya fiyatları — oyuncu fiyatı belirleyemez. */
  @Get('capacity')
  capacity() {
    return this.foreign.capacity();
  }

  /** "Bozdurursam ne alırım" — spread dahil, işlemden önce. */
  @Get('fx/preview')
  fxPreview(
    @Req() req: Request & { user: AuthUser },
    @Query(new ZodPipe(fxPreviewSchema)) dto: FxPreviewDto,
  ) {
    return this.foreign.fxPreview(req.user.sub, dto.side, dto.usdAmount);
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
