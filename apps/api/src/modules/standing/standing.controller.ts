import { Body, Controller, Delete, Get, Inject, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { setStandingOrderSchema, type SetStandingOrderDto } from './standing.dto.js';
import { StandingService } from './standing.service.js';

/**
 * Kalıcı emirler — "ben yokken şirketim şunu yapsın".
 *
 * docs/00'ın 3. ilkesi "oyuncu offline'ken ekonomi devam eder" der; bu uç,
 * oyuncunun o ekonomiye offline'ken KATILMASINI sağlar.
 */
@Controller('standing-orders')
export class StandingController {
  constructor(@Inject(StandingService) private readonly standing: StandingService) {}

  @Get()
  list(@Req() req: Request & { user: AuthUser }) {
    return this.standing.list(req.user.sub);
  }

  @Put()
  set(
    @Req() req: Request & { user: AuthUser },
    // Pipe PARAMETRE seviyesinde (ADR-0007 notu): @UsePipes metot seviyesinde
    // tüm parametrelere uygulanır.
    @Body(new ZodPipe(setStandingOrderSchema)) dto: SetStandingOrderDto,
  ) {
    return this.standing.set(req.user.sub, dto);
  }

  @Delete(':id')
  remove(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.standing.remove(req.user.sub, id);
  }
}
