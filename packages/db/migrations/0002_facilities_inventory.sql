-- =============================================================================
-- 0002 · Tesisler ve lot bazlı envanter — F1
-- docs/03 §4 · docs/06 §4 (aynı stoğun iki kez satılması savunması)
-- =============================================================================

CREATE TABLE facilities (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  facility_type_id   SMALLINT NOT NULL REFERENCES facility_types(id),
  city_id            SMALLINT NOT NULL REFERENCES cities(id),
  name               TEXT,
  level              SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 30),
  condition          NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  technology_bonus   DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- MVP'de sabit; F11'de employees tablosundan türer. Formül şimdi yazılır ki
  -- çalışan sistemi geldiğinde formül değişikliği gerekmesin (docs/11 B2).
  staff_score        DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  production_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  active_recipe_id   INTEGER REFERENCES production_recipes(id),
  storage_capacity   BIGINT NOT NULL CHECK (storage_capacity > 0),
  construction_complete_at_tick BIGINT NOT NULL,
  halted_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at          TIMESTAMPTZ
);

-- Tick motorunun taradığı index: tüm tabloyu değil, yalnız iş gerektirenleri (madde 54)
CREATE INDEX facilities_active_production ON facilities (city_id, facility_type_id)
  WHERE production_enabled AND closed_at IS NULL;
CREATE INDEX facilities_by_company ON facilities (company_id) WHERE closed_at IS NULL;
CREATE INDEX facilities_construction ON facilities (construction_complete_at_tick)
  WHERE closed_at IS NULL;

-- --------------------------------------------------------------------------
-- Envanter TESİSE bağlıdır, şirkete değil (docs/04 §2.2):
--   · depo kapasitesi tesis bazlıdır (madde 36)
--   · bir şehirdeki stok başka şehirde satılamaz → lojistik anlamlı olur
--   · stok kilidi tek tesise iner → çekişme azalır
-- --------------------------------------------------------------------------
CREATE TABLE inventories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  facility_id   UUID NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
  capacity      BIGINT NOT NULL CHECK (capacity > 0),
  used_capacity BIGINT NOT NULL DEFAULT 0,
  -- ★ Değişmez I4: depo kapasitesi aşılamaz. Trigger ile senkron tutulur,
  --   dolayısıyla uygulama katmanı atlansa bile ihlal edilemez.
  CONSTRAINT used_within_capacity CHECK (used_capacity <= capacity),
  CONSTRAINT used_non_negative    CHECK (used_capacity >= 0)
);
CREATE INDEX inventories_by_company ON inventories (company_id);

CREATE TABLE inventory_batches (
  id                 BIGSERIAL PRIMARY KEY,
  inventory_id       UUID NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  product_id         SMALLINT NOT NULL REFERENCES products(id),
  quantity           BIGINT NOT NULL,
  -- ★ Aynı stoğun iki kez satılmasını engelleyen alan (docs/06 §4).
  --   Akış: rezerve (reserved += q) → sevkiyat → varışta quantity -= q, reserved -= q
  reserved_quantity  BIGINT NOT NULL DEFAULT 0,
  quality            NUMERIC(6,3) NOT NULL CHECK (quality >= 0 AND quality <= 100),
  unit_cost          BIGINT NOT NULL CHECK (unit_cost >= 0),
  produced_in_tick   BIGINT,
  expires_at_tick    BIGINT,
  source_company_id  UUID REFERENCES companies(id),
  source_facility_id UUID REFERENCES facilities(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT qty_positive     CHECK (quantity > 0),
  CONSTRAINT reserve_le_qty   CHECK (reserved_quantity BETWEEN 0 AND quantity)
);

-- FEFO: önce bozulacak önce çıkar, eşitlikte FIFO (id artan).
CREATE INDEX batches_fefo ON inventory_batches
  (inventory_id, product_id, expires_at_tick NULLS LAST, id);
CREATE INDEX batches_expiring ON inventory_batches (expires_at_tick)
  WHERE expires_at_tick IS NOT NULL;

-- --------------------------------------------------------------------------
-- used_capacity senkronu — I4'ün uygulama noktası
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_capacity_sync() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE inventories SET used_capacity = used_capacity + NEW.quantity
     WHERE id = NEW.inventory_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE inventories SET used_capacity = used_capacity - OLD.quantity
     WHERE id = OLD.inventory_id;
  ELSIF NEW.quantity <> OLD.quantity OR NEW.inventory_id <> OLD.inventory_id THEN
    UPDATE inventories SET used_capacity = used_capacity - OLD.quantity
     WHERE id = OLD.inventory_id;
    UPDATE inventories SET used_capacity = used_capacity + NEW.quantity
     WHERE id = NEW.inventory_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER inventory_batches_capacity
AFTER INSERT OR UPDATE OR DELETE ON inventory_batches
FOR EACH ROW EXECUTE FUNCTION inventory_capacity_sync();

-- Tesis kurulunca envanteri de oluşur (1:1, docs/04 §2.2)
CREATE OR REPLACE FUNCTION facility_create_inventory() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO inventories (company_id, facility_id, capacity)
  VALUES (NEW.company_id, NEW.id, NEW.storage_capacity);
  RETURN NULL;
END $$;

CREATE TRIGGER facilities_create_inventory
AFTER INSERT ON facilities
FOR EACH ROW EXECUTE FUNCTION facility_create_inventory();
