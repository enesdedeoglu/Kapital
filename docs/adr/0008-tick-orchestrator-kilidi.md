# ADR-0008: Tur orchestrator'ı — PostgreSQL danışma kilidi, şimdilik BullMQ yok

**Durum:** Kabul edildi · **Tarih:** 3 Eylül 2026 · **Faz:** F2

## Bağlam
Plan (`docs/05`, madde 50) orchestrator için Redis lider kilidi ve fazların
BullMQ ile shard'lara dağıtılmasını öngörüyordu. F2'de iki gerçek kısıt var:

1. **Redis bu ortamda çalışmıyor** (Docker daemon kapalı, yerel Redis yok).
   Test edilemeyen kuyruk kodu göndermek, yazmamaktan kötüdür.
2. **F2'nin ölçeği bunu gerektirmiyor.** MVP-0'da 5 şehir × 10 ürün = 50 pazar;
   fazlar tek süreçte saniyenin altında bitiyor.

## Karar
- **Lider seçimi: PostgreSQL oturum bazlı danışma kilidi** (`pg_try_advisory_lock`).
  Zaten var olan bir bağımlılık; worker birden çok kopya halinde çalışabilir,
  kilidi alan turu koşar, diğerleri sessizce atlar.
- **Fazlar şimdilik tek süreçte, sırayla koşar.** Faz tanımları (`ACTIVE_PHASES`)
  shard anahtarını ve süre bütçesini *baştan* taşır; BullMQ'ya geçiş bir
  **taşıma değişikliğidir**, iş mantığı değişikliği değil.
- Faz durum makinesi (`tick_phase_runs`) ve idempotency baştan yazıldı:
  dağıtık koşuma geçildiğinde davranış aynı kalır.

## Kritik uygulama detayı
Oturum bazlı danışma kilidi **alındığı bağlantıda** bırakılmalıdır. Havuzdan
rastgele bağlantılarla çalışılırsa `pg_advisory_unlock` başka bir oturumda koşar,
**sessizce başarısız olur** ve kilit sonsuza kadar tutulu kalır — sonraki tüm
turlar sessizce atlanır. Bu yüzden `sql.reserve()` ile bağlantı rezerve edilir.

Bu hata F2 sırasında gerçekten yaşandı ve testler yakaladı.

## Ne zaman BullMQ'ya geçilir
`docs/05 §4`'teki faz süre bütçeleri p95'te aşılmaya başladığında — pratikte
birkaç bin aktif şirket civarı. Geçiş `RUNNERS` haritasını kuyruk üreticisiyle
değiştirmekten ibarettir; `tick_phase_runs.shard_total/shard_done` alanları
bunun için zaten mevcut.

## Sonuçlar
- ✅ F2 bugün çalışıyor ve test edilebiliyor; bir bağımlılık daha az
- ✅ Faz sınırları, shard anahtarları ve idempotency baştan doğru
- ⚠️ Tek süreç → fazlar paralel koşmuyor; ölçek geldiğinde taşıma değişecek
- ⚠️ Danışma kilidi bağlantıya bağlıdır; `sql.reserve()` atlanırsa sessiz kilitlenme
