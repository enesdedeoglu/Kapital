# @kapital/economy — saf ekonomi çekirdeği

**Bu pakette I/O YOKTUR.** Veritabanı yok, Redis yok, `Date.now()` yok,
`Math.random()` yok, ortam değişkeni yok.

Zaman `tick.seq` olarak, rastgelelik seed'li RNG olarak **enjekte edilir**.
Gerekli tüm veri, çağıran taraf tarafından toplanıp context olarak geçirilir.

Gerekçe — [ADR-0003](../../docs/adr/0003-saf-ekonomi-cekirdegi.md):

1. `packages/sim` (F8) **gerçek üretim formüllerini** koşar. İki ayrı
   implementasyon yazılsaydı birkaç hafta içinde ayrışır ve denge simülasyonu
   canlı oyunu temsil etmez, dolayısıyla değersizleşirdi.
2. Formüller mikrosaniyede unit-test edilir, veritabanı gerekmez.
3. NPC ve Economic Director aynı formülleri okur → NPC "oyunun kurallarını
   bilen bir ajan" olur, ayrıcalıklı bir varlık değil.
4. Tick deterministik olur → hata ayıklama tekrar oynatılabilir.

**Kural:** bir formüle "hızlıca DB'den bir şey çekelim" denemez.
