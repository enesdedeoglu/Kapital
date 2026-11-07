import { type Sql } from '@kapital/db';
import { runTick } from '@kapital/engine';
import { TICK_MINUTES } from '@kapital/shared';

export interface SchedulerOptions {
  /** Kaç tur geride kalınca hızlandırılmış mod (docs/05 §5). */
  readonly catchUpThreshold?: number;
  /** Bu sayının üstünde operatör onayı gerekir; worker kendi başına koşmaz. */
  readonly catchUpLimit?: number;
  /**
   * Limit aşıldığında ne olacağı.
   *
   * ★★★ 'operator' ÜRETİM İÇİNDİR, dizüstü bilgisayar için değil. Oyun sunucusu
   * geliştirme makinesinde duruyor ve makine her gece kapanıyor; sabah worker
   * "4224 tur geride kalındı, operatör onayı gerekiyor" yazıp duruyordu.
   * Günlüğü kimse okumuyor, oyuncunun dünyası sessizce donuyor: emirler
   * eşleşmiyor, üretim işlemiyor, raf satmıyor. Oyuncu bunu "uygulama bozuk"
   * olarak görür ve haklıdır.
   *
   * 'skip' boşluğu YOK SAYAR: tek tur koşar, saat o andan itibaren yeniden
   * akar. Kapalı geçen süre oynanmamış sayılır — mobil bir oyunda doğru
   * davranış budur; 44 günü hızlandırılmış koşmak oyuncunun stoğunu
   * çürütür, kredisini temerrüde düşürür ve emirlerini süresi dolmuş yapar.
   */
  readonly gapPolicy?: 'operator' | 'skip';
  readonly onLog?: (message: string, data?: unknown) => void;
}

export interface CatchUpPlan {
  due: number;
  mode: 'idle' | 'normal' | 'catch-up' | 'operator-required' | 'skip-gap';
  /** 'skip-gap' modunda yok sayılan tur sayısı — yalnız günlük için. */
  gap?: number;
}

/**
 * Kaç turun geride kaldığını hesaplar — docs/05 §5.
 *
 * Worker 2 saat düşerse 8 tur birikir. Bu politika tanımsız bırakılırsa
 * üretimde "8 tur birden koştu, ekonomi patladı" olayı yaşanır.
 */
export function planCatchUp(
  lastCompletedAt: Date | null,
  now: Date,
  opts: SchedulerOptions = {},
): CatchUpPlan {
  const threshold = opts.catchUpThreshold ?? 4;
  const limit = opts.catchUpLimit ?? 24;
  if (!lastCompletedAt) return { due: 1, mode: 'normal' };

  const elapsedMinutes = (now.getTime() - lastCompletedAt.getTime()) / 60_000;
  const due = Math.floor(elapsedMinutes / TICK_MINUTES);

  if (due <= 0) return { due: 0, mode: 'idle' };
  if (due <= threshold) return { due, mode: 'normal' };
  if (due <= limit) return { due, mode: 'catch-up' };
  if (opts.gapPolicy === 'skip') return { due: 1, mode: 'skip-gap', gap: due };
  return { due, mode: 'operator-required' };
}

/**
 * Ekonomik tur zamanlayıcısı.
 *
 * Tek orchestrator garantisi PostgreSQL danışma kilidinden gelir (ADR-0008),
 * dolayısıyla worker birden çok kopya halinde çalışabilir: kilidi kim alırsa
 * turu o koşar, diğerleri sessizce atlar.
 */
export class TickScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private running = false;

  constructor(
    private readonly sql: Sql,
    private readonly opts: SchedulerOptions = {},
  ) {}

  private log(message: string, data?: unknown) {
    (this.opts.onLog ?? ((m, d) => console.log(m, d ?? '')))(message, data);
  }

  async start(): Promise<void> {
    this.log(`Tur zamanlayıcısı başladı — her ${TICK_MINUTES} dakikada bir`);
    await this.cycle();
    this.timer = setInterval(() => { void this.cycle(); }, 30_000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    // Koşan turun bitmesini bekle — yarım tur bırakılmaz
    while (this.running) await new Promise((r) => setTimeout(r, 100));
    this.log('Tur zamanlayıcısı durdu');
  }

  /** Bir zamanlama döngüsü: gecikmeyi ölç, gerekiyorsa tur(lar) koş. */
  async cycle(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      const [last] = await this.sql<{ completed_at: Date | null }[]>`
        SELECT completed_at FROM economic_ticks
        WHERE status = 'COMPLETED' ORDER BY seq DESC LIMIT 1`;
      const plan = planCatchUp(last?.completed_at ?? null, new Date(), this.opts);

      if (plan.mode === 'idle') return;
      if (plan.mode === 'operator-required') {
        this.log(
          `${plan.due} tur geride kalındı — OPERATÖR ONAYI GEREKİYOR. ` +
          `Bu kadar birikmiş turu otomatik koşmak ekonomiyi bozabilir (docs/05 §5).`,
        );
        return;
      }
      if (plan.mode === 'skip-gap') {
        this.log(
          `${plan.gap} tur kapalı geçmiş — boşluk yok sayıldı, saat şimdiden ` +
          `akmaya devam ediyor (docs/05 §5, gapPolicy: skip).`,
        );
      }
      if (plan.mode === 'catch-up') {
        this.log(`${plan.due} tur geride — hızlandırılmış mod (bildirimler atlanır)`);
      }

      for (let i = 0; i < plan.due && !this.stopping; i++) {
        const result = await runTick(this.sql, { isCatchUp: plan.mode === 'catch-up' });
        if (result.skipped) {
          this.log('Tur başka bir worker tarafından koşuluyor, atlandı');
          return;
        }
        const slow = Object.entries(result.phases).filter(([, p]) => p.overBudget);
        this.log(
          `Tur ${result.seq} tamamlandı (${result.durationMs} ms)` +
          (slow.length > 0 ? ` — BÜTÇE AŞIMI: ${slow.map(([c]) => c).join(', ')}` : ''),
        );
      }
    } catch (error) {
      this.log('Tur koşarken hata', error instanceof Error ? error.message : error);
    } finally {
      this.running = false;
    }
  }
}
