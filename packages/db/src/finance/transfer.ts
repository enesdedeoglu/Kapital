import { randomUUID } from 'node:crypto';
import { InsufficientFunds, InvariantViolation, type LedgerAccount, type Money } from '@kapital/shared';
import type { Sql } from '../client.js';

export type Currency = 'TRY' | 'USD';
export type TxSql = Sql;

export interface TransferInput {
  /** Her defter satırı bir tura aittir — `NOW()` değil, `tick.seq` (docs/04 §2.8). */
  tickId: bigint;
  /**
   * İşlem kimliği ve **idempotency anahtarı**. Aynı `txId` ikinci kez
   * gönderilirse hiçbir şey olmaz. Tick etkileri için deterministik türetilir
   * (tur+tesis+ürün+tür), oyuncu istekleri için `Idempotency-Key`'den gelir.
   */
  txId?: string;
  fromCompanyId: string;
  toCompanyId: string;
  amount: Money;
  currency?: Currency;
  account: LedgerAccount;
  reason: string;
  refType?: string;
  refId?: string;
  /** `mulMoney` artığı — yuvarlama sapmasını izler (R5). */
  roundingResidue?: bigint;
}

export interface TransferResult {
  txId: string;
  /** false ⇒ bu tx zaten uygulanmıştı; hiçbir bakiye değişmedi. */
  applied: boolean;
}

const BALANCE_COLUMN: Record<Currency, string> = { TRY: 'cash', USD: 'usd_balance' };

/**
 * Paranın TEK geçiş noktası. Başka hiçbir yerde `companies.cash` güncellenmez.
 *
 * Çift harcama savunması üç katmanlıdır (docs/06 §3):
 *   1. `UPDATE ... WHERE cash >= amount` → kontrol ve düşme tek atomik ifadede (TOCTOU yok)
 *   2. `CHECK (cash >= 0)` tablo kısıtı → kaçak kod yolu için son savunma
 *   3. Defter mutabakatı (I1) → sessiz bozulmayı her tur sonunda yakalar
 *
 * Deadlock önleme: iki şirket her zaman UUID sırasına göre TEK sorguda kilitlenir.
 *
 * @param tx AÇIK BİR TRANSACTION olmalıdır — `runInTransaction` ile çağırın.
 */
export async function transfer(tx: TxSql, input: TransferInput): Promise<TransferResult> {
  const {
    tickId, fromCompanyId, toCompanyId, amount, account, reason,
    currency = 'TRY', refType = null, refId = null, roundingResidue = 0n,
  } = input;
  const txId = input.txId ?? randomUUID();

  if (amount <= 0n) throw new RangeError('transfer tutarı pozitif olmalı');
  if (fromCompanyId === toCompanyId) throw new RangeError('kaynak ve hedef şirket aynı olamaz');

  const column = BALANCE_COLUMN[currency];

  // 1) Sabit sırada kilitle — docs/06 §2. Tek sorgu, ORDER BY id: deadlock imkânsız.
  const locked = await tx<{ id: string; kind: string }[]>`
    SELECT id, kind FROM companies
    WHERE id IN (${fromCompanyId}::uuid, ${toCompanyId}::uuid)
    ORDER BY id
    FOR UPDATE`;
  if (locked.length !== 2) {
    throw new InvariantViolation('TRANSFER', 'kaynak veya hedef şirket bulunamadı', {
      fromCompanyId, toCompanyId, found: locked.length,
    });
  }
  const fromIsSystem = locked.find((c) => c.id === fromCompanyId)!.kind === 'SYSTEM';

  // 2) Defter çifti. ON CONFLICT DO NOTHING ⇒ tekrar oynatma sessizce no-op olur.
  const inserted = await tx`
    INSERT INTO ledger_entries
      (tick_id, tx_id, company_id, counterparty_id, direction, currency,
       amount, account, reason, ref_type, ref_id, rounding_residue)
    VALUES
      (${tickId}, ${txId}::uuid, ${fromCompanyId}::uuid, ${toCompanyId}::uuid, 'DEBIT',
       ${currency}, ${amount}, ${account}, ${reason}, ${refType}, ${refId}, ${roundingResidue}),
      (${tickId}, ${txId}::uuid, ${toCompanyId}::uuid, ${fromCompanyId}::uuid, 'CREDIT',
       ${currency}, ${amount}, ${account}, ${reason}, ${refType}, ${refId}, ${-roundingResidue})
    ON CONFLICT DO NOTHING
    RETURNING direction`;

  if (inserted.length === 0) return { txId, applied: false }; // idempotent tekrar
  if (inserted.length !== 2) {
    // Yarım yazılmış defter çifti — asla olmamalı, olursa transaction geri alınır.
    throw new InvariantViolation('I1', 'defter çifti yarım yazıldı', {
      txId, inserted: inserted.length,
    });
  }

  // 3) Borçlandırma: yeterlilik kontrolü ve düşme TEK ifadede.
  //    Sistem şirketleri muaf — musluk tanımı gereği karşılıksız öder.
  const debited = await tx.unsafe(
    `UPDATE companies SET ${column} = ${column} - $1::bigint
      WHERE id = $2::uuid ${fromIsSystem ? '' : `AND ${column} >= $1::bigint`}`,
    [amount.toString(), fromCompanyId],
  );
  if (debited.count === 0) {
    throw new InsufficientFunds({ companyId: fromCompanyId, currency, required: amount.toString() });
  }

  // 4) Alacaklandırma
  await tx.unsafe(
    `UPDATE companies SET ${column} = ${column} + $1::bigint WHERE id = $2::uuid`,
    [amount.toString(), toCompanyId],
  );

  return { txId, applied: true };
}

/** Ekonomik değişikliklerin tamamı transaction içinde olmalı (madde 58.2). */
export async function runInTransaction<T>(sql: Sql, fn: (tx: TxSql) => Promise<T>): Promise<T> {
  return sql.begin((tx) => fn(tx as unknown as TxSql)) as Promise<T>;
}

/** Deadlock'ta sınırlı, jitter'lı yeniden deneme — docs/06 §6. */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== '40P01' && code !== '40001') throw error; // deadlock / serialization dışı
      lastError = error;
      await new Promise((r) => setTimeout(r, 15 * 2 ** i + Math.random() * 20));
    }
  }
  throw lastError;
}
