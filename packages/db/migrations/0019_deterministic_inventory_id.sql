-- ★ Envanter kimliği tesis kimliğinden TÜRETİLİR (R79).
--
-- Tetikleyici `gen_random_uuid()` kullanıyordu. Tesis kimlikleri
-- deterministik yapıldıktan sonra bile aynı tohumla iki koşum farklı sonuç
-- veriyordu; kalan kaynaklardan biri buydu.
--
-- Etkisi dolaylı ama gerçek: sim'in stok sorgusu `ORDER BY b.inventory_id`
-- ile sıralanıyor, yani envanter kimliği satır sırasını belirliyor ve o sıra
-- kıt malın kime gittiğini değiştirebiliyor.
--
-- Bir tesisin bir envanteri vardır; md5(tesis kimliği) hem deterministik hem
-- benzersizdir.
CREATE OR REPLACE FUNCTION facility_create_inventory() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO inventories (id, company_id, facility_id, capacity)
  VALUES (md5(NEW.id::text)::uuid, NEW.company_id, NEW.id, NEW.storage_capacity);
  RETURN NULL;
END $$;
