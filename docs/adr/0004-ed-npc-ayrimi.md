# ADR-0004: Economic Director'ın NPC'den mimari ayrımı

**Durum:** Kabul edildi · **Tarih:** 2026-09-02

## Bağlam
Madde 28: "Bu iki sistem kesinlikle ayrı olmalıdır." Disiplinle korunan sınırlar
zamanla erir — birinin "sadece bir kere" global veriye bakması yeterlidir.

## Karar
Sınır **tip sistemiyle** zorlanır:
- `DirectorView` içinde şirket bazlı **hiçbir alan yoktur** → ED bir oyuncuyu göremez.
- `DirectorOutput = NpcDirective[]` → ED bir emir veya fiyat **üretemez**.
- ED'nin tek yazma hedefi `npc_directives` tablosudur.
- Direktifler 5 kaldıraçla sınırlı, `-1..+1` aralığında, `expires_tick` ile sönümlenir.
- Acil rezerv `SYS_RESERVE` adlı **gerçek bir şirket** üzerinden, normal kurallarla işler.

## Sonuçlar
- ✅ "ED oyuncuyu hedef aldı" şüphesi teknik olarak imkânsız
- ✅ Müdahaleler denetlenebilir (`npc_directives` tam kayıt tutar)
- ✅ Müdahale kendiliğinden sönümlenir; kalıcı distorsiyon oluşmaz
- ⚠️ ED daha az güçlü — bazı krizleri yalnız dolaylı çözebilir. Bu **kasıtlıdır**.
- ⚠️ Direktif → NPC davranışı arasında 1 tick gecikme var
