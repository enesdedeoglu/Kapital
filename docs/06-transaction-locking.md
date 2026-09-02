# 06 — Transaction ve Kilitleme Stratejisi

Madde 49 ve 58'in gereği: çift harcama ve aynı stoğun iki kez satılması **imkânsız**
olmalı. Aşağıdaki strateji bunu üç seviyede garanti eder: DB kısıtı → kilit protokolü →
uygulama katmanı.

## 1. İzolasyon seviyesi

**Varsayılan: `READ COMMITTED` + açık kilitler.**

`SERIALIZABLE` global olarak kullanılmaz: 100k oyuncuda serialization failure retry
fırtınası yaratır ve tick motorunun toplu işlemlerini kilitler. Bunun yerine kritik
noktalarda `SELECT ... FOR UPDATE` ile pesimistik kilit alınır — daha öngörülebilir.

Tek istisna: `money_supply_guard` denetim job'ı `REPEATABLE READ` ile tutarlı bir
anlık görüntü okur (yazma yapmaz).

## 2. Kilit sırası protokolü (deadlock önleme)

**Altın kural:** Bir transaction birden fazla kilit alacaksa **her zaman aynı sırada** alır.

```
1. companies      (id ASC)
2. facilities     (id ASC)
3. inventories    (id ASC)
4. inventory_batches (id ASC)
5. market_orders  (id ASC)
6. loans          (id ASC)
```

İki şirket arası transferde (alıcı/satıcı) **UUID'ye göre küçük olan önce** kilitlenir:

```ts
const [first, second] = [buyerId, sellerId].sort();
await tx.execute(sql`SELECT id FROM companies WHERE id IN (${first},${second})
                     ORDER BY id FOR UPDATE`);
```

Tek `ORDER BY id FOR UPDATE` sorgusuyla iki satırı birlikte kilitlemek, ayrı ayrı
kilitlemekten daha güvenlidir — PostgreSQL sıralamayı garanti eder.

## 3. Para transferi (çift harcama savunması)

Tek bir servis fonksiyonu, tüm para hareketlerinin **tek geçiş noktası**:

```ts
// packages/../finance/transfer.ts — başka hiçbir yerde companies.cash UPDATE edilmez
async function transfer(tx, { from, to, amount, account, reason, ref, tickId }) {
  assert(amount > 0n);
  const ids = [from, to].sort();
  await lockCompanies(tx, ids);                       // ORDER BY id FOR UPDATE

  const ok = await tx.execute(sql`
    UPDATE companies SET cash = cash - ${amount}
    WHERE id = ${from} AND cash >= ${amount}`);       // ★ atomik yeterlilik kontrolü
  if (ok.rowCount === 0) throw new InsufficientFunds();

  await tx.execute(sql`UPDATE companies SET cash = cash + ${amount} WHERE id = ${to}`);
  await writeLedgerPair(tx, {...});                   // DEBIT + CREDIT
}
```

Üç savunma katmanı:
1. `UPDATE ... WHERE cash >= amount` → **kontrol ve düşme tek atomik ifadede**.
   "Önce oku, sonra yaz" (TOCTOU) yarışı imkânsız.
2. `CHECK (cash >= 0)` tablo kısıtı → herhangi bir kod yolu kaçarsa DB reddeder.
3. Değişmez I1 (`Σcash = ledger toplamı`) her tick sonunda doğrular.

## 4. Stok tüketimi (aynı stoğun iki kez satılması savunması)

`inventory_batches.reserved_quantity` alanı bu problemin tek çözümüdür.

```sql
-- FEFO ile rezerve et; kilitli lotları atla (paralel worker'lar birbirini beklemez)
WITH picked AS (
  SELECT id, quantity - reserved_quantity AS available
  FROM inventory_batches
  WHERE inventory_id = $1 AND product_id = $2
    AND quality >= $3 AND quantity > reserved_quantity
  ORDER BY expires_at_tick NULLS LAST, id
  FOR UPDATE SKIP LOCKED
)
UPDATE inventory_batches b
SET reserved_quantity = b.reserved_quantity + alloc.take
FROM allocate($4, picked) alloc
WHERE b.id = alloc.id
RETURNING b.id, alloc.take, b.quality, b.unit_cost;
```

Akış:
```
rezerve (reserved += q)  →  shipment oluştur  →  varışta:
      quantity -= q, reserved -= q  →  alıcıda yeni batch
iptal olursa:  reserved -= q   (quantity dokunulmaz)
```

`CHECK (reserved_quantity <= quantity)` kısıtı, her kod yolunun son savunması.

**`SKIP LOCKED` neden kritik:** P2 fazında 64 worker aynı ürünün lotlarına bakabilir.
`SKIP LOCKED` olmadan hepsi ilk lotta sıraya girer ve faz süresi 10 saniyeden
dakikalara çıkar.

## 5. Emir defteri kilidi (advisory lock)

Oyuncunun uygulamadan emir vermesi ile tick motorunun eşleştirme yapması **aynı anda**
olabilir. Çözüm: (product, city) başına danışma kilidi.

```sql
SELECT pg_advisory_xact_lock(hashtextextended(format('book:%s:%s', $product, $city), 0));
```

- Transaction bitince otomatik bırakılır (`xact` varyantı — sızıntı riski yok)
- Satır kilidi değil, mantıksal kilit → emir defterinin tamamı tutarlı görülür
- P2 fazı ürün bazlı shard'lı olduğu için worker'lar arası çekişme sıfır;
  kilit yalnızca **oyuncu ↔ motor** çakışmasını çözer

## 6. Oyuncu isteklerinde idempotency

Mobilde çift dokunma / ağ retry gerçek bir risktir. Tüm mutasyon endpoint'leri
`Idempotency-Key` header'ı ister:

```
POST /market/orders          Idempotency-Key: <uuid>
POST /facilities             Idempotency-Key: <uuid>
POST /facilities/:id/upgrade Idempotency-Key: <uuid>
```

`idempotency_keys` tablosunda PK çakışması → ilk isteğin kaydedilmiş yanıtı döner,
işlem tekrar edilmez. TTL 24 saat.

## 7. Uzun süren işlemlerde kilit tutma yasağı

| Yasak | Doğrusu |
|---|---|
| Tüm fazı tek transaction'da koşmak | 1.000 varlıklık chunk'lar |
| Transaction içinde HTTP/Redis çağrısı | Önce hazırla, sonra transaction aç |
| `FOR UPDATE` ile 10.000 satır kilitlemek | `SKIP LOCKED` + chunk |
| Transaction içinde push bildirim göndermek | `outbox` tablosuna yaz, dispatcher gönderir |

`statement_timeout = 10s` (API), `= 60s` (worker); `idle_in_transaction_session_timeout = 30s`.
Kaçak transaction veritabanını kilitleyemez.

## 8. Tick motorunda kilit stratejisi özeti

| Faz | Kilit | Gerekçe |
|---|---|---|
| P0 | Redis lider kilidi | Tek orchestrator |
| P1 | Yok (shard izolasyonu yeterli) | Her worker kendi şirketlerine dokunur |
| P2 | `pg_advisory_xact_lock(product,city)` + batch `SKIP LOCKED` | Oyuncu emirleriyle çakışma |
| P3 | Batch `SKIP LOCKED` | Stok düşümü |
| P4 | Şirket satırı `FOR UPDATE` (chunk içinde) | Nakit düşümü |
| P5 | Yok (salt okuma + agregat yazma) | |
| P6 | NPC şirket satırı `FOR UPDATE` | NPC emir verirken escrow |
| P7 | Yok | |

## 9. Test edilebilirlik

Bu stratejinin doğruluğu **integration test** ile kanıtlanır (Testcontainers + gerçek PG):

| Test | Senaryo | Beklenen |
|---|---|---|
| `T1` | 100 eşzamanlı satın alma, nakit yalnız 50'ye yetiyor | Tam 50 başarılı, `cash = 0`, negatif yok |
| `T2` | Aynı lot 2 alıcıya paralel satılıyor | Toplam satılan ≤ lot miktarı |
| `T3` | Aynı tick 3 kez koşturuluyor | `retail_sales` satır sayısı ve `cash` değişmiyor |
| `T4` | A→B ve B→A transferleri paralel | Deadlock yok |
| `T5` | Aynı `Idempotency-Key` ile 5 istek | 1 emir, 5 aynı yanıt |
| `T6` | 1000 tick simülasyonu sonunda | `Σcash == ledger toplamı` (I1) |

Bu 6 test **F2 fazının çıkış kriteridir**; geçmeden ileri faza geçilmez.
