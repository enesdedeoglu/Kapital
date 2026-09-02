# 10 — Riskli Teknik Noktalar

Önem sırasına göre. Her risk için: **belirti → kök neden → azaltım → nasıl test edilir**.

---

## 🔴 R10 — Perakende fiyatı sınırsız para basar (EN KRİTİK)

**Bu, spec'teki tek gerçek ekonomi açığıdır ve 1. günden kapatılmalıdır.**

**Belirti:** Bir oyuncu 1 kg domatesi 1.000.000 ₺'ye koyar. NPC tüketici satın alır.
Ekonomiye 1.000.000 ₺ yoktan girer.

**Kök neden:** Madde 19'da şehir talebi **birim (adet)** cinsinden hesaplanıyor, madde 34'te
"para NPC perakende alışverişinden girer" deniyor. Ama NPC tüketicinin **bütçesi yok**.
Fiyat yükseldikçe `price_score` düşüyor, pazar payı azalıyor — ama sıfırlanmıyor.
Rekabet yoksa (o şehirde tek satıcı), pay %100 kalır ve fiyat serbesttir.
Talep birim cinsinden sabit olduğu için **musluk sonsuzdur**.

**Azaltım — üç katmanlı:**

1. **Bütçe tavanı.** Talep hem birim hem **₺ bütçesi** olarak üretilir:
   ```
   demand_units  = base_demand × pop_index × income_index × ...
   demand_budget = demand_units × ema_reference_price × income_index
   satış = min(birim_talep × pay, stok, kalan_bütçe / fiyat)
   ```
   Şehirdeki toplam harcama, referans fiyata bağlı bir tavanı aşamaz.

2. **Rezervasyon fiyatı.** `products.reservation_price_mult` (varsayılan 3.0):
   ```
   if selling_price > ema_reference × reservation_price_mult:
       attractiveness = 0        // tüketici o fiyata almaz, nokta.
   ```
   Rekabet olmasa bile fiyat referansın 3 katından yukarı çıkamaz.

3. **Musluk izleme.** `economy_snapshots.faucet_in` her tick ölçülür. Bir şirketin
   tek tick'teki perakende geliri, şehir bütçesinin %25'ini aşarsa `trade_flags` kaydı.

**Test:** Sim harness'te "tek satıcı, aşırı fiyat" ajanı koş → 90 günde para arzı
±%40 bandını aşmamalı.

---

## 🔴 R7 — Veri hacmi 3 ayda diski doldurur

**Belirti:** 3. ay, `retail_sales` tablosu 500M satır, sorgular saniyeler sürüyor.

**Hesap:** 10.000 aktif şirket × 3 tesis × 3 ürün = 90.000 satır/tick
× 96 tick/gün = **8,6 milyon satır/gün** yalnız `retail_sales`'ten.
`ledger_entries` ve `market_trades` ile birlikte ~20M satır/gün.
100k aktif oyuncuda bu 10 katına çıkar.

**Azaltım:**
1. `retail_sales` **işlem başına değil, (tick, facility, product) başına agrege** —
   PK bu üçlüdür. Tek tek tüketici işlemi asla saklanmaz.
2. `tick_id` aralığına göre partition (1 bölüm = 1 gün = 96 tick).
3. Saklama politikası (`03-veritabani-semasi.md` §10): sıcak veri 7–30 gün, sonra
   günlük rollup + detay `DROP PARTITION` (DELETE değil — anında ve vakumsuz).
4. Rollup tabloları kalıcı: `daily_company_pnl`, `hourly_price_history`.

**Test:** 90 günlük sim koşusu sonrası `pg_total_relation_size` raporu; hedef < 50 GB.

---

## 🟠 R2 — Referans fiyat geri besleme döngüsü (salınım)

**Belirti:** Bir ürünün fiyatı tick'ler arasında 40 ₺ ↔ 90 ₺ arasında zıplıyor.

**Kök neden:** Döngü kapalı:
```
referans fiyat → çekicilik → satış → işlem → referans fiyat
```
Aynı tick içinde bu döngü kapanırsa sistem osilatöre dönüşür.

**Azaltım:**
1. Çekicilik formülü **bir önceki tick'in** `ema_reference` değerini kullanır, o an
   hesaplanan medyanı değil. (P5, P3'ten sonra koşar — sıralama bunu garantiler.)
2. EMA yumuşatma: `ema = 0.25 × median + 0.75 × prev_ema`.
3. Devre kesici: tek tick'te `|ema − prev_ema| / prev_ema > 0.15` ise değişim %15'e
   kırpılır ve `PriceShock` event'i üretilir.

**Test:** Sim'de "arz şoku" senaryosu (bir ürünün tüm üreticileri kapatılır) →
fiyat monoton yükselmeli, salınmamalı.

---

## 🟠 R1 — Perakende yeniden dağıtımı sonsuz döngü / O(n²)

**Belirti:** P3 fazı bir şehirde takılıyor veya süresi patlıyor.

**Kök neden:** Madde 21: "karşılanmayan talep diğer mağazalara yeniden dağıtılmalı".
Naif implementasyon: stok bitene kadar döngü → mağaza sayısı arttıkça O(n²).

**Azaltım:**
- **Sabit 3 tur.** 3. turdan sonra kalan talep karşılanmaz (`city_demand.fulfilled_units`
  ile raporlanır — bu bir hata değil, "şehirde mal yok" sinyalidir).
- Her turda yalnız stoğu kalan mağazalar üzerinde çekicilik yeniden normalize edilir.
- Tek `UPDATE ... FROM (VALUES ...)` ile toplu yazım; mağaza başına sorgu yok.

**Test:** 500 mağazalı tek şehir senaryosunda P3 < 2 sn.

---

## 🟠 R4 — NPC ±%3 fiyat bandı krizde çok yavaş

**Belirti:** Fiyat 2 saatte %60 düştü; NPC'ler hâlâ eski fiyattan satıyor, oyuncular
NPC'lerin tüm stoğunu ucuza toplayıp anında geri satıyor (risksiz arbitraj).

**Hesap:** ±%3/tick → %50 hareket için ~23 tick ≈ **6 saat**.

**Azaltım:** Acil bant. `market_health < 35` **ve** hedef fiyat sapması > %25 ise
bant tek seferliğine ±%10'a açılır. Ayrıca NPC'nin bir tick'te satabileceği miktar
`inventory_target`'ın %20'si ile sınırlıdır — tüm stoğu tek seferde boşaltılamaz.

**Test:** Sim'de "spekülatör saldırısı" ajanı; NPC net zararı tick başına
sermayesinin %2'sini aşmamalı.

---

## 🟠 R5 — Float → para yuvarlama sapması

**Belirti:** 30 gün sonra `Σ companies.cash` ile ledger toplamı 4.271 ₺ farklı.

**Kök neden:** Katsayılar `double`, para `bigint`. Her çarpımda yuvarlama artığı oluşur.

**Azaltım:**
1. Tek yuvarlama noktası: `roundToMoney(value: number): Money` — banker's rounding.
2. Artık (`residue`) `ledger_entries.rounding_residue`'ye yazılır ve `SYS_SINK`'e
   atfedilir. Böylece toplam **her zaman** dengelidir.
3. Değişmez I1 her tick doğrular; sapma > 0 ise anında alarm.

**Test:** T6 — 1000 tick sonunda `Σcash == ledger`. Tolerans **sıfır**.

---

## 🟠 R6 — Çapraz şirket transferlerinde deadlock

**Belirti:** Yoğun saatte `deadlock detected` hataları, emirler düşüyor.

**Azaltım:** `06-transaction-locking.md` §2 kilit sırası protokolü — iki şirket her
zaman UUID sırasına göre tek `ORDER BY id FOR UPDATE` sorgusuyla kilitlenir.
`deadlock_timeout = 1s` + otomatik retry (max 3, jitter'lı backoff).

**Test:** T4 — A→B ve B→A 1000 paralel transfer, deadlock sayısı 0.

---

## 🟡 R3 — Tick süre bütçesi aşımı

**Belirti:** Tick 15 dakikadan uzun sürüyor, bir sonraki tick birikiyor → çığ.

**Azaltım:**
- Faz bazlı bütçeler ve Prometheus metrikleri (`05-economic-tick.md` §4)
- Orchestrator, önceki tick bitmeden yenisini başlatmaz (`RUNNING` kontrolü)
- p95 bütçenin %70'ini aşarsa **otomatik shard sayısı artırma**
- Acil kaçış: `is_catch_up` modu (§5)

**Test:** Yük testi — 100k şirketle P1–P7 toplam < 60 sn.

---

## 🟡 R8 — Wash trading ile referans fiyat manipülasyonu

**Belirti:** İki oyuncu birbirine 1000 ₺'den çelik satıp alıyor; referans fiyat şişiyor;
şirket değerleri (stok değerlemesi) yapay olarak patlıyor; sıralama bozuluyor.

**Azaltım:**
1. Ağırlıklı **medyan** (ortalama değil) — tek uç işlem medyanı oynatamaz.
2. P10–P90 dışı işlemler endeks dışı.
3. `trade_flags`: 24 saatte (A,B) ikilisinin karşılıklı hacmi toplam hacmin %30'unu
   aşıyor **ve** fiyat medyandan %20+ sapıyorsa → `is_excluded_from_index = true`.
4. Şirket değerinde stok, `ema_reference` ile değerlenir (anlık medyan değil).
5. **İşlem iptal edilmez** — oyuncular ticaretini yapar, sadece endeksi kirletemez
   (madde 48: "gerçek ticareti gereksiz yere engelleme").

**Test:** Sim'de wash-trade ajanı; referans fiyat sapması < %3 kalmalı.

---

## 🟡 R9 — Ekonomi ölüm sarmalı (tedarik zinciri kopması)

**Belirti:** Kimse kömür üretmiyor → çelik yok → mobilya yok → oyuncular Lv12'de tıkanıyor.

**Azaltım:** ED bant sistemi (STIMULATE → EMERGENCY) + `SYS_RESERVE`.
Ama **kritik ayar:** rezerv fiyatı referansın 1.5–2 katı. Ucuz olursa oyuncu
üretimi asla başlamaz; pahalı olursa oyuncular için üretim kârlı fırsat olur.

**Test:** Sim'de "tüm kömür üreticileri iflas" senaryosu → 200 tick içinde
oyuncu/NPC üretimi geri gelmeli, oyun oynanamaz hale gelmemeli.

---

## 🟡 R11 — Soğuk başlangıç (0 oyuncu)

**Belirti:** Lansmanda 3 oyuncu var, piyasada hiç emir yok, oyun ölü görünüyor.

**Azaltım:** NPC ekonomisi F6'te tamamlanır ve **oyuncusuz** olarak 500 tick test edilir
(F6 çıkış kriteri). Lansmanda NPC payı %60–80. NPC-NPC işlemleri de referans fiyat
üretir → yeni oyuncu ilk gün gerçek bir piyasa görür.

---

## 🟡 R12 — Config değişikliği koşan tick'i bozar

**Belirti:** Admin domates fiyatını değiştiriyor, o an koşan tick yarısı eski yarısı
yeni parametreyle hesaplanıyor → tutarsız sonuç.

**Azaltım:** P0'da `config_version` JSONB olarak tick satırına **snapshot** alınır.
Tick boyunca tüm fazlar bu snapshot'ı okur. `game_configs.effective_from_tick` ile
değişiklik gelecek bir tick'e planlanır.

---

## 🟢 R13 — Ürün grafında döngü

**Belirti:** Admin panelden "Çelik → Motor" ve "Motor → Çelik" reçeteleri giriliyor,
üretim fazı sonsuz döngüye giriyor.

**Azaltım:** Reçete kaydında topolojik sıralama doğrulaması (I8). Döngü tespit
edilirse kayıt reddedilir. Ayrıca seed testi olarak CI'da koşar.

---

## 🟢 R14 — KVKK / hesap silme

**Belirti:** Kullanıcı hesap silme talep ediyor ama şirketi ekonomi geçmişinde.

**Azaltım:** Kişisel veri yalnız `users` tablosunda. `companies.user_id` `SET NULL`
ile ayrılır, şirket `SUSPENDED` olur ve NPC devralır veya tasfiye edilir.
Ekonomi geçmişi (ledger, trades) anonim şirket UUID'si ile korunur.

---

## 🔴 R15 — Kredi anaparası para yaratır

**Belirti:** 3. hafta para arzı %60 artmış, fiyatlar şişmiş; kimse üretim yapmıyor çünkü
kredi çekip stok tutmak üretmekten kârlı.

**Kök neden:** Kredi verme bir **para yaratma** işlemidir — `SYS_BANK` karşılığı olmayan
parayı oyuncuya aktarır. Faiz bir giderdir ama **anapara bir musluktur**. Limit keyfi ya da
faiz düşükse, kredi çekmek bedava paraya dönüşür. R10'un ikinci biçimi.

**Azaltım:**
1. **Limit keyfi değil, şirket değerine bağlı:** `max_loan = company_value × leverage(level) − mevcut_borç`.
   Şirket değerindeki stok, piyasa medyanı + likidite iskontosuyla değerlendiği için (C3)
   oyuncu teminatını yapay olarak şişiremez.
2. Kaldıraç seviyeye bağlı: Lv1–5 → 0,40 · Lv6–12 → 0,60 · üstü 0,75.
3. **Faiz enflasyona bağlanır:** `rate = base_rate × (1 + k × game_cpi_change)`.
   Para arzı şişerse borçlanma pahalılaşır — merkez bankası refleksi, tek satır formül.
4. `economy_snapshots`'a `credit_outstanding` ve kredinin para arzı içindeki payı yazılır;
   **%20'yi aşarsa alarm**.

**Test:** Sim'de "maksimum kaldıraç" ajanı koş → 90 günde para arzı ±%40 bandını aşmamalı,
kredi payı %20 altında kalmalı.

---

## 🟠 R16 — Kredi yeni oyuncuyu oyundan atar

**Belirti:** Lv2 oyuncu kredi çekip tesis kuruyor, ilk zararında taksiti kaçırıyor,
tesisi tasfiye ediliyor ve oyunu bırakıyor. Madde 40 bu riski açıkça uyarıyor:
*"yeni kullanıcıyı yanlışlıkla oyundan silebilecek agresif cezalar uygulama."*

**Azaltım:**
- **Kademeli temerrüt:** nakit yetmezse tesis anında kapatılmaz. `missed_payments` artar →
  bildirim → 3. kaçırılan taksitte tek tesis tasfiyesi → ancak tüm tesisler gidince `BANKRUPT`.
- Düşük seviyede düşük kaldıraç (0,40) — batacak kadar borçlanamaz.
- Kredi ekranında **taksit/tur gelir oranı** önden gösterilir ("bu kredi turluk gelirinizin
  %40'ını götürür").
- İlk kredi için onay adımı; onboarding görevi **değildir**.

**Test:** Sim'de "pasif oyuncu + kredi" profili; 90 günde iflas oranı %15'i aşmamalı.

---

## 🟠 R17 — İhracat ikinci bir para musluğu

**Belirti:** Oyuncular ürettikleri her şeyi ihraç ediyor, ekonomiye kontrolsüz ₺ giriyor,
yurt içi raflar boşalıyor.

**Kök neden:** İhracat, `SYS_FX` üzerinden ₺ yaratır. R10'un üçüncü biçimi.

**Azaltım — üçü birlikte:**
1. **Fiyatı oyuncu belirlemez:** `world_price_usd × 0.75`. Kaça satacağı kararı yok,
   *nereye* satacağı kararı var.
2. **Derinlik tavanı:** tur başına `Σ yurt içi talep × %15`, tüm oyuncular arasında pro-rata.
3. **Liman + transit + Lv7 kilidi:** dış ticaret sürtünmeli ve geç açılan bir kanal.

**Test:** Sim'de "tam ihracatçı" ajanı → dış ticaret kaynaklı para girişi toplam musluğun
%30'unu aşmamalı.

---

## 🟠 R18 — Dış ticaret bandı yurt içi fiyat keşfini boğar

**Belirti:** Bütün ürünlerin fiyatı dünya fiyatına çivilenmiş; oyuncular fiyat belirlemiyor,
sadece dünya fiyatını okuyor. Oyunun çekirdek mekaniği (oyuncu güdümlü fiyat oluşumu) ölür.

**Kök neden:** İthalat bir tavan, ihracat bir taban oluşturur. Band dar olursa yurt içi fiyat
bu iki çizgi arasına sıkışır ve arz-talep anlamını yitirir. **Bu, R10'un tam tersi yönde bir
tasarım hatasıdır:** R10 ekonomiyi şişirir, R18 ekonomiyi dondurur.

**Azaltım:**
1. **Band geniş tutulur:** ihracat ×0,75, ithalat ×1,35 → taban dünya fiyatının %25 altında,
   tavan %35 üstünde, toplam **~%60 genişlik**. Yurt içi fiyat bu aralıkta serbestçe oluşur;
   dış ticaret yalnızca uçlarda devreye girer.
2. Derinlik tavanı bandın anında dolmasını engeller.
3. Nihai perakende ürünleri **ithal edilemez** — perakende rekabeti tamamen yurt içidir.
4. Liman gerekliliği ve transit süresi ek sürtünme.

**Test:** Yurt içi fiyatın banda yapıştığı tur oranı **< %20** olmalı (F8 çıkış kriteri).
Bu eşik aşılırsa çarpanlar genişletilir.

---

## Risk özeti

| Kod | Risk | Şiddet | Ne zaman ele alınır |
|---|---|---|---|
| R10 | Sınırsız para basma (perakende) | 🔴 Kritik | **F2** (tasarımda) |
| R15 | Kredi anaparası para yaratır | 🔴 Kritik | **F5** |
| R7 | Veri hacmi | 🔴 Kritik | **F0** (partition şemada) |
| R2 | Fiyat salınımı | 🟠 Yüksek | F4 |
| R1 | Dağıtım döngüsü | 🟠 Yüksek | F2 |
| R4 | NPC bant yavaşlığı | 🟠 Yüksek | F6 |
| R5 | Yuvarlama sapması | 🟠 Yüksek | **F0** (ledger) |
| R6 | Deadlock | 🟠 Yüksek | **F0** (transfer) |
| R3 | Tick süresi | 🟡 Orta | F2, sürekli |
| R8 | Wash trading | 🟡 Orta | F4 |
| R9 | Ölüm sarmalı | 🟡 Orta | F7 |
| R11 | Soğuk başlangıç | 🟡 Orta | F6 |
| R12 | Config yarışı | 🟡 Orta | F2 |
| R13 | Reçete döngüsü | 🟢 Düşük | F3 |
| R14 | KVKK | 🟢 Düşük | F10 |
| R16 | Kredi yeni oyuncuyu atar | 🟠 Yüksek | F5 |
| R17 | İhracat musluğu | 🟠 Yüksek | F4 |
| R18 | Dış ticaret fiyat keşfini boğar | 🟠 Yüksek | F4 |
