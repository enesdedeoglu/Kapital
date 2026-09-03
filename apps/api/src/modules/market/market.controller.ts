import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { MarketService } from './market.service.js';
import { buySchema, type BuyDto } from './market.dto.js';

@Controller('market')
export class MarketController {
  constructor(@Inject(MarketService) private readonly market: MarketService) {}

  @Get(':cityCode')
  offers(@Param('cityCode') cityCode: string, @Query('product') product?: string) {
    return this.market.offers(cityCode, product);
  }

  @Post('buy')
  @UseInterceptors(IdempotencyInterceptor)
  buy(@Req() req: Request & { user: AuthUser }, @Body(new ZodPipe(buySchema)) dto: BuyDto) {
    return this.market.buy(req.user.sub, dto);
  }
}
