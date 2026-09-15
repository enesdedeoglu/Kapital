import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/jwt.guard.js';
import { ReportService } from './report.service.js';

@Controller('report')
export class ReportController {
  constructor(@Inject(ReportService) private readonly report: ReportService) {}

  /**
   * "Sen yokken ne oldu" — madde 45.
   *
   * `sinceTick` istemciden gelir: en son gördüğü tur. Yoksa en geniş pencere
   * (7 gün) uygulanır — ilk kurulumda ya da yerel işaret kaybolduğunda.
   */
  @Get()
  rapor(@Req() req: Request & { user: AuthUser }, @Query('sinceTick') sinceTick?: string) {
    let since: bigint | null = null;
    if (sinceTick !== undefined) {
      // Elle yazılabilen bir parametre: bigint'e çevirirken patlamasın.
      if (!/^\d+$/.test(sinceTick)) throw new BadRequestException('sinceTick sayı olmalı');
      since = BigInt(sinceTick);
    }
    return this.report.rapor(req.user.sub, since);
  }
}
