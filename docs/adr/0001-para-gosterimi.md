# ADR-0001: Para ve miktar gösterimi

**Durum:** Kabul edildi · **Tarih:** 2026-09-02

## Bağlam
Madde 58.1: "Para değerlerini floating point tutma." Ancak ekonomi formülleri
(çekicilik, pazar payı, kalite) doğası gereği ondalıklı katsayılarla çalışır.

## Karar
- **Para:** `BIGINT`, 1 ₺ = 10.000 birim (scale 4). TS'de branded `Money = bigint`.
- **Miktar:** `BIGINT`, 1 birim = 1.000 (scale 3). Reçetelerdeki 0.5 kg → 500.
- **Katsayı:** `DOUBLE PRECISION` / `number`. Para değildir.
- **Sınır:** `roundToMoney()` tek yuvarlama noktası, banker's rounding,
  artık `ledger_entries.rounding_residue`'ye yazılır.

## Alternatifler
- `NUMERIC(20,4)` + decimal.js: doğru ama her aritmetik işlem heap allocation.
  Tick'te milyonlarca işlem var → GC baskısı.
- `NUMERIC` DB'de, `number` TS'de: sessiz hassasiyet kaybı. Reddedildi.

## Sonuçlar
- ✅ Toplama/çıkarma tam; para arzı doğrulanabilir (değişmez I1)
- ✅ PostgreSQL toplamları hızlı (`SUM(bigint)`)
- ⚠️ Her para okuması/yazımında ölçek dönüşümü gerekir → tek yardımcı modülde toplanır
- ⚠️ JSON'da `bigint` serialize edilemez → API sınırında `string`'e çevrilir
