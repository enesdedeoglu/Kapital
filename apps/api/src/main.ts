import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from '@kapital/db';
import { AppModule } from './app.module.js';
import { DomainErrorFilter } from './common/domain-error.filter.js';

loadRootEnv();

export async function bootstrap(port = Number(process.env.PORT ?? 3000)) {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableShutdownHooks();
  await app.listen(port);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().then((app) => {
    Logger.log(`Kapital API hazır: ${app.getHttpServer().address().port}`, 'Bootstrap');
  }).catch((e) => { Logger.error(e); process.exit(1); });
}
