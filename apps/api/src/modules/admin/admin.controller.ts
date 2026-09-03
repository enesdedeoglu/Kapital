import { CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { runTick, type TickResult } from '@kapital/engine';
import { checkInvariants, type Sql } from '@kapital/db';
import { DomainError } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { AuthUser } from '../auth/jwt.guard.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(SQL) private readonly sql: Sql) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) throw new DomainError('FORBIDDEN', 'Oturum gerekli');
    const [row] = await this.sql<{ is_admin: boolean }[]>`
      SELECT is_admin FROM users WHERE id = ${req.user.sub}::uuid`;
    if (!row?.is_admin) throw new DomainError('FORBIDDEN', 'Yönetici yetkisi gerekli');
    return true;
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /**
   * Ekonomik turu elle çalıştırır.
   *
   * Üretimde turlar `apps/worker` tarafından 15 dakikada bir koşar; bu uç
   * geliştirme, test ve olağandışı durumlarda operatör müdahalesi içindir.
   */
  @Post('tick')
  async tick(): Promise<TickResult> {
    return runTick(this.sql);
  }

  @Get('invariants')
  invariants() {
    return checkInvariants(this.sql);
  }

  @Get('economy')
  async economy() {
    const rows = await this.sql<Record<string, never>[]>`
      SELECT tick_id, total_money_supply, player_money, npc_money, faucet_in, sink_out,
             median_company_value, active_companies
      FROM economy_snapshots ORDER BY tick_id DESC LIMIT 50`;
    return rows.map((r) => {
      const s = r as unknown as Record<string, never>;
      return {
        tickSeq: (s.tick_id as unknown as bigint).toString(),
        totalMoneySupply: s.total_money_supply,
        playerMoney: s.player_money,
        npcMoney: s.npc_money,
        faucetIn: s.faucet_in,
        sinkOut: s.sink_out,
        medianCompanyValue: (s.median_company_value as unknown as bigint).toString(),
        activeCompanies: s.active_companies,
      };
    });
  }
}
