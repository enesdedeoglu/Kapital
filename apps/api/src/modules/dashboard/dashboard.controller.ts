import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/jwt.guard.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  /** Ana sayfanın tamamı tek yanıtta: tur, K/Z, kritik stok, olaylar. */
  @Get()
  ozet(@Req() req: Request & { user: AuthUser }) {
    return this.dashboard.ozet(req.user.sub);
  }
}
