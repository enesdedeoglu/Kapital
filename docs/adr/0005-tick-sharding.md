# ADR-0005: Tick faz bölümlemesi ve shard anahtarları

**Durum:** Kabul edildi · **Tarih:** 2026-09-02

## Bağlam
Madde 53'te 25 sıralı adım, madde 54'te 100.000 oyuncu hedefi. Tek işlemcide
sıralı koşan 25 adım bu ölçekte 15 dakikaya sığmaz.

## Karar
25 adım → **8 faz**. Faz sırası zorunlu; faz içi shard'lar paralel.

Shard anahtarı seçimi, **çakışma yüzeyine** göre:

| Faz | Anahtar | Neden |
|---|---|---|
| P1 PRODUCE | `company_id` hash | Üretim yalnız kendi tesisine yazar |
| P2 EXCHANGE | `product_id` | Emir defteri ürün başına; iki worker aynı defteri görmez |
| P3 RETAIL | `city_id` | Pazar payı şehir×ürün içinde hesaplanır |
| P4 UPKEEP | `company_id` hash | Nakit yalnız kendi şirketine |
| P5 SETTLE | `company_id` → global | Önce şirket P&L, sonra agregat |
| P6 GOVERN | ED tekil → NPC hash | ED tek karar noktası |

## Reddedilen alternatif
Tek shard anahtarı (`company_id`) her faz için. Reddedildi: P2'de iki worker aynı
ürünün emir defterini işler → satır kilidi çekişmesi ve tutarsız eşleşme.

## Sonuçlar
- ✅ Shard'lar arası satır çakışması yapısal olarak yok
- ✅ Yatay ölçekleme: shard sayısı config'ten artırılır
- ⚠️ Fazlar arası bariyer gerekir (tüm shard'lar bitmeden sonraki faz başlamaz)
  → `tick_phase_runs.shard_done` sayacı
- ⚠️ Bir shard'ın yavaş olması tüm fazı bekletir (straggler) → shard boyutu dengelenmeli
