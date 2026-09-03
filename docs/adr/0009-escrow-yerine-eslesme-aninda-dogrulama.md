# ADR-0009: Escrow yerine eşleşme anında bakiye doğrulaması

**Durum:** Kabul edildi · **Tarih:** 3 Eylül 2026 · **Faz:** F4

## Bağlam
`docs/03`'te `market_orders.escrow_amount` alanı vardı: alış emri verilirken
paranın bloke edilmesi öngörülüyordu. Uygulama sırasında bunun bir sistem
şirketi (`SYS_ESCROW`) gerektirdiği görüldü — para bir yerde durmalı ve defter
dengede kalmalı.

Bunun bedeli yalnızca bir tablo satırı değil: **para arzı ölçümü bozulur.**
`docs/12`'de para arzı `Σ(oyuncu + NPC nakdi)` olarak tanımlı; escrow'daki
para geçici olarak bu toplamın dışına çıkar ve metrik yanıltıcı olur.

## Karar
Escrow kullanılmaz. Para transferi **eşleşme anında** denenir; bakiye
yetmezse o eşleşme atlanır ve emir açık kalır.

## Neden güvenli
Satıcı zarar görmez: **stok yalnız BAŞARILI eşleşmede tüketilir.** Transfer
`InsufficientFunds` fırlatırsa transaction geri alınır ve satıcının malı
yerinde kalır. Bu, testle doğrulanmıştır ("alıcının parası yetmezse satıcı
stoğunu kaybetmez").

Oyuncu nakdinden fazla toplam değerde alış emri verebilir; yalnız bir kısmı
dolar. Bu, teminatsız limit emri davranışıdır ve kimseyi mağdur etmez.

## Sonuçlar
- ✅ Bir sistem şirketi ve para arzı ölçümünde bir sapma daha yok
- ✅ Emir vermek ucuz: bloke yok, iptal maliyeti yok
- ⚠️ Emir defterindeki toplam alış talebi, gerçekte karşılanabilir olandan
  fazla görünebilir — UI'da "açık emirlerin toplam değeri > nakit" uyarısı
  gösterilmeli (F9)
- ⚠️ `market_orders.escrow_amount` kolonu şemada duruyor ama kullanılmıyor;
  teminatlı emir gerekirse (örn. vadeli sözleşmeler) yeri hazır
