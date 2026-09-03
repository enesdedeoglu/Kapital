import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { RetailService } from './retail.service.js';
import { setPricesSchema, type SetPricesDto } from './retail.dto.js';

@Controller('retail')
export class RetailController {
  constructor(@Inject(RetailService) private readonly retail: RetailService) {}

  @Get(':facilityId')
  list(@Req() req: Request & { user: AuthUser }, @Param('facilityId') facilityId: string) {
    return this.retail.list(req.user.sub, facilityId);
  }

  @Put(':facilityId/prices')
  setPrices(
    @Req() req: Request & { user: AuthUser },
    @Param('facilityId') facilityId: string,
    // Pipe PARAMETRE seviyesinde: @UsePipes metot seviyesinde tüm parametrelere
    // uygulanır ve @Param string'i de gövde şemasıyla doğrulanmaya çalışılır.
    @Body(new ZodPipe(setPricesSchema)) dto: SetPricesDto,
  ) {
    return this.retail.setPrices(req.user.sub, facilityId, dto);
  }
}
