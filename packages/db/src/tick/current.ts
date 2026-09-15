import { TICK_MINUTES } from '@kapital/shared';
import type { Sql } from '../client.js';

/**
 * Zaman kaynağı `NOW()` değil, en son turun sırasıdır (docs/04 §2.8).
 * İş mantığında tarih/saat kullanılmaz; her etki bir tura aittir.
 */
export async function currentTickSeq(sql: Sql): Promise<bigint> {
  const [row] = await sql<{ seq: bigint }[]>`
    SELECT seq FROM economic_ticks ORDER BY seq DESC LIMIT 1`;
  return row?.seq ?? 0n;
}

/**
 * Sıradaki turun koşacağı an — yoksa null.
 *
 * ★ BU SORU "PENDING SATIRI HANGİSİ" DEĞİLDİR.
 *
 * Önce öyle sanmıştım ve yalnız PENDING satırına bakıyordum. Oysa normal
 * işleyişte PENDING SATIRI HİÇ OLUŞMUYOR: `orchestrator` bekleyen satır
 * bulamazsa turu kendisi açıp anında RUNNING → COMPLETED yapıyor, zamanlayıcı
 * da (`worker/scheduler.ts`) "ne zaman" sorusunu satır durumundan değil GEÇEN
 * SÜREDEN cevaplıyor: `planCatchUp` son TAMAMLANAN turun üstünden 15 dakika
 * geçtiyse yeni tur koşuyor.
 *
 * Yani gerçek kurulumda `sonraki` hep null dönerdi ve geri sayım sonsuza dek
 * "bekleniyor" derdi. Yerelde saat görünmesinin tek sebebi seed'in bıraktığı
 * PENDING satırıydı — hatayı gizleyen bir tesadüf.
 *
 * Doğru cevap iki kaynaklı: açıkça planlanmış bir tur varsa o bağlayıcıdır,
 * yoksa zamanlayıcının kendi ölçütü uygulanır.
 */
export async function nextTickAt(sql: Sql): Promise<Date | null> {
  const [planli] = await sql<{ scheduled_at: Date }[]>`
    SELECT scheduled_at FROM economic_ticks
     WHERE status = 'PENDING' ORDER BY scheduled_at LIMIT 1`;
  if (planli) return new Date(planli.scheduled_at);

  const [son] = await sql<{ completed_at: Date | null }[]>`
    SELECT completed_at FROM economic_ticks
     WHERE status = 'COMPLETED' ORDER BY seq DESC LIMIT 1`;
  if (!son?.completed_at) return null;
  return new Date(new Date(son.completed_at).getTime() + TICK_MINUTES * 60_000);
}

/**
 * Son TAMAMLANAN turun sırası — "oyuncunun gördüğü dünya hangi tura ait".
 *
 * ★ `currentTickSeq` BU İŞE YARAMAZ: o, duruma bakmadan en büyük seq'i döner.
 * İki ayrı şekilde yanıltır:
 *   · Bekleyen (PENDING) bir satır varsa seq zaten ilerlemiştir; tur koşunca
 *     aynı satır COMPLETED olur ve seq HİÇ DEĞİŞMEZ. "Tur düştü" haberi
 *     değişime bakıyorsa hiç gitmez.
 *   · Tur KOŞARKEN seq bir artar. Değişimi haber sayan istemci, tur daha
 *     bitmeden veriyi çeker ve yarı uygulanmış bir dünya görür.
 * Tamamlanan sıra ikisinde de doğrudur: yalnız tur bittiğinde ilerler.
 */
export async function lastCompletedTickSeq(sql: Sql): Promise<bigint> {
  const [row] = await sql<{ seq: bigint }[]>`
    SELECT seq FROM economic_ticks WHERE status = 'COMPLETED'
     ORDER BY seq DESC LIMIT 1`;
  return row?.seq ?? 0n;
}
