import { InvariantViolation } from '@kapital/shared';
import type { Sql } from '../client.js';

export interface InvariantReport {
  ok: boolean;
  checked: string[];
  violations: { invariant: string; detail: string; rows: unknown[] }[];
}

/**
 * Değişmez denetimi — docs/02 §5. Her tur sonunda koşar; ihlal alarm üretir.
 * Bunlar kullanıcı hatası değildir: tutarlar sessizce bozulmuşsa ekonomi güvenilmezdir.
 */
export async function checkInvariants(sql: Sql): Promise<InvariantReport> {
  const violations: InvariantReport['violations'] = [];
  const checked: string[] = [];

  // I1 — her şirketin bakiyesi, kendi defter satırlarının net toplamına eşit olmalı.
  checked.push('I1');
  const i1 = await sql<{ id: string; currency: string; balance: string; ledger: string }[]>`
    WITH ledger AS (
      SELECT company_id, currency::text AS currency,
             SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS net
      FROM ledger_entries GROUP BY company_id, currency::text
    ),
    balances AS (
      SELECT id, 'TRY'::text AS currency, cash        AS balance FROM companies
      UNION ALL
      SELECT id, 'USD'::text AS currency, usd_balance AS balance FROM companies
    )
    SELECT b.id, b.currency, b.balance::text AS balance, COALESCE(l.net, 0)::text AS ledger
    FROM balances b
    LEFT JOIN ledger l ON l.company_id = b.id AND l.currency = b.currency
    WHERE b.balance <> COALESCE(l.net, 0)`;
  if (i1.length > 0) {
    violations.push({
      invariant: 'I1',
      detail: `${i1.length} şirket-para birimi çiftinde bakiye ile defter uyuşmuyor`,
      rows: i1.slice(0, 10),
    });
  }

  // I1-global — defter çift taraflı olduğu için tüm bakiyelerin toplamı sıfır olmalı.
  checked.push('I1-global');
  const totals = await sql<{ currency: string; total: string }[]>`
    SELECT 'TRY' AS currency, SUM(cash)::text        AS total FROM companies
    UNION ALL
    SELECT 'USD' AS currency, SUM(usd_balance)::text AS total FROM companies`;
  for (const row of totals) {
    if (BigInt(row.total ?? '0') !== 0n) {
      violations.push({
        invariant: 'I1-global',
        detail: `${row.currency} toplam bakiye sıfır değil: ${row.total}`,
        rows: [row],
      });
    }
  }

  // I2 — oyuncu/NPC şirketlerinde negatif bakiye olamaz (sistem şirketleri muaf).
  checked.push('I2');
  const i2 = await sql<{ id: string; kind: string; cash: string; usd: string }[]>`
    SELECT id, kind::text, cash::text, usd_balance::text AS usd
    FROM companies
    WHERE kind <> 'SYSTEM' AND (cash < 0 OR usd_balance < 0)`;
  if (i2.length > 0) {
    violations.push({ invariant: 'I2', detail: `${i2.length} şirkette negatif bakiye`, rows: i2 });
  }

  // R5 — yuvarlama artıklarının toplamı sıfır olmalı; değilse sistematik sapma var.
  checked.push('R5-residue');
  const residue = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(rounding_residue), 0)::text AS total FROM ledger_entries`;
  const residueTotal = BigInt(residue[0]?.total ?? '0');
  if (residueTotal !== 0n) {
    violations.push({
      invariant: 'R5-residue',
      detail: `yuvarlama artıkları sıfırlanmıyor: ${residueTotal} nano-birim`,
      rows: [{ residueTotal: residueTotal.toString() }],
    });
  }

  return { ok: violations.length === 0, checked, violations };
}

/** İhlal varsa fırlatır — tick kapanışında ve testlerde kullanılır. */
export async function assertInvariants(sql: Sql): Promise<void> {
  const report = await checkInvariants(sql);
  if (!report.ok) {
    const first = report.violations[0]!;
    throw new InvariantViolation(first.invariant, first.detail, {
      violations: report.violations,
    });
  }
}
