import { Body, Controller, Get, Inject, Post, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { CompanyService } from './company.service.js';
import { createCompanySchema, type CreateCompanyDto } from './company.dto.js';

@Controller('company')
export class CompanyController {
  constructor(@Inject(CompanyService) private readonly companies: CompanyService) {}

  @Get()
  get(@Req() req: Request & { user: AuthUser }) {
    return this.companies.getByUser(req.user.sub);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(createCompanySchema)) dto: CreateCompanyDto,
  ) {
    return this.companies.create(req.user.sub, dto);
  }
}
