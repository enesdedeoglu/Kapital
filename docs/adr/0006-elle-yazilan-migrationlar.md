# ADR-0006: Elle yazılan SQL migration'ları + şema ayrışma bekçisi

**Durum:** Kabul edildi · **Tarih:** 2026-09-02 · **Faz:** F0

## Bağlam
Şema; RANGE partition (`ledger_entries`), koşullu CHECK kısıtları
(`kind = 'SYSTEM' OR cash >= 0`), kısmi index'ler ve bir PL/pgSQL yardımcı
fonksiyonu içeriyor. `drizzle-kit generate` bunların hiçbirini üretmez;
üretilen SQL'i her seferinde elle düzeltmek, "üretilmiş dosya" güvenini yok eder.

## Karar
- **Migration'lar elle yazılır**: `packages/db/migrations/NNNN_ad.sql`.
- **Drizzle şeması yalnız tip katmanıdır** — sorgu tipi verir, DDL üretmez.
- Basit bir koşturucu (`src/cli/migrate.ts`) dosyaları sırayla, **her biri tek
  transaction içinde** uygular ve `_migrations` tablosuna checksum yazar.
- Uygulanmış bir migration sonradan düzenlenirse **checksum uyuşmazlığıyla patlar**;
  düzeltme yeni bir dosya eklemektir.

## Ayrışma riski ve kapatılması
Elle yazılan SQL ile Drizzle şeması zamanla ayrışabilir. Bu risk bir testle kapatılır:
`src/schema-drift.test.ts` Drizzle'da tanımlı **her tablo ve kolonun** veritabanında
var olduğunu doğrular. CI'da koşar.

## Sonuçlar
- ✅ Partition, kısmi index, koşullu CHECK ve fonksiyonlar doğal SQL ile yazılır
- ✅ Migration'lar okunabilir ve gözden geçirilebilir
- ✅ Değiştirilmiş migration üretimde sessizce farklı şema yaratamaz
- ⚠️ Kolon eklerken iki yer güncellenir (SQL + Drizzle) — ayrışma testi yakalar
