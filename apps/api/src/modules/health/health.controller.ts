import { Controller, Get, Inject } from '@nestjs/common';
import { checkInvariants, type Sql } from '@kapital/db';
import { SQL } from '../../common/db.module.js';
import { Public } from '../auth/jwt.guard.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Public()
  @Get()
  async health() {
    const [row] = await this.sql<{ now: string | Date }[]>`SELECT NOW() AS now`;
    return { status: 'ok', db: Boolean(row), time: new Date(row!.now).toISOString() };
  }

  /** Değişmez denetimi (I1, I2, R5) — izleme sistemi bunu çeker. */
  @Public()
  @Get('invariants')
  async invariants() {
    const report = await checkInvariants(this.sql);
    return { ok: report.ok, checked: report.checked, violations: report.violations };
  }
}
