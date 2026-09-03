-- =============================================================================
-- 0008 · Ekonomi geçmişi tablolarında şirket FK'ları kaldırılır
--
-- docs/04 §3 politikası: ekonomi geçmişi taşıyan tablolar `companies`'e FK ile
-- bağlanmaz, YUMUŞAK REFERANS kullanır. İki gerekçe:
--   1. Muhasebe ve piyasa kaydı asla silinmez; şirket silinse bile geçmiş kalır
--      (KVKK: kişisel veri `users` tablosundadır, R14).
--   2. Partition'lı ve yüksek hacimli tablolarda FK doğrulaması gereksiz maliyet.
--
-- `shipments` ve `trade_flags` bu politikaya aykırı yazılmıştı ve şirket silmeyi
-- engelliyordu. Tesis FK'ları KORUNUR: sevkiyatın hedefi gerçek bir tesis olmalı.
-- =============================================================================

ALTER TABLE shipments   DROP CONSTRAINT IF EXISTS shipments_from_company_id_fkey;
ALTER TABLE shipments   DROP CONSTRAINT IF EXISTS shipments_to_company_id_fkey;
ALTER TABLE trade_flags DROP CONSTRAINT IF EXISTS trade_flags_company_a_fkey;
ALTER TABLE trade_flags DROP CONSTRAINT IF EXISTS trade_flags_company_b_fkey;

COMMENT ON COLUMN shipments.from_company_id IS
  'Yumuşak referans — companies.id. FK yoktur (docs/04 §3).';
COMMENT ON COLUMN trade_flags.company_a IS
  'Yumuşak referans — companies.id. FK yoktur (docs/04 §3).';
