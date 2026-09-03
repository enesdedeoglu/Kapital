import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Sql } from '@kapital/db';
import { Conflict, DomainError, NotFound } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult extends AuthTokens {
  user: { id: string; email: string; displayName: string };
  hasCompany: boolean;
}

const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900);
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL ?? 2_592_000);

@Injectable()
export class AuthService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const [existing] = await this.sql`SELECT 1 FROM users WHERE email = ${dto.email}`;
    if (existing) throw new Conflict('Bu e-posta zaten kayıtlı', { email: dto.email });

    const passwordHash = await hashPassword(dto.password);
    const [user] = await this.sql<{ id: string; email: string; display_name: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${dto.email}, ${passwordHash}, ${dto.displayName})
      RETURNING id, email, display_name`;

    return this.issue(user!, false);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const [user] = await this.sql<
      { id: string; email: string; display_name: string; password_hash: string }[]
    >`SELECT id, email, display_name, password_hash FROM users WHERE email = ${dto.email}`;

    // Kullanıcı yoksa da parola doğrulama maliyetini öde — zamanlama sızıntısını kapatır.
    const stored = user?.password_hash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const ok = await verifyPassword(dto.password, stored);
    if (!user || !ok) throw new DomainError('FORBIDDEN', 'E-posta veya parola hatalı');

    await this.sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}::uuid`;
    const [company] = await this.sql`SELECT 1 FROM companies WHERE user_id = ${user.id}::uuid`;
    return this.issue(user, Boolean(company));
  }

  async refresh(token: string): Promise<AuthTokens> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [row] = await this.sql<{ id: string; user_id: string }[]>`
      SELECT id, user_id FROM refresh_tokens
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL AND expires_at > NOW()`;
    if (!row) throw new NotFound('Geçerli oturum');

    // Rotasyon: kullanılan refresh token iptal edilir, yenisi verilir.
    await this.sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ${row.id}::uuid`;
    return this.issueTokens(row.user_id);
  }

  async logout(userId: string): Promise<void> {
    await this.sql`UPDATE refresh_tokens SET revoked_at = NOW()
                   WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;
  }

  private async issue(
    user: { id: string; email: string; display_name: string },
    hasCompany: boolean,
  ): Promise<AuthResult> {
    const tokens = await this.issueTokens(user.id);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, displayName: user.display_name },
      hasCompany,
    };
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId }, { expiresIn: ACCESS_TTL });
    const refreshToken = randomBytes(48).toString('base64url');
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.sql`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}::uuid, ${tokenHash}, NOW() + ${REFRESH_TTL + ' seconds'}::interval)`;
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL };
  }
}
