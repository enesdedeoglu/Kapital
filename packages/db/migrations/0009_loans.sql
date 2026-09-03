-- =============================================================================
-- 0009 · Krediler — F5
-- docs/03 §7 · docs/09 F5 · riskler R15, R16
--
-- NOT: `loans` tablosu F0'da şema dokümanına yazılmış ama migration'a
-- girmemişti. Şema-ayrışma testi Drizzle ↔ veritabanı arasını korur,
-- doküman ↔ veritabanı arasını korumaz; eksik F5'te ortaya çıktı.
-- =============================================================================

CREATE TYPE loan_status AS ENUM ('ACTIVE', 'PAID', 'DEFAULTED', 'LIQUIDATED');

/*
 * ★ KREDİ VERMEK PARA YARATIR (R15).
 *
 * Anapara `SYS_BANK`'tan çıkar — karşılığı olmayan para. Geri ödeme aynı yere
 * döner ve parayı YOK EDER. Faiz `SYS_SINK`'e gider (kalıcı gider).
 *
 * Bu yüzden limit keyfi olamaz: `company_value × kaldıraç(seviye) − mevcut borç`.
 * Şirket değerindeki stok likidite iskontosuyla değerlendiği için (C3) oyuncu
 * teminatını yapay olarak şişiremez.
 */
CREATE TABLE loans (
  id                    BIGSERIAL PRIMARY KEY,
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  principal             BIGINT NOT NULL CHECK (principal > 0),
  interest_rate         DOUBLE PRECISION NOT NULL CHECK (interest_rate >= 0),
  remaining_balance     BIGINT NOT NULL,
  payment_per_tick      BIGINT NOT NULL CHECK (payment_per_tick > 0),
  total_paid            BIGINT NOT NULL DEFAULT 0,
  interest_paid         BIGINT NOT NULL DEFAULT 0,
  missed_payments       SMALLINT NOT NULL DEFAULT 0,
  -- Limit denetimi ve denetlenebilirlik: kredi hangi teminatla verildi?
  company_value_at_open BIGINT NOT NULL,
  leverage_at_open      DOUBLE PRECISION NOT NULL,
  opened_tick           BIGINT NOT NULL,
  due_tick              BIGINT NOT NULL,
  defaulted_at_tick     BIGINT,
  status                loan_status NOT NULL DEFAULT 'ACTIVE',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT balance_non_negative CHECK (remaining_balance >= 0)
);
-- Tick motorunun taradığı tek index: aktif krediler (madde 54)
CREATE INDEX loans_active ON loans (company_id) WHERE status = 'ACTIVE';
CREATE INDEX loans_due ON loans (due_tick) WHERE status = 'ACTIVE';

-- Taksit geçmişi — "neden batırdım" sorusunun cevabı oyuncuya gösterilebilmeli
CREATE TABLE loan_payments (
  tick_id       BIGINT NOT NULL,
  loan_id       BIGINT NOT NULL,
  company_id    UUID NOT NULL,
  amount        BIGINT NOT NULL,
  principal_part BIGINT NOT NULL,
  interest_part BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  outcome       TEXT NOT NULL,   -- 'PAID' | 'MISSED' | 'LIQUIDATION'
  PRIMARY KEY (tick_id, loan_id)
) PARTITION BY RANGE (tick_id);
CREATE INDEX loan_payments_company ON loan_payments (company_id, tick_id);

SELECT ensure_tick_partition('loan_payments', d) FROM generate_series(0, 13) AS d;
CREATE TABLE loan_payments_default PARTITION OF loan_payments DEFAULT;

-- ★ R15 izlemesi: kredinin para arzı içindeki payı %20'yi aşarsa alarm
ALTER TABLE economy_snapshots
  ADD COLUMN credit_outstanding BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN credit_share       DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN active_loans       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN defaults_24h       INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE loans IS
  'Kredi verme para YARATIR (SYS_BANK), geri ödeme YOK EDER. Faiz SYS_SINK''e gider (R15).';
