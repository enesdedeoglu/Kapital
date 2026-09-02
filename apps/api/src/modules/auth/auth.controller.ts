import { Body, Controller, Get, HttpCode, Inject, Post, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { Public, type AuthUser } from './jwt.guard.js';
import {
  loginSchema, refreshSchema, registerSchema,
  type LoginDto, type RefreshDto, type RegisterDto,
} from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @UsePipes(new ZodPipe(registerSchema))
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodPipe(loginSchema))
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @UsePipes(new ZodPipe(refreshSchema))
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request & { user: AuthUser }) {
    await this.auth.logout(req.user.sub);
  }

  @Get('me')
  me(@Req() req: Request & { user: AuthUser }) {
    return { userId: req.user.sub };
  }
}
