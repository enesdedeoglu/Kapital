-- =============================================================================
-- 0006 · NPC şirket adları benzersiz
--
-- Seed idempotent olmalıydı ama `ON CONFLICT DO NOTHING` işe yaramıyordu:
-- `companies` tablosunda ada dair bir benzersizlik kısıtı yok, dolayısıyla
-- her seed koşusu NPC'leri yeniden yaratıyordu (5 → 10 → 15…).
--
-- Uygulama katmanındaki kontrol yeterli değil; garanti veritabanında olmalı.
-- =============================================================================

-- Var olan kopyaları temizle: her ad için en eskisi kalır.
DELETE FROM companies c
 WHERE c.kind = 'NPC'
   AND EXISTS (
     SELECT 1 FROM companies o
     WHERE o.kind = 'NPC' AND o.name = c.name AND o.created_at < c.created_at
   );

CREATE UNIQUE INDEX companies_npc_name_unique ON companies (name) WHERE kind = 'NPC';
