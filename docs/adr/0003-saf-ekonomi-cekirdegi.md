# ADR-0003: `packages/economy` — saf ekonomi çekirdeği

**Durum:** Kabul edildi · **Tarih:** 2026-09-02

## Bağlam
Madde 55, canlıya çıkmadan önce 1.000 şirket × 90 gün simülasyonu istiyor.
Naif yaklaşım: simülasyonu ayrı yazmak. Bu, iki ayrı ekonomi implementasyonu
demektir ve birkaç hafta içinde **ayrışırlar** — simülasyon sonucu canlı oyunu
temsil etmez, dolayısıyla değersizleşir.

## Karar
Tüm oyun dengesi formülleri **I/O'suz saf fonksiyonlar** olarak `packages/economy`'de.
Yasaklı: DB erişimi, Redis, `Date.now()`, `Math.random()`, ortam değişkeni.
Zaman `tick.seq` olarak, rastgelelik seed'li RNG olarak **enjekte edilir**.

## Sonuçlar
- ✅ `packages/sim` **gerçek üretim formüllerini** koşar → ayrışma imkânsız
- ✅ Formüller mikrosaniyede unit-test edilir, DB gerekmez
- ✅ NPC ve Economic Director aynı formülleri okur → NPC ayrıcalıklı varlık değil
- ✅ Tick deterministik → hata ayıklama tekrar oynatılabilir
- ⚠️ Disiplin gerektirir: bir formüle "hızlıca DB'den bir şey çekelim" denemez.
  Gerekli veri **çağıran taraf** tarafından toplanıp context olarak geçirilir.
- ⚠️ Bazı fonksiyonlar geniş context nesneleri alır → tip tanımları büyük olur
