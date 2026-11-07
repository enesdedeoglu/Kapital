import { createSql, currentTickSeq, loadRootEnv } from '@kapital/db';
import { TickScheduler } from './scheduler.js';

loadRootEnv();

async function bootstrap() {
  const sql = createSql({ max: 20, statementTimeoutMs: 60_000 });
  const seq = await currentTickSeq(sql);
  console.log(`Kapital worker — son tur: ${seq}`);

  /*
   * ★ BOŞLUK POLİTİKASI ORTAMDAN GELİR. Üretimde dünya sürekli akar ve uzun
   * bir kesinti gerçekten operatör kararıdır. Ama oyun sunucusu şimdilik bir
   * dizüstü bilgisayarda duruyor; makine kapandığı her gece binlerce tur
   * birikiyor ve worker onay bekleyip duruyordu — oyuncunun dünyası donuyordu.
   * `KAPITAL_TUR_BOSLUGU=atla` boşluğu yok saydırır (bkz. infra/oyna.sh).
   */
  const gapPolicy = process.env.KAPITAL_TUR_BOSLUGU === 'atla' ? 'skip' : 'operator';
  console.log(`Kapalı geçen süre politikası: ${gapPolicy === 'skip' ? 'atla' : 'operatör onayı'}`);

  const scheduler = new TickScheduler(sql, { gapPolicy });
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
