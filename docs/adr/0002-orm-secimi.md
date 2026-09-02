# ADR-0002: ORM olarak Drizzle

**Durum:** Kabul edildi · **Tarih:** 2026-09-02

## Bağlam
NestJS + PostgreSQL. Tick motorunun sıcak yolu toplu (set-based) SQL:
`UPDATE ... FROM (VALUES ...)`, CTE'ler, `FOR UPDATE SKIP LOCKED`,
`INSERT ... ON CONFLICT DO NOTHING`, partition'lı tablolar.

## Karar
**Drizzle ORM.**

## Gerekçe
| Kriter | Drizzle | Prisma |
|---|---|---|
| Toplu UPDATE/CTE | Native, tipli | `$queryRaw` (tipsiz) |
| `SKIP LOCKED` | Destekli | Raw |
| Advisory lock | Raw ama akıcı | Raw |
| Partition | Sorun yok | Migration'da sürtünme |
| `bigint` desteği | Native | Destekli |
| Bundle/soğuk başlangıç | Küçük | Rust engine |
| Migration DX | İyi | **Daha iyi** |

Tick motorunun %80'i Prisma'da `$queryRaw` olarak yazılacaktı → Prisma'nın tek
avantajı (tip güvenli sorgu üreticisi) kaybolur, dezavantajları kalırdı.

## Sonuçlar
- ✅ Tick motoru tipli SQL ile yazılır
- ✅ `packages/db` şeması hem API hem worker hem sim tarafından paylaşılır
- ⚠️ Migration üretimi Prisma kadar olgun değil → `drizzle-kit` çıktısı elle gözden geçirilir
- ⚠️ Ekip Prisma'ya alışkınsa öğrenme eğrisi var
