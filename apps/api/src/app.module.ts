import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './common/db.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtGuard } from './modules/auth/jwt.guard.js';
import { CompanyModule } from './modules/company/company.module.js';
import { HealthModule } from './modules/health/health.module.js';

/**
 * DI KURALI: tüm constructor bağımlılıkları AÇIK `@Inject(Token)` ile verilir.
 * Gerekçe: esbuild (tsx / vitest) `emitDecoratorMetadata` üretmez, dolayısıyla
 * NestJS'in tip tabanlı enjeksiyonu bu araçlar altında sessizce `undefined` verir.
 * Açık token kullanmak uygulamayı paketleyiciden bağımsız kılar.
 */
@Module({
  imports: [DbModule, AuthModule, CompanyModule, HealthModule],
  // Varsayılan KAPALI: uçlar açıkça @Public() denmedikçe oturum ister.
  providers: [{ provide: APP_GUARD, useClass: JwtGuard }],
})
export class AppModule {}
