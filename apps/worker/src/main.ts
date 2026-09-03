import { createSql, currentTickSeq, loadRootEnv } from '@kapital/db';
import { TickScheduler } from './scheduler.js';

loadRootEnv();

async function bootstrap() {
  const sql = createSql({ max: 20, statementTimeoutMs: 60_000 });
  const seq = await currentTickSeq(sql);
  console.log(`Kapital worker — son tur: ${seq}`);

  const scheduler = new TickScheduler(sql);
  await scheduler.start();

  const shutdown = async (signal: string) => {
    console.log(`${signal} alındı, kapanıyor…`);
    await scheduler.stop();
    await sql.end({ timeout: 10 });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => { console.error(error); process.exit(1); });
