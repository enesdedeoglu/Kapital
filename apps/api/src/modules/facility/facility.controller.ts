import {
  Body, Controller, Get, Inject, Param, Post, Query, Req, UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { FacilityService } from './facility.service.js';
import { buildFacilitySchema, type BuildFacilityDto } from './facility.dto.js';

@Controller('facilities')
export class FacilityController {
  constructor(@Inject(FacilityService) private readonly facilities: FacilityService) {}

  @Get()
  list(@Req() req: Request & { user: AuthUser }) {
    return this.facilities.list(req.user.sub);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  build(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(buildFacilitySchema)) dto: BuildFacilityDto,
  ) {
    return this.facilities.build(req.user.sub, dto);
  }

  @Get(':id')
  get(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.facilities.getByUser(req.user.sub, id);
  }

  /** Toplam / ortalama kalite / ağırlıklı maliyet — türetilir, saklanmaz. */
  @Get(':id/stock')
  stock(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.facilities.stock(req.user.sub, id);
  }

  /** Lot detayı: aynı ürünün farklı kalite ve maliyetteki partileri ayrı ayrı. */
  @Get(':id/batches')
  batches(
    @Req() req: Request & { user: AuthUser },
    @Param('id') id: string,
    @Query('productId') productId?: string,
  ) {
    return this.facilities.batches(req.user.sub, id, productId ? Number(productId) : undefined);
  }
}
