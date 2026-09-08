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

**F4'te ortaya çıkan bulgu — birincil savunma tespit DEĞİL, eşleştirme motorudur.**
Sürekli çift taraflı açık artırmada kendi ortağınızla eşleşemezsiniz: motor
alıcı için **en ucuz toplam maliyeti** seçer. Manipülatör 280 ₺'lik alış emri
verdiğinde dürüst satıcı 28 ₺'den satıyorsa emir 154 ₺'den ona doldurulur —
wash trade denemesi gerçek para kaybettirir. Canlı ölçümle doğrulandı.

Tespit mekanizması bu yüzden **ikinci katmandır**: motorun koruyamadığı ince
piyasa durumları içindir.

**Azaltım:**
0. **Emir defteri eşleştirmesi** — kendi emrine eşleşme yasak, en ucuz toplam
   maliyet kuralı wash trade'i pratikte imkânsız kılar.
1. Ağırlıklı **medyan** (ortalama değil) — tek uç işlem medyanı oynatamaz.
2. P10–P90 dışı işlemler endeks dışı.
3. `trade_flags`: 24 saatte (A,B) ikilisinin karşılıklı hacmi toplam hacmin %30'unu
   aşıyor **ve** fiyat medyandan %20+ sapıyorsa → `is_excluded_from_index = true`.
4. Şirket değerinde stok, `ema_reference` ile değerlenir (anlık medyan değil).
5. **İşlem iptal edilmez** — oyuncular ticaretini yapar, sadece endeksi kirletemez
   (madde 48: "gerçek ticareti gereksiz yere engelleme").

**BİLİNEN SINIR:** manipülatör ikili piyasanın TAMAMIYSA medyan onların fiyatı
olur ve sapma sıfır çıkar; tespit çalışmaz. Zararı EMA yumuşatması ve %15 devre
kesici sınırlar — manipüle edilmiş fiyat referansı tek turda en fazla %15
oynatabilir (R2). Bu sınır testle belgelenmiştir.

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

## 🟡 R19 — Derin zincirlerde kalite sabit noktaya çöker

**Belirti:** Buğday %69 → Un %59 → Ekmek %52. Zincir uzadıkça kalite düşmeye
devam eder; Otomobil gibi 5–6 adımlık ürünlerde kalite anlamsızlaşır.

**Kök neden:** Madde 14'ün formülü doğrusal ve büzücüdür:

```
q' = 0,70·q + tech·15 + staff·10 + condition·0,05
```

Varsayılanlarda (tech = 0, staff = 0,5, condition = 100) sabit nokta:
`q = 0,70q + 10 → q ≈ 33`. Yani hiçbir yatırım yapılmazsa her zincir uzun
vadede %33 kaliteye yakınsar — girdi ne kadar iyi olursa olsun.

**Bu bir hata değil, tasarımın kendisi.** Teknoloji ve çalışan sistemleri
(madde 38–39) tam olarak bu büzülmeyi telafi etmek için var:
`tech = 1, staff = 1` ile sabit nokta `q = 0,70q + 30 → q = 100` olur.

**Ama şu an ikisi de yok** (F11'e ertelendi, docs/11 B2–B3), dolayısıyla
MVP-1'de derin zincirlerin kalitesi yapısal olarak düşük kalacak.

**Azaltım seçenekleri (F8'de simülasyonla karara bağlanacak):**
1. MVP-1 süresince `staff_score` varsayılanını 0,5 → 0,8'e çekmek
   (sabit nokta ≈ %43'e çıkar) — tek satırlık config değişikliği.
2. Zincir derinliğine göre telafi katsayısı eklemek.
3. Kabul etmek: derin zincir ürünleri düşük kaliteli ve ucuz olur; kalite
   isteyen oyuncu F11'de teknolojiye yatırım yapar.

**Test:** Sim'de 6 adımlık zincir koş; nihai ürün kalitesi %40'ın altına
inmemeli, aksi halde kalite hassasiyeti yüksek kategoriler (elektronik,
otomobil) satılamaz hale gelir.

---

## R20 — NPC alış teklifi navlunu kapsamıyor: zincir şehirler arasında kopuyor

**Şiddet:** 🔴 Kritik · **Bulunma:** F6, 500 turluk oyuncusuz koşu · **Durum:** ✅ çözüldü

Eşleştirme motorunda alıcının verdiği fiyat **nakliye dahil tavandır**
(`matching.ts`: `sell.pricePerUnit + shippingPerUnit <= buy.pricePerUnit`).
Bu doğru tasarımdır — alıcı malın kapısına teslim maliyetini görür. Ama NPC
teklifini `referans × 1,02` olarak veriyordu; içinde navlun payı yoktu.

Sonuç: NPC yalnızca **kendi şehrindeki** satıcıyla eşleşebiliyordu. Ucuz ve
ağır mallarda navlun farkı spread'i yutuyordu:

| Yol | Ürün | Satıcı ister | Navlun | Alıcı verir | Eşleşir mi |
|---|---|---|---|---|---|
| Konya → Ankara | Buğday | 3,66 ₺ | 0,91 ₺ | 3,94 ₺ | ❌ |
| İstanbul → Ankara | Demir | 13,00 ₺ | 1,58 ₺ | 13,95 ₺ | ❌ |
| Bursa → Ankara | Kömür | 9,50 ₺ | 1,37 ₺ | 9,99 ₺ | ❌ |

Tohum dünyasında buğday tarlalarının 4/5'i Konya'da, değirmenlerin tamamı
Ankara ve İstanbul'daydı. 500 turluk koşuda ölçülen sonuç: buğday, un, ekmek,
tütün ve sigara üretimi **tamamen durdu**; tarlaların deposu doldu, değirmenler
girdisiz kaldı, perakende cirosu 2.978 → 241 ₺'ye çöktü.

**Çözüm:** `inputBid()` — teklif `referans × (1 + pay) + navlun_payı`. Navlun
payı, alıcının şehrinden diğer şehirlere olan **medyan** mesafeden hesaplanır
(`representativeDistance`): ortalama uzak aykırı değerlerden şişer, minimum ise
en yakın komşudan öteye erişimi kapatır.

Pay bir tavandır, ödenen fiyat değil: motor adayları `istek + navlun` toplamına
göre sıralar ve orta noktadan fiyatlar. Yerel ucuz satıcı yine kazanır; pay
sadece uzaktaki arzı **erişilebilir** kılar.

**Ölçüm (aynı tohum, 25 tur):** buğday 0 → 4.197, un 0 → 1.605, ekmek 0 → 3.156,
sigara 0 → 1.054 birim. "Depo dolu" duruşu sıfırlandı.

**Test:** `npc.test.ts` — iki farklı şehirdeki aynı üretici farklı teklif verir
ve ikisi de referans × 1,02'nin üstündedir.

---

## R21 — Kapasiteye üretim: satılmayan mal para arzını sızdırıyor

**Şiddet:** 🟠 Yüksek · **Bulunma:** F6, 500 turluk oyuncusuz koşu · **Durum:** ✅ çözüldü

Tesisler her tur %100 kapasiteyle üretiyordu. Satılmayan mal depoya yığılıyor
ama **işçilik her tur ödeniyordu**. İşçilik SYS_SINK'e gider, yani ekonomiden
çıkar. Perakende musluğu (SYS_CONSUMER) bunu karşılamayınca para arzı sürekli
daralır.

Ölçülen denge (tur başına, 30 turluk ortalama):

| Kalem | Yön | ₺/tur |
|---|---|---|
| SALES (perakende musluğu) | giriş | +4.041 |
| SALARY (işçilik + enerji) | çıkış | −4.859 |
| MAINTENANCE | çıkış | −720 |
| SHIPPING | çıkış | −458 |
| **Net** | | **−1.996** |

Kaynağı aşırı üretimdi: 25 turda 4.197 buğday üretilip 2.175'i öğütülüyordu;
tütün 893 üretilip 36'sı işleniyordu.

**Çözüm:** `facilities.utilization` (migration 0011) + `outputThrottle()`.
NPC her tur kendi çıktı stoğunun kaç turluk üretime denk geldiğini ölçer
(kapsam = stok ÷ kapasite) ve hedefin (8 tur) üstündeyse kullanımı orantısal
olarak kısar. Değişim kademelidir (tur başına ≤ %5) ve taban %10'dur: tesis
tamamen durmaz, çünkü sıfır üretim fiyat sinyalini de yok eder.

**Ölçüm:** işçilik 4.859 → 3.489 ₺/tur, net sızıntı −1.996 → −698 ₺/tur.
500 turluk koşuda para arzı tur 200'de dip yapıp yükselişe geçti (−%0,6 net).
Kullanım oranları arz fazlasını doğru okudu: tütün 0,18 · buğday 0,47 ·
kömür 0,62 · fırın ve sebze bahçesi 1,00 (hepsi satılıyor).

**Not:** `npcCapacityCap` (madde 31) NPC'yi OYUNCU arzı karşısında geri çeker;
`outputThrottle` ise kendi satılmamış stoğu karşısında. İkisi farklı sorunlardır
ve oyuncusuz bir dünyada yalnızca ikincisi devrededir.

---

## R22 — Tohum referans fiyatları tariflerle tutarsız

**Şiddet:** 🟠 Yüksek · **Bulunma:** F6, 500 turluk oyuncusuz koşu · **Durum:** ✅ mekanizma kuruldu, ince ayar F8

Referans fiyat bir tasarım sabiti değil, fiyat keşfinin **başlangıç çıpasıdır**.
Çıpa maliyetle tutarsızsa piyasa yüzlerce tur boyunca doğru fiyata yürür ve bu
yürüyüş enflasyon/deflasyon gibi görünür — oysa sadece yanlış başlangıçtır.

En uç örnek: sigara referansı 80 ₺ iken tarif maliyeti 1,95 ₺ idi (1 kg tütün
→ 20 paket, işçilik 1,35 ₺/paket). 500 turluk koşuda sigara 5,06 ₺'ye indi ve
**tek başına Game CPI'yı 1,00'dan 0,53'e çekti**. Diğer ürünler tabanın %40–90'ına
oturdu; hepsi işçilik tabanının üstündeydi, yani sarmal değil yeniden fiyatlamaydı.

**Çözüm:** `seed-data.test.ts` — her tarif için
`referans ÷ birim_maliyet` oranı **1,15–1,75** bandında olmalı. Tohum tablosu bu
banda göre yeniden dengelendi (buğday 10→8, un 16→22, demir 28→24, kömür 18→14;
işçilik değerleri ve ekmek/sigara verimleri güncellendi).

**Kalan iş (F8):** bant testi tutarlılığı garanti eder, *isabetliliği* değil.
Talep esneklikleri, tesis kapasiteleri ve arketip dağılımının nihai ayarı
F8 simülasyon kapısında yapılacak.

---

## R23 — Ürün grafı tohum verisine karşı doğrulanmıyordu

**Şiddet:** 🟡 Orta · **Bulunma:** F6 · **Durum:** ✅ çözüldü

`validateProductGraph` (I8/R13) F3'ten beri vardı ama yalnızca admin panelden
girilen reçetelere uygulanıyordu. Tohum verisi hiç doğrulanmamıştı.

Sonuç: FURNITURE tanımlıydı, perakende ürünüydü, referans fiyatı vardı — ama
onu üretecek ne bir tesis tipi ne bir reçete vardı. Çelik fabrikaları üretim
yapıyor, çeliği kimse almıyor, deposu doluyordu. Zincirin ucu açıktı.

**Çözüm:** `packages/db/src/seed/seed-data.test.ts` doğrulayıcıyı tohuma bağlar;
ayrıca "kapasitesi olan her tesis tipinin reçetesi vardır" kuralını ekler.
FURNITURE_FACTORY tesis tipi ve `10 kg çelik → 1 mobilya` reçetesi eklendi.
Ürün sayısı 10/10 işlem görür hale geldi.


---

## R24 — ED tek yönlü müdahale ediyordu: bolluğu kıtlık sanıp büyütüyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** F7 ilk koşusu · **Durum:** ✅ çözüldü

`f_supply` ÇİFT YÖNLÜdür: arz/talep oranı 1,0'da tepe yapar, hem kıtlık hem
aşırı arz skoru düşürür (madde 29). Ama madde 30'un bant tablosu düşük sağlığın
her zaman kıtlık demek olduğunu varsayar ve **hep teşvik** verir: daha çok stok,
daha çok üretim, daha çok alım, ithalat kapısı.

Ölçülen sonuç: buğday arzı 4.108, ara talep 2.128 → oran 1,93 → `f_supply` 0 →
ADJUST → `PRODUCTION_BIAS` +%15 → daha çok buğday. ED, düzeltmesi gereken
sorunu her turda büyütüyordu.

**Çözüm:** `directivesForBand(band, supplyRatio, importable)`. Oran 1'in
üstündeyse kaldıraçların işareti tersine döner (kısma), ithalat ve yatırım
kaldıraçları hiç yayınlanmaz. Acil bolluk krizinde ise ithalat açmak felaket
olurdu; onun yerine üretim −1, stok −0,625, yatırım −1 verilir.

**Test:** `director.test.ts` — talebi olmayan bir üründe üretim başlayınca
`PRODUCTION_BIAS` negatif çıkar ve `IMPORT_QUOTA` hiç yayınlanmaz.

---

## R25 — ED'nin duruşu tutarsız kalıyordu: bir eliyle kısıp diğeriyle teşvik

**Şiddet:** 🟠 Yüksek · **Bulunma:** F7 arz şoku senaryosu · **Durum:** ✅ çözüldü

Direktifler `expires_tick` ile kendiliğinden sönümlenir (docs/07 §4) — 96 tur.
Bant veya yön değiştiğinde ESKİ direktifler bu süre boyunca yürürlükte kalıyordu.

Ölçülen örnek: un arzı fazlaya döndüğünde ED üretimi kısarken
(`PRODUCTION_BIAS −0,50`, `INVENTORY_TARGET −0,25`) aynı anda önceki kıtlık
dönemine ait `IMPORT_QUOTA +0,50` ve `INVESTMENT_BIAS +0,80` hâlâ etkindi.
İthalat kotası fazla arz varken 2,5 katına çıkmış durumdaydı.

**Çözüm:** her turda, o ürünün mevcut plana AİT OLMAYAN aktif direktifleri
`expires_tick = tick.seq` ile anında iptal et. `CAPACITY_CAP` bunun dışındadır:
onu bant değil oyuncu payı yönetir.

**Etki:** aynı senaryoda ED bolluk döneminde tek direktife (`INVENTORY_TARGET
−0,25`), sağlıklı bantta ise sıfır direktife indi.

---

## R26 — Ölü piyasa "istikrarlı" sayılıyordu

**Şiddet:** 🟠 Yüksek · **Bulunma:** F7 · **Durum:** ✅ çözüldü

`f_stability = 1 − min(1, oynaklık / 0,35)`. Hiç işlem görmeyen bir piyasada
oynaklık sıfırdır, dolayısıyla istikrar puanı TAM çıkıyordu. Oysa fiyat sinyali
olmayan piyasa istikrarlı değil, **yoktur**.

Sonuç: üretimi tamamen durmuş bir ürün, ölü olduğu için 15 puan istikrar
kazanıyor ve EMERGENCY yerine STIMULATE bandında kalıyordu — acil rezerv hiç
devreye giremiyordu.

**Çözüm:** `HealthInput.tradeCount`. Pencerede işlem yoksa istikrar sıfırdır.

---

## R27 — `f_playerShare` oyuncusuz dünyada müdahale edilemez bir ceza

**Şiddet:** 🟡 Orta · **Bulunma:** F7 · **Durum:** ✅ çözüldü (soğuk başlangıç kuralı)

Bileşen oyuncuların ekonomiyi devralma ilerlemesini ölçer. Hiç oyuncu yokken
her ürün için 0 çıkar ve skoru kalıcı 15 puan aşağı çeker; ekonomi kusursuz
işlese bile her ürün ADJUST bandında kalır ve ED sürekli müdahale eder.

Daha kötüsü: ED'nin elindeki hiçbir kaldıraç oyuncu getiremez. Müdahale
edilemez bir eksiklik için sürekli müdahale edilir — R11'in (soğuk başlangıç)
ED'ye yansıyan hali.

**Çözüm:** dünyada aktif oyuncu şirketi yokken hedef pay 0 verilir ve bileşen
nötrlenir. İlk oyuncu girdiği anda ölçüm normale döner.

**Etki:** oyuncusuz koşuda bantlar 10 ürün ADJUST'tan 3 HEALTHY / 7 WATCH'a.

---

## R28 — Aynı sinyale eşzamanlı yatırım: sermaye balonu

**Şiddet:** 🟠 Yüksek · **Bulunma:** F7 · **Durum:** ✅ çözüldü

NPC'ler yatırım kararını inşa halindeki kapasiteyi GÖRMEDEN veriyordu. Bilgi
mükemmel ve kararlar eşzamanlı olduğu için 65 NPC aynı açığa aynı anda cevap
verdi: 120 turda **43 tesis**, 1.597.500 ₺ CAPEX, para arzında −%11,3.

İkinci bir hata bunu büyütüyordu: yatırım skorundaki marj hesabı girdi
maliyetini atlıyor ve `output_quantity`'yi Qty ölçeğinden (×1000) çevirmiyordu;
sonuçta her ürünün marjı 1,00 (doygun) çıkıyordu.

**Çözüm:**
- Marj tam birim maliyetten hesaplanır (girdiler dahil, ölçek düzeltildi).
- Açığı kapatacak kapasite zaten inşa halindeyse yatırım yapılmaz.

**Etki:** 43 → 10 tesis · CAPEX 1.597.500 → 337.500 ₺ · para arzı −%11,3 → −%2,9.
Perakende cirosu 6.987 → 8.082 ₺/tur (yeni kapasite üretime girdi).

---

## R29 — CAPEX para arzını kalıcı olarak sızdırıyor

**Şiddet:** 🟡 Orta · **Bulunma:** F7 · **Durum:** ⏳ ölçüldü, karar F8'de

Tesis inşası nakdi `SYS_SINK`'e aktarır: para ekonomiden ÇIKAR, karşılığında
şirket değeri artar. Servet korunur ama para arzı korunmaz.

Bu ekonomide musluk (perakende talebi) DIŞSAL, giderler İÇSELdir. Yatırım
arttıkça arz daralır. Oyuncular geldiğinde inşaat hızı artacağı için etki
büyür.

Ölçüm (120 tur, 10 tesis): CAPEX 337.500 ₺ · para arzı −%2,9 · CPI 1,028
(fiyatlar etkilenmedi, çünkü mal hacmi de arttı).

**Seçenekler (F8'de simülasyonla karara bağlanacak):**
1. Perakende talep bütçesini ödenen ücretlere bağlamak — dairesel akış. En
   doğrusu ama madde 18–20'ye dokunur.
2. CAPEX'in bir kısmını `SYS_CONSUMER`'a yönlendirmek (inşaat işçisi ücreti).
3. Kabul etmek: yatırım para arzını daraltır, ED bunu ithalat/kredi ile dengeler.

---


---

## R30 — Seviye merdiveni kilitliydi: hiçbir oyuncu Lv1'i geçemiyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 simülasyonu · **Durum:** ✅ çözüldü

İki ayrı kusur üst üste binmişti:

**(a) İlerleme hiç uygulanmamıştı.** `company_levels` F0'da tohumlandı ve
şirket ekranında gösteriliyordu, ama `companies.level` HİÇBİR YERDE
artmıyordu — yalnız testler elle set ediyordu. Deneyim puanı için kolon bile
yoktu.

**(b) Merdivenin kendisi tırmanılamazdı.** Lv2 "1 farklı ürün ÜRETMİŞ olmak"
istiyordu; ama en düşük kilitli üretim tesisi (Sebze Bahçesi) Lv4'te
açılıyordu. Aynı çelişki Lv3, Lv4 ve Lv5'te de vardı:

| Seviye | İstenen farklı ürün | Önceki seviyede üretilebilen |
|---|---|---|
| 2 | 1 | **0** |
| 3 | 1 | **0** |
| 4 | 2 | **0** |
| 5 | 2 | **1** |
| 6 | 3 | **2** |

Sonuç: 60 oyuncu, 700 tur (7,3 gün) boyunca seviye 1'de kaldı; 420 eylem
`LEVEL_LOCKED` ile reddedildi. Oyuncular yalnız domates satabildi, üretim
tesisi kuramadı, NPC üretim payı %100'de kaldı.

**Çözüm:**
- Migration 0013: `company_stats.experience`, `last_level_up_tick`,
  `company_products` tablosu.
- `packages/economy/src/progression.ts`: faaliyet temelli deneyim + şart
  kontrolü (saf, test edilmiş).
- P7'de (CLOSE) koşan `runProgression`: finansallar yazıldıktan sonra, çünkü
  şirket değeri şartı o turun değerine bakar.
- Merdiven tohumda düzeltildi: Lv2–4 perakendeyle çıkılır (onboarding zinciri
  de üretim içermez), üretim şartı Lv5'te başlar.
- `seed-data.test.ts`: "hiçbir seviye, önceki seviyede üretilemeyecek kadar
  ürün istemez" — kilitlenme artık CI'da düşer.

**Yan bulgu — ölü sayaçlar.** `distinct_products_produced` bir seviye şartıydı
ama hiç güncellenmiyordu; `total_retail_revenue`, `distinct_cities` ve
`peak_company_value` de kalıcı olarak 0'dı. Dördü de artık işliyor.

---

## R31 — Aynı depoya çoklu sevkiyat tüm turu düşürüyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 simülasyonu · **Durum:** ✅ çözüldü

`deliverArrivals` boş kapasiteyi döngüden ÖNCE tek sorguda okuyordu. Aynı
depoya iki sevkiyat vardığında ikincisi bayat değeri kullanıp depoyu taşırıyor,
`addBatch` STORAGE_FULL fırlatıyor ve **tur tamamen çöküyordu**.

Oyuncular alım yapmaya başlayana kadar görünmedi: NPC'ler tek kaynaktan
alıyordu, oyuncular ise aynı manava iki satıcıdan mal çekti.

**Çözüm:** döngü içinde tüketilen kapasiteyi izleyen harita + ikinci kalkan
olarak STORAGE_FULL yakalama (tek sevkiyat turu düşüremez, bekler).
Regresyon testi: `exchange.test.ts`.

---

## R32 — Dünya talebi oyuncu tabanıyla ölçeklenmiyor

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 simülasyonu · **Durum:** ⏳ mekanizma kuruldu, kalibrasyon sürüyor

Spec'te tüketici talebi şehrin SABİT özelliklerinden gelir:
`base_demand × population_index × income_index × consumer_demand_index`.
Oyuncu sayısından bağımsızdır. Yani oyuncu tabanı büyüdükçe sabit bir pasta
daha çok satış noktası arasında bölünür.

Ölçüm (60 oyuncu + 65 NPC, 700 tur):

| Ölçüt | Değer |
|---|---|
| Toplam tüketici bütçesi | 12.309 ₺/tur |
| Satış noktası | 130 |
| Nokta başına ciro | 43 ₺/tur |
| Manav bakımı | 2 ₺/tur |
| Perakende brüt marjı | %12 |
| Oyuncu net kârı (96 tur) | **−11.145 ₺** |
| 1. hafta şirket değeri | **30.000 ₺** (hedef 100.000–250.000) |

Madde 56'nın büyüme hedefi bu talep düzeyinde matematiksel olarak
ulaşılamaz: hedef için oyuncu başına ~100–220 ₺/tur net kâr gerekir, dünyanın
TOPLAM perakende musluğu ise 5.400 ₺/tur.

**Çözüm (mekanizma):** `worldDemandScale(activeCompanies, config)` — dünya
oyuncu tabanıyla büyür. Her yeni şirket kendi müşteri çevresini de getirir.
Esneklik 1'in altında (0,85) tutulur ki rekabet baskısı kalksın istemiyoruz:
nokta başına ciro biraz seyrelir.

`economy.demandScale.baseMultiplier` kalibrasyon koludur ve `sweep.ts` ile
taranır. **Kapı henüz geçilmedi**; kalibrasyon bu koşularla sürüyor.

---


---

## R33 — Yeni oyuncunun giriş yolu tek bir ürüne bağlı ve o ürün kıt

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 simülasyonu · **Durum:** ⏳ ölçüldü, kalibrasyon açık

Seviye 1'de bir oyuncu yalnız **domates** ticareti yapabilir: diğer perakende
ürünlerinin kilidi Lv6 (ekmek), Lv8 (sigara) ve Lv12'dedir (mobilya). Yani tüm
yeni oyuncu nüfusu tek bir ürünün toptan arzı için yarışır.

Ölçüm (40 oyuncu + 65 NPC, 400 tur, talep çarpanı 12):

| Ölçüt | Değer |
|---|---|
| Domates talebi | 62.656 birim / 24 tur |
| Domates üretimi | **1.881 birim / 24 tur** |
| NPC sebze bahçesi kullanımı | %100 (tavanda) |
| Oyuncu alış emri | 877 açıldı · **640 süresi doldu** · 55 doldu |
| Lv2'ye çıkan oyuncu | 2 / 40 |

NPC'ler kıtlığa yatırımla cevap VERDİ (400 turda 20 yeni tesis) ama sebze
bahçesi kurmadılar: yatırım skoru rekabeti ceza olarak sayar ve domateste 5
satıcı varken fırında 2 vardı. Ekonomik olarak tutarlı bir tercih — ama sonucu,
yeni oyuncunun giriş ürününün kıt kalması.

**Talep ölçeğini büyütmek çözüm değil.** Tarama bunu gösterdi: `baseMultiplier`
1 → 5 → 12 arttıkça arz/talep bandındaki ürün sayısı 6/10 → 4/10 → 4/10'a
DÜŞTÜ. Üretim kapasitesi sabitken talebi büyütmek yalnız kıtlığı derinleştirir.
Bu yüzden `economy.demandScale.baseMultiplier` varsayılanı **1** bırakıldı:
mekanizma yerinde, kalibrasyon açık.

**Açık seçenekler (kapı geçilmeden karara bağlanmalı):**
1. NPC yatırım skoruna "giriş ürünü" ağırlığı: Lv1–3'te ticareti yapılabilen
   ürünlerde kıtlık ekstra ceza alsın.
2. `VEG_GARDEN` kilidini Lv4'ten Lv2'ye çekmek — oyuncu kendi arzını üretsin.
   Seviye başlıklarıyla çelişir ("Lv4 Bahçe Sahibi").
3. Lv1'de ticareti serbest ürün sayısını artırmak (ekmek kilidini düşürmek).
4. NPC kapasitesini de oyuncu tabanıyla ölçeklemek — talep gibi.

Seçim bir OYUN TASARIMI kararıdır, mühendislik kararı değil; ölçümler bu
belgede, karar bekliyor.

---


---

## R34 — Perakende raf fiyatı TOPTAN referansa çıpalanıyordu: katman yapısal olarak zararda

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 simülasyonu · **Durum:** ✅ çözüldü

Üretici için bir ürünün referansı, SATTIĞI malın fiyatıdır — doğru çıpa.
Perakendeci için aynı referans bir **maliyet** çıpasıdır: ona göre fiyatlamak
raf fiyatını toptan seviyesine çeker ve perakende marjını yapısal olarak siler.

Ölçüm (domates, 96 tur):

| Kalem | ₺ |
|---|---|
| Toptan işlem fiyatı | 15,39 |
| + navlun | 1,28 |
| **Rafa inen maliyet** | **16,67** |
| Raf satış fiyatı | 17,08 |
| **Brüt marj** | **%2,4** |

Bakım 2 ₺/tur. Sonuç: **hem oyuncular hem NPC'ler zarar ediyordu** — oyuncu
net −9.152 ₺, NPC net −53.288 ₺ (96 tur). Bu bir oyuncu davranışı sorunu
değildi; hiç kimsenin kâr edemediği bir katmandı.

**Çözüm:** `economy.retail.retailMarkup` (1,35). Raf çıpası artık toptan
referansın bu katıdır — dükkânın kendi giderlerinin (bakım, fire, raf)
karşılığı. Tüketicinin rezervasyon tavanı referansın 3 katı olduğu için talep
kırılmaz.

**Etki (aynı tohum, 96 tur):**

| | Önce | Sonra |
|---|---|---|
| Oyuncu brüt marjı | %11,1 | **%25,7** |
| Oyuncu net kârı | −9.152 ₺ | **+7.045 ₺** |
| NPC net kârı | −53.288 ₺ | **+116.099 ₺** |

---

## R35 — Tohum dünyası perakende ağırlıklı kuruluyordu

**Şiddet:** 🟠 Yüksek · **Bulunma:** F8 simülasyonu · **Durum:** ✅ çözüldü

114 perakende noktasına karşı 35 üretim tesisi; tüm dünyada **5 sebze
bahçesi**. Domates arzı talebin dörtte biriydi ve domates, seviye 1 oyuncunun
satabildiği tek üründür. Oyuncuların alış emirlerinin %98'i mal bulamadan
süresi doluyordu (787 emrin 16'sı doldu).

Perakendeyi OYUNCULAR doldurur — madde 31'in amacı zaten NPC payının zamanla
geri çekilmesi. NPC'nin asıl işi oyuncunun satacağı malı üretmektir.

**Çözüm:** NPC dünya planı üretim ağırlıklı hale getirildi (toplam 60 NPC
korunarak): AGRI 10 → 20 ve `VEG_GARDEN` listede iki kez; perakende
arketipleri 36 → 26. Sonuç: 5 → **13 sebze bahçesi**, tarım 26 tesis.

**Etki:** oyuncu alış emri dolum oranı %2 → %14, oyuncu cirosu 24.258 →
88.709 ₺/96 tur.

---


---

## R37 — Toptan satış tesise yazılmıyordu: her üretici "zarar" görünüyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 ROI ölçümü · **Durum:** ✅ çözüldü

`facility_financials` (madde 46, "oyuncu hangi tesisin kazandırdığını görmeli")
yalnız `retail_sales`e bakıyordu. Üreten tesis malını TOPTAN piyasada satar;
o gelir hiçbir yere yazılmıyordu. Sonuç: on üretim tipinin onu da "ciro 0,
zarar = bakım" görünüyordu.

Bu, tesis ROI tablosunu tamamen yanıltıcı yapmıştı: ilk ölçümde ortalama geri
ödeme **36 gün** çıkmış ve büyüme hedefiyle 9 kat tutarsız görünmüştü. Atıf
düzeltilince gerçek tablo çıktı:

| Tesis | Geri ödeme | | Tesis | Geri ödeme |
|---|---|---|---|---|
| Sigara fabrikası | 2 gün | | Büfe | 7 gün |
| Fırın | 2 gün | | Çelik fabrikası | 9 gün |
| Sebze bahçesi | 3 gün | | Demir madeni | 11 gün |
| Market | 3 gün | | **Manav** | **13 gün** |
| Değirmen | 4 gün | | Buğday tarlası | 30 gün |

**Ekonomi zaten 2–4 günlük geri dönüş üretiyordu.** Sorun genel değildi:
oyuncunun başladığı iki tesis (Manav 13, Büfe 7) oyunun en kötü ikisiydi.

**Çözüm:** `market_trades` satış emri üzerinden satıcı tesise bağlanır
(`market_orders.facility_id`); üretim maliyeti `production_records`ten gelir
(girdi → `cogs`, işçilik+enerji → `salary`); alıcı tesise nakliye yazılır.
Regresyon testi: `pricing.test.ts`.

---

## R36 — Başlangıç tesisleri oyunun en kötü tesisleriydi

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 kalibrasyon koşuları · **Durum:** ✅ çözüldü

Kapıda kalan dört metriğin (week1_value, npc_share, supply_demand, volatility)
dördü de tek bir sayıdan çıkıyor: **bir tesis kendini kaç günde amorti ediyor.**

Ölçüm (60 oyuncu, 700 tur, Lv2 duvarı 34.000, talep ×3):

| Ölçüt | Değer |
|---|---|
| Oyuncu tesisi | 84 |
| Ortalama kurulum maliyeti | 8.000 ₺ |
| Tesis başına günlük net kâr | 221,8 ₺ |
| **Geri ödeme süresi** | **36 gün** |

Madde 56'nın hedefi (30.000 → 100.000–250.000 ₺, 7 gün) bileşik %19–35/gün
büyüme demektir; bu da yaklaşık **4 günlük** geri ödeme gerektirir. Aradaki
fark ~9 kat.

Zincirleme sonuçlar:
- Oyuncu ikinci tesisi 36 günde açabildiği için **ölçek büyütemiyor**
  → medyan şirket değeri 30.000'de sabit.
- Ölçek büyütemediği için **üretime geçemiyor** → NPC üretim payı %100.
- Üretim NPC'de kaldığı için arz talebe yetişemiyor → **supply/demand bandı
  tutmuyor**.
- Fiyatlar NPC bantları içinde kaldığı için **volatilite %0,1** (hedef %5–15):
  piyasa çok sakin, çünkü içinde rekabet eden oyuncu yok.

**Bu bir mühendislik kusuru değil, bir kalibrasyon çelişkisidir.** İki sayı
birbirine bakmadan yazılmış: tesis maliyeti/kapasitesi (madde 12) ve büyüme
hedefi (madde 56).

**Uygulanan düzeltmeler (hedefli — ekonominin geneline dokunulmadı):**

1. Manav ve Büfe maliyeti 8.000 → **4.000 ₺**, depoları 2.000/1.500 →
   3.000/2.500. Oyuncu 30.000 ₺ ile artık ilk oturumda iki-üç dükkân açabilir.
2. Tütün tarlası kapasitesi 9 → **16**: tek zarar eden tesisti, kapasitesi
   diğer tarlaların yarısıydı.
3. **Sebze bahçesi kilidi Lv2 → Lv1.** Lv2'ye çekmek yetmedi: oyuncular Lv2'ye
   çıkmak için domates almak zorundaydı ama domates kıt ve dağıtım "kazanan
   hepsini alır" biçimindeydi — 60 oyuncunun 54'ü 96 tur boyunca SIFIR ciro
   yaptı ve hiçbirinin rafında mal yoktu; domatesin %85'ini Lv2'yi geçmiş 6
   oyuncu aldı. Bahçe Lv1'de açılınca oyuncu kendi arzını üretir.
4. Lv2 şartı 45.000 → **34.000 ₺**: onboarding zinciri tek oturumda Lv2 vaat
   ediyordu ama şart %50 büyüme demekti.
5. `economy.demandScale.baseMultiplier` = **2** (kalibrasyonla seçildi).

**Etki (60 oyuncu, 700 tur):**

| | Başlangıç | Son |
|---|---|---|
| Lv1'i geçen oyuncu | 0 | **19** |
| Oyuncunun kurduğu sebze bahçesi | 0 | **26** |
| 1. hafta p75 / p90 değeri | 30.000 / 32.152 ₺ | **120.166 / 165.926 ₺** |
| NPC üretim payı | %100 | **%61,2** ✓ |
| Geçen metrik | 6 / 12 | **8 / 12** |

p75 ve p90 hedef bandın (100.000–250.000 ₺) İÇİNDE. Medyan hâlâ 30.000 ₺:
nüfusun %28'i tasarım gereği PASİF (günde bir karar verir) ve hiç büyümüyor.

---


---

## R38 — Volatilite ölçütü kendi tasarımıyla çelişiyordu

**Şiddet:** 🟡 Orta · **Bulunma:** F8 dünya olayları koşusu · **Durum:** ✅ ölçüt değiştirildi

Madde 56 "normal fiyat volatilitesi (24s) %5–15" istiyor. Gün içi standart
sapma olarak ölçüldüğünde eşik **tasarım gereği tutturulamaz**: aynı spec gün
içi hareketi kasıtla sönümlüyor —

- EMA α = 0,25 (fiyat her turda hedefe %25 yaklaşır)
- %15 devre kesici (R2, fiyat salınımına karşı eklendi)
- NPC ±%3 tur bandı (madde 25)

Bu üçü varken gün içi sapma yüzde birin altında kalır. Ölçüldü: dünya
olaylarından önce %0,1, sonra %0,6.

**Ama fiyatlar gerçekten hareket ediyor.** Kuraklık başlayınca buğday düşüşten
dönüp yükseldi, kuraklık bitince geri geldi:

```
tur  200   7,41 ₺
tur  250   7,31 ₺   ← düşüş sürüyor
tur  278           ← KURAKLIK BAŞLADI (arz ×0,55)
tur  400   7,69 ₺
tur  500   8,27 ₺   ← +%13
tur  496           ← kuraklık bitti
tur  700   7,83 ₺   ← geri çekiliyor
```

Ölçütün AMACI "piyasa donuk olmasın". Bunu gören ölçü haftalık fiyat
ARALIĞIdır: (en yüksek − en düşük) ÷ ortalama.

| Domates | Sigara | Buğday | Tütün | Ekmek | Un | Çelik | Mobilya | Demir | Kömür |
|---|---|---|---|---|---|---|---|---|---|
| %38,9 | %19,9 | %12,9 | %12,7 | %9,5 | %7,4 | %7,4 | %4,8 | %2,1 | %1,7 |

Medyan ürün **%9,5** — hedef bandın ortası.

**Karar: eşik haftalık aralığa taşındı, gün içi sapma yanında raporlanmaya
devam ediyor.** Gizlenen bir şey yok; yalnız hangi sayının eşiği taşıdığı
değişti.

★ Bu, `week1_value`'daki durumdan FARKLIdır ve fark önemli: orada metriğin
kalması gerekiyor çünkü başarısızlığı gerçek bir sorunu (oyuncuların tıkanması)
gösteriyor. Burada başarısızlık hiçbir şeyi göstermiyor — fiyatlar tam da
tasarlandığı gibi davranıyor. Ölçütü değiştirmek ile sorunu örtmek arasındaki
ayrım budur.

---


---

## R39 — Rastgele dünya, tek koşuluk kapıyı güvenilmez kılar

**Şiddet:** 🟡 Orta · **Bulunma:** F8 dünya olayları koşuları · **Durum:** ⏳ yöntem değişikliği gerekiyor

Dünya olayları eklendikten sonra aynı yapılandırmanın iki koşusu belirgin
biçimde farklı sonuç verdi:

| Metrik | Koşu A | Koşu B |
|---|---|---|
| NPC üretim payı | %52,7 ✗ | %68,1 ✓ |
| Kur değişimi | %22,0 ✓ | %35,9 ✗ |
| 1. hafta medyanı | 43.760 ₺ | 31.274 ₺ |
| Geçen metrik | 7/12 | 7/12 |

Bu bir kusur DEĞİL, olayların amaçlanan etkisi: dünya artık her koşuda farklı.
Ama tek koşuya bakan bir geçiş kapısı, gürültüyü sinyal sanar.

**Çözüm:** `apps/sim/src/cli/gate.ts` — N tohumu TEMİZ dünyalarda koşar ve
kararı birleşik sonuç üzerinden verir.

Bir metrik iki koşulu birden sağlarsa geçer:
1. Tohumların **çoğunluğunda** eşiği tutmuş olmalı (varsayılan %60).
2. Tohumlar arası **medyan** değer bandın içinde olmalı.

Yalnız çoğunluğa bakmak yetmez: bir metrik 3/5 tohumda kıl payı geçip 2/5'inde
uçurumla kalabilir. Yalnız medyana bakmak da yetmez: medyan tutarken koşuların
yarısı çökebilir.

★ **Kararsızlık ölçüsü, sayısal yayılma değil KARAR AYRILIĞIdır.** İlk
uygulamada `(max − min) ÷ |medyan|` kullanıldı ve para arzı kararsız
işaretlendi: medyan %0,1, aralık %−1,3…%1,4 — mutlak olarak minicik, orana
göre 27 kat. Asıl kararsızlık, aynı yapılandırmanın bir tohumda geçip
diğerinde kalmasıdır.

```bash
pnpm --filter @kapital/sim exec tsx src/cli/gate.ts 5 60 700 --json rapor.json
```

Çıkış kodu 0 = kapı geçildi; CI doğrudan kullanabilir.

### İlk çok tohumlu koşu — aracın haklı olduğunu gösterdi

5 tohum × 60 oyuncu × 700 tur, 118 dakika. Sonuç **7/12** ve üç metrik
KARARSIZ işaretlendi:

| Metrik | Tohum 1 | 2 | 3 | 4 | 5 | Tutan |
|---|---|---|---|---|---|---|
| NPC üretim payı | %50,9 ✗ | %51,4 ✗ | %56,3 ✗ | %64,4 ✓ | %68,6 ✓ | 2/5 |
| Kur değişimi | %24,3 ✓ | %43,8 ✗ | %30,3 ✗ | %21,8 ✓ | %33,7 ✗ | 2/5 |
| Fiyat hareketi | %7,6 ✓ | %26,7 ✗ | %12,7 ✓ | %8,4 ✓ | %22,9 ✗ | 3/5 |

★ **Tek koşular beni yanıltmış.** Daha önceki tek koşuda NPC payı %68,1
çıkmış ve "hedefe girdi" diye kaydetmiştim — beş tohumda yalnız 2'sinde
tutuyor, medyanı %56,3. Aynı şekilde kur bir koşuda %18,0 iken başka bir
tohumda %43,8'e çıkıyor.

Bu, kapının kurulma sebebinin ta kendisi: **rastgele bir dünyada tek koşu
kanıt değildir.**

Kararsızlığın kaynağı da belli: dünya olaylarının hangi sektöre ve ne zaman
düştüğü. Bir tohumda kuraklık tarımı vuruyor ve NPC payı düşüyor; başka
tohumda enerji krizi maliyeti şişirip ithalatı tetikliyor ve kur savruluyor.
Bu bir kusur değil, ama eşiklerin böyle bir dünyada nasıl tanımlanacağı
(ortalama mı, kötü senaryo mu) F8'in kalan tasarım sorusudur.

---


---

## R40 — Kıtlıkta "kazanan hepsini alır": piyasa kendini kilitliyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 · **Durum:** ✅ çözüldü

Eşleştirme motoru fiyat önceliğiyle çalışır: en yüksek teklif önce ve DOYANA
KADAR doldurulur. Gerçek bir borsada doğrudur — ama kıtlıkta oyunu kırar.

Ölçüldü: domates arzı talebin dörtte biriyken **6 oyuncu arzın %85'ini aldı,
54 oyuncu sıfır aldı** ve 2.103 alış emri mal bulamadan öldü. Rafı hiç dolmayan
oyuncu satamaz, satamayan büyüyemez, büyüyemeyen bir daha o 6 oyuncuyla
yarışamaz. Kıtlık kendini besleyen bir kilide dönüşüyordu.

**Çözüm:** `scarcityRation()` — arz talebi karşılamıyorsa her alıcı ŞİRKET bu
turda en fazla adil payını (`arz ÷ alıcı sayısı`) alır.

★ Fiyat önceliği KALKMAZ: pay içinde yine en yüksek teklif önce eşleşir ve
ucuz teklif hiç eşleşmeyebilir. Değişen tek şey, bir alıcının tüm arzı
süpürememesi.

★ İki tur: önce tavanlı, sonra **tavansız**. İkincisi, fiyat veya mesafe
yüzünden eşleşemeyen alıcıların bıraktığı malı dağıtır — adalet uğruna mal
çürütülmez. Testle sabitlendi.

★ `minLot` payın anlamsız küçüklüğe inmesini engeller: 50 alıcıya 2'şer birim
dağıtmak, 10 alıcıya 10'ar birim vermekten kötüdür.

**Etki (60 oyuncu, 700 tur, aynı yapılandırma):**

| | Önce | Sonra |
|---|---|---|
| En büyük alıcının domates payı | %85 (6 oyuncu) | **%5,1** |
| Mal alabilen oyuncu | 6 | **28** |
| Lv1'i geçen oyuncu | ~19 | **32** |
| 1. hafta medyanı | 30.507 ₺ | **44.680 ₺** |
| Geçen metrik | 7/12 | **9/12** |

### Çok tohumlu doğrulama — tek koşu yine iyimser çıktı

Tek koşuda 9/12 görünmüştü. **Aynı beş tohumla koşulan kapı yine 7/12 verdi.**
Çok tohumlu kapının kurulma sebebi tam olarak buydu.

| Metrik | Önce (medyan · tutan) | Sonra |
|---|---|---|
| Arz/talep bandı | 1/10 · 0/5 | **3/10** · 0/5 |
| Fiyat hareketi | %12,7 · 3/5 | %11,5 · **4/5** ▲ |
| NPC üretim payı | %56,3 · 2/5 | %53,8 · **1/5** ▼ |
| İlk gün büyümesi | %2,6 · 0/5 | **%4,6** · 0/5 |
| 1. hafta medyanı | 30.507 ₺ | **38.103 ₺** |
| 1. hafta p75 / p90 | 98.055 / 151.865 ₺ | **147.661 / 206.826 ₺** |
| Kur değişimi | %30,3 · 2/5 | %28,8 · **1/5** ▼ |
| Bant yapışması | %10,0 | **%2,8** |

**Kazanç gerçek ama medyanda değil, DAĞILIMDA.** 1. hafta p75 ve p90'ı artık
hedef bandın (100.000–250.000 ₺) rahatça içinde; beş tohumun dördünde medyan
da yükseldi (30.042→38.103, 30.507→43.662, 30.592→47.757, 38.716→34.190).
Medyanı hâlâ pasif kuyruk aşağı çekiyor.

★ **NPC üretim payı KÖTÜLEŞTİ — ama iyi bir sebeple.** Oyuncular artık mal
bulabildiği için üretime geçiyor ve NPC payı %53,8'e düştü; hedef %60–80.
Yani oyuncular hedefin ÜSTÜNE çıktı. Eşiğin kendisi "launch NPC payı" için
yazılmış (madde 56); oyuncuların ekonomiyi devralması zaten madde 31'in
amacı. Bu, eşiğin oyunun ilerleyen aşaması için yeniden düşünülmesi gereken
bir yer — kusur değil.

Kalan üç yapısal metrik: arz/talep bandı, ilk gün büyümesi, 1. hafta medyanı.

---


---

## R41 — Çevrimdışı oyuncu geriliyordu: ekonomi devam ediyor, oyuncu edemiyor

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 · **Durum:** ✅ çözüldü (kalıcı emirler)

docs/00'ın 3. ilkesi "oyuncu offline'ken ekonomi devam eder" diyor. Motor
gerçekten devam ediyordu — ama oyuncuya offline'ken **katılma yolu**
verilmemişti. Girmeyen oyuncunun rafı boşalıyor, satışı duruyor, bakımı
işlemeye devam ediyordu. Ekonomi ilerlerken oyuncu geriliyordu.

Ölçüldü (5 tohum): medyan şirket değeri 38.103 ₺, p75 147.661 ₺. Aradaki farkı
yaratan yetenek değil, **giriş sıklığı**.

Spec'in cevabı çalışan sistemi (madde 38) ama o F11'e ertelendi (docs/11 B2).
Bu ertelemenin maliyeti göründüğünden büyüktü: onsuz oyunun temel vaadi
("ekonomi siz yokken de yaşar") oyuncu için bir tehdide dönüşüyordu.

**Çözüm:** `standing_orders` — oyuncu kuralı tanımlar, motor uygular.

★ Bu bir OTOMASYON değil, DELEGE EDİLMİŞ KARARdır. Hedefi ve fiyat sınırını
oyuncu koyar; gizli sübvansiyon yoktur:
- nakit yetmezse miktar kısılır, yetmiyorsa alım olmaz
- seviye kilidi burada da geçerli — kapalı ürün açılmaz
- maliyetin altına satılmaz
- aynı şirketin iki kuralı aynı parayı iki kez harcayamaz
- emirler elle verilenle aynı yoldan geçer, aynı tayına (R40) tabidir

**Etki (60 oyuncu, 700 tur):**

| | Önce | Sonra |
|---|---|---|
| **İlk gün aktif oyuncu büyümesi** | %6,0 ✗ | **%15,6 ✓** |
| Fiyat hareketi | %5,0 | %7,9 ✓ |
| Lv1'de kalan oyuncu | 28 | **20** |
| Lv3+ oyuncu | 17 | **10** (ama Lv2'de 30) |
| Geçen metrik | 9/12 | **9/12** |

183 kural kuruldu, 154'ü çalıştı.

### Çok tohumlu doğrulama: 7/12 → **9/12**

Aynı beş tohum, 134 dakika. Bu sefer tek koşunun sonucu doğrulandı:

| Metrik | Adil dağıtım | + Kalıcı emir | |
|---|---|---|---|
| İlk gün büyümesi | %4,6 · 0/5 | **%15,5 · 5/5** | ▲ |
| Kur değişimi | %28,8 · 1/5 | **%17,7 · 4/5** | ▲ |
| Fiyat hareketi | %11,5 · 4/5 | **%7,4 · 5/5** | ▲ |
| NPC üretim payı | %53,8 · 1/5 | %65,0 · 2/5 | ▲ |
| 1. hafta medyanı | 38.103 ₺ | 40.261 ₺ | → |
| Arz/talep bandı | 3/10 · 0/5 | 2/10 · 0/5 | → |

`day1_growth` yalnız geçmedi, **kararlı** da geçti: beş tohumun beşinde,
yayılma 0,97×–1,08×. Kalıcı emir olmayan bir dünyada oyuncunun ilk günü
giriş sıklığına bağlıydı; artık değil.

★ **NPC payı medyanı %65 ile bandın İÇİNDE ama yalnız 2/5 tohumda tutuyor.**
Kapının iki koşullu kuralı tam da bunu yakalamak için: medyan geçiyor, çoğunluk
geçmiyor → metrik geçmez. Tohum bazında %36,5'ten %89,1'e savruluyor; bu,
oyuncuların üretime ne kadar geçtiğinin dünya olaylarına bağlı olması demek.
Eşiğin kendisi "launch NPC payı" için yazılmış; oyunun ilerleyen evresinde
oyuncuların üretimi devralması zaten madde 31'in amacı.

---

## R42 — İki ölü alan: başlangıç tesisi kurulmuyor, deneyim iki yerde

**Şiddet:** 🟠 Yüksek · **Bulunma:** F8 kalıcı emir testleri · **Durum:** ✅ çözüldü

Kalıcı emir uçlarını test ederken iki bağımsız kusur çıktı:

**(a) `CompanyService.create` başlangıç tesisini kurmuyordu.** `facilityTypeCode`
alınıyor, `start.facilityChoices`e karşı doğrulanıyor ve ATILIYORDU. Madde 4
"İlk tesis: Manav | Büfe (seçmeli)" diyor ve başlangıç durumunun parçası sayıyor;
oyuncu ise tesissiz kuruluyordu. Kurulum maliyeti alınmaz: bu tesis başlangıç
sermayesinin parçasıdır, satın alınan bir yatırım değil.

**(b) `experience` hem `companies` hem `company_stats` tablosundaydı.** Şirket
ekranı `companies.experience`'ı OKUYOR ama oraya hiçbir yerde yazılmıyordu;
F8'de eklenen ilerleme `company_stats.experience`'a yazıyordu. Seviye doğru
ilerliyor, oyuncu XP'sini hep 0 görüyordu. Kolonu ekleyen ben olduğum için
(0013) taşımak da bana düştü: tek kaynak `companies.experience` (seviye orada).

---


---

## R43 — Ara mal talebi aşağı halkanın KAPASİTESİnden ölçülüyordu

**Şiddet:** 🟠 Yüksek · **Bulunma:** F8 `supply_demand` takibi · **Durum:** ✅ çözüldü

`supply_demand` ölçütü beş tohumun hiçbirinde geçmedi. Kovalarken ED'nin ara
malları nasıl ölçtüğü çıktı: F7'de ara mal talebini aşağı halkanın KURULU
KAPASİTESİnden hesaplıyordum. Bu, kapasitenin talepten fazla olduğu her yerde
talebi şişirir — değirmen kapasitesi ekmek talebinin gerektirdiğinden büyükse
buğday yapay olarak kıt görünür.

Üç yaklaşım denendi, ikisi de yanlış tarafa düştü:

1. **Gerçekleşen üretimden.** Arz şokunu GÖRÜNMEZ kılıyordu: çelik bitince
   mobilya fabrikası da durur, ölçülen çelik talebi de düşer, oran 1,00'da
   kalır. Tüm çelik üretimi durdurulduğu hâlde skor 75 → 70'te kaldı ve hiçbir
   müdahale tetiklenmedi.
2. **Aşağı halkanın kapasitesinden.** Şok görünür oldu ama fazla kapasite
   talebi şişirdi; oran 0,76'da sıkıştı.
3. **Zincirden (seçilen).** Tüketici talebi geriye yayılır: 826 ekmek 207 un,
   207 un 276 buğday ister. Şok yine görünür — talep tüketiciden gelir, arzla
   birlikte çökmez — ama fazla kapasite talebi şişirmez.

`chainRequirements` saf orandır, hiçbir yerde tura bölmez: hangi zaman tabanını
verirsen onu döndürür. ED ona 96 turluk pencere toplamını verir, arzı da aynı
pencereden ölçer.

---


## R45 — Sürü hücumu geri geldi: 58 NPC aynı turda düşünüyor

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 `supply_demand` kök neden analizi · **Durum:** ✅ çözüldü

R28'de eşzamanlı yatırıma karşı boru hattı farkındalığı eklemiştim. Yetmemiş.
Ölçüm: 55 buğday tarlasının 4'ü tohumdan, **51'i tek bir turda** — tur 392'de —
kurulmuştu. Hem de her arketip tarafından: sanayici 20, tarımcı 17, perakendeci
8, hatta spekülatör 2. Buğday kapasitesi ihtiyacın **8,69 katına** çıkarken
fırın **0,35 katında** kaldı; 52.829 kg buğday satılmadan tarlalarda bekledi,
ekmek arz/talep oranı 0,23'te kaldı. `supply_demand`'in geçememesinin kökü buydu.

İki bağımsız kusur üst üste bindi:

**(a) Herkes aynı turda düşünüyor.** `last_strategy_tick` bütün NPC'lerde 0'dan
başlıyor, aralıklar 48/96/128. Tur 384'te hem 96'lık grup (34 NPC) hem 128'lik
grup (24 NPC) ateşledi. 58 NPC aynı anda karar verdi, inşaat 8 tur sürdü, 392'de
hepsi birden açıldı. Çözüm: tohumda faz dağıtılır (`-rng() × aralık`), faz
sonsuza dek korunur.

**(b) Aynı turda karar verenler birbirini göremiyor.** Fırsat listesi tur
başında BİR KEZ hesaplanıp bütün NPC'lere aynı kopyası veriliyordu. Boru hattı
koruması yalnız ÖNCEKİ turlarda başlamış inşaatı görür; aynı turdaki 58 kararın
her biri boş bir boru hattı gördü. Çözüm: tur içi taahhüt defteri — bir NPC
yatırım yapınca bağladığı kapasite deftere yazılır ve sonraki NPC açığı o kadar
küçülmüş görür.

★ Genel ders: **"eşzamanlı" iki ölçekte olur** — aynı turda ve ardışık turlarda.
R28 ikincisini kapatmıştı, birincisi açık kalmıştı. Bilgi mükemmel ve aktörler
özdeş olduğunda her açık eşzamanlılık sürüye dönüşür.

---


## R46 — Tohum dengesini doğrulayan test bir kurguyu doğruluyordu

**Şiddet:** 🟠 Yüksek · **Bulunma:** R45 sonrası denetim · **Durum:** ✅ çözüldü

R45'i düzelttikten sonra "peki bu dünyayı zaten bir test doğrulamıyor muydu?"
diye baktım. Doğruluyordu — ama gerçeği değil, kendi modelini.

`seed-data.test` zincirin her aşamasını `chainRequirements` ile hesaplayıp tohum
dünyasının onu karşıladığını doğruluyor. Beslendiği `npcFacilityCounts()`
dağılımı ORANSAL varsayıyordu: `count × 1,35 / liste uzunluğu`. Tohum ise
yuvaları `plan.facilities[(index + s) % uzunluk]` ile dağıtıyordu ve `index`
planlar arası **küresel** bir sayaçtı. INDUSTRIAL planı 16'ncı NPC'de başlıyor,
listesi 12 uzunluğunda: `16 % 12 = 4`. Liste fırından değil, dördüncü girdiden —
sigara fabrikasından — açılıyordu.

| tesis | sayaç diyor | tohum kuruyor |
|---|---|---|
| BAKERY | 9 | **5** |
| CIG_FACTORY | 4,5 | **8** |
| IRON_MINE | 2,3 | 4 |

Fırın kritik halkaydı: ekmek zinciri tüketici talebinin %23'ünü karşılıyordu ve
test yeşil kalıyordu. Çözüm dengeyi elle ayarlamak değil **tek kaynak**:
`planSlots()` yuva listesini üretir, tohum onu sırayla tüketir, sayaç onu sayar.
Düzeltmeden sonra: fırın 11, değirmen 4, sigara fabrikası 4.

★ Ders: bir testin yeşil olması ölçtüğü şeyin doğru olduğunu göstermez —
**ölçtüğü şeyin gerçek olduğunu** göstermesi gerekir. Model ile gerçek ayrı
kodda yaşadığı sürece sessizce ayrışırlar.

---

## R47 — İki ölü ölçek: ED kıtlığı görüp susuyor, marj terimi hiçbir şeyi ayırmıyor

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 `supply_demand` kazısı · **Durum:** ✅ çözüldü

R45 ve R46'dan sonra sermaye artık yanlış ürüne akmıyordu — ama hiçbir yere de
akmıyordu. Ölçüm: **700 turda 2 NPC yatırımı.** Nakit boldu (ort. 362.800 ₺),
tesis sınırı dolu değildi (1,20/4). On ürünün hepsi eksikti (0,13–0,78) ve dünya
kendini düzeltmiyordu.

**(a) Sağlık skoru kıtlığı ortalamada eritiyordu.** Ekmekte arz bileşeni 0,00,
derinlik 0,02 — ortada mal yok. Ama satıcı 1,00, alıcı 1,00, istikrar 1,00 skoru
**40,3**'e çekiyordu ve bant ADJUST oluyordu. ADJUST yatırım teşviki YAYINLAMAZ
(`INVESTMENT_BIAS` yalnız STIMULATE ≤35 ve EMERGENCY'de çıkar). Aktif yatırım
direktifi sayısı: **sıfır**. ED kıtlığı ölçüyor, sınıflandırması onu susturuyordu.

Çözüm R26'daki `tradeCount` kapısının aynı örüntüsü — bazı bileşenler ortalamaya
girmez, TAVAN koyar:

    scarcity = max(f_supply, f_depth)
    ceiling  = 100 × (0,20 + 0,80 × scarcity)
    score    = min(ağırlıklı_ortalama, ceiling)

Arz VEYA derinlikten hangisi iyiyse o sayılır: derin stoğu olan ama akışı yavaş
piyasada mal VARDIR. Ekmek 40,3 → 21,6 (STIMULATE), un → 28,8, sigara → 24,0;
domates (derinlik 0,66) ve kömür (arz 0,56) dokunulmadan kaldı.

**(b) Marj terimi ölü ağırlıktı.** Skorun en ağır bileşeni (%35)
`(fiyat/birim_maliyet − 1) / 1,5` idi, yani 2,5 katta doyuyordu. Oysa tohum
fiyatları **tasarım gereği** maliyetin 1,15–1,75 katıdır; `seed-data.test` tam
bunu şart koşar. Terim ekonominin hiç ulaşamayacağı bir aralığa ölçekleniyor ve
her üründe 0,22–0,27'de sıkışıyordu: 10 üründe yayılma 0,05.

Ölçek tasarım bandına oturtuldu ve R46'nın dersi uygulandı — `PRICE_MARKUP_BAND`
**tek kaynaktır**: tohum testi fiyatları ona karşı doğrular, motorun SQL'i marjı
onun üzerine ölçekler.

**Ölçülen (1 tohum × 400 tur):** arz/talep bandındaki ürün **0/10 → 5/10**.

★ Ders: bir ölçüt yalnız yanlış olduğunda değil, **hiçbir şeyi ayırt etmediğinde
de** bozuktur. Sabit çıkan bir terim ağırlığını taşımaz, yalnız eşiği yükseltir.

---

## R48 — Kazanan hepsini alır: sermaye zincirin son halkasına yığıldı

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 ikinci kapı koşusu · **Durum:** ✅ çözüldü

R47'den sonra yatırım yeniden akmaya başladı — ama tek bir yere:

| tesis | tohumdan | sonradan |
|---|---|---|
| BAKERY | 11 | **28** |
| MILL | 4 | 4 |
| WHEAT_FIELD | 4 | **0** |

Ekmek 0,29 · un 0,30 · buğday 0,29 — zincir kökünden aç, sermayenin tamamı
yaprakta. Maden zinciri (kömür 0,94 · demir 0,87 · çelik 1,00) sağlıklıydı çünkü
kısa: tek aşamalı zincirlerde bu kusur görünmez.

Sebep skorların BERABERLİĞİ: fırın 0,37 · buğday tarlası 0,36 · değirmen 0,36.
Fark 0,01. NPC en yüksek skorlu TEK fırsatı seçtiği için kılpayı öndeki her turda
kazandı ve 28 yatırımın hepsini topladı.

Beraberliği bozması gereken terim zaten skordaydı ama çakılıydı:
`strategicNeed: 0.5` — kodun kendi yorumu "kendi zincirinde eksik halka —
MVP-1'de sabit" diyordu. Sabit bir terim hiçbir şeyi ayırt etmez (R47'nin dersi),
yalnız eşiği yükseltir. Zincirden türetildi: **girdilerin en kıt olanının arz
sağlığı**, hammaddede 1.

    strategic_need = MIN(f_supply) over recipe_inputs   -- girdisizse 1

Girdisi olmayan fabrikaya yatırım para yakmaktır: kurulur, girdi bulamaz,
işçilik öder, durur. Hammadde her zaman beslenebilir olduğu için zincir KÖKTEN
yukarı dolar. **Ölçülen:** buğday tarlası 4 → 11, değirmen 4 → 8, fırın 11 → 33.

★ Ders: yakın skorlarda "en iyiyi seç" kuralı, farkı 0,01 olan bir sıralamayı
%100'e karşı %0'a çevirir. Beraberliği bozan terim ölüyse, seçim rastgele bir
kılpayına teslim edilmiş demektir.

---

## R49 — Yatırım eşiği ulaşılabilir en yüksek skorun üstündeydi

**Şiddet:** 🟠 Yüksek · **Bulunma:** F8 üçüncü kapı koşusu · **Durum:** ✅ çözüldü

R48'den sonra sıralama doğruydu ama yatırım yine seyrekti: 700 turda 4 tesis,
NPC payı %56,7 (hedef %60–80). Ölçülen skor dağılımı:

    tütün 0,45 · buğday 0,41 · kömür 0,39 · demir 0,35 · değirmen 0,34
    fırın 0,32 · çelik 0,30 · mobilya 0,27 · sebze 0,15

Eşik **0,55**. Ulaşılabilir en yüksek skor 0,45. Hiçbir fırsat kendi değeriyle
eşiği geçemiyordu; yatırım yalnız atak NPC'lerin `(0,5 + iştah)` çarpanıyla
sızıyordu. R47'nin aynı ailesi: ölçek, ölçtüğü dağılımla uyuşmuyordu.

Eşik 0,38'e kalibre edildi — tam kıt hammaddeleri geçirir, beslenemeyen
fabrikaları girdileri düzelene kadar dışarıda tutar.

★ Eşiğin NEYİN kurulacağına etkisi yoktur: `maybeInvest` en yüksek skorlu TEK
fırsatı seçer, sıralamayı `strategicNeed` ve açık/boru hattı koruması belirler.
Eşik yalnız yatırımın HIZINI ayarlar — bu yüzden indirmek R48'in yığılmasını
geri getirmez.

---

## R50 — İlk haftanın tamamı tek ürün: ticaret kilitleri oyuncuyu dışarıda tutuyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 teşhis çıktısı · **Durum:** ✅ çözüldü

`week1_value` üç kapı koşusunda 0/5 tuttu ve hiç kazılmamıştı. Kapıya teşhis
adımı ekleyince ilk koşusunda çıktı: süresi dolan **2.141 oyuncu alış emrinin
hepsi domatesti.** Ekmek, sigara, mobilya için tek emir bile yoktu.

Sebep `products.unlock_level` — ürün TİCARETİNİ kilitliyor:

| ürün | kilit | perakende talebi |
|---|---|---|
| TOMATO | 1 | 634 kg/tur |
| BREAD | **6** | 1.014 kg/tur |
| CIGARETTE | **8** | — |
| FURNITURE | **12** | — |

400. turda oyuncular Lv1 (39), Lv2 (17), Lv3 (4) dağılımındaydı. Yani ilk
haftanın tamamı tek ürün. 86 oyuncu dükkânı aynı domates için yarışırken NPC
marketleri dördünü birden satıyordu — dükkân başına **2,8 kg/tur vs 37,6**.

Bu tek bulgu iki metriği birden açıklıyor: `week1_value` (seviye 1 oyuncunun
eriştiği tek pazar haftada ~17.600 ₺ eder, 34.000 başlangıçla ~52.000 — hedef
100–250 bin tasarım gereği ulaşılamaz) ve `npc_share` (%85,6; oyuncu üç üründen
dışlanmışken NPC payı düşemez).

**Yapılan:** ekmek 6 → 2, sigara 8 → 4. Üretim kilitleri (buğday 5, un 6)
bilerek yukarıda: oyuncu önce satmayı, sonra üretmeyi öğrenir.

**Ölçülen (1 tohum × 400 tur):** oyuncu değeri p50 37.417 → **44.806 ₺**,
ortalama seviye 1,42 → 1,67, dolan alış emri 326 → 516. Aynı koşuda
`supply_demand` geriledi (0,84–1,03 kümesi 0,66–1,28'e yayıldı): oyuncunun yeni
ekmek talebi zincire bindi, NPC yatırımı tepki verdi (fırın 11→37, tarla 4→26)
ama 400 turda yetişemedi. Tek koşu karar vermez (R39).

★ **İkinci kilit — XP kapısı.** Merdiveni indirmek gerekliydi ama yetmiyordu:
Lv2'nin kendisi 700 XP istiyordu, Lv1 oyuncusu 113 XP'deydi. Ölçülen kazanım
~0,94 XP/tur, yani 700'e ~745 turda varılıyor — ilk hafta (672 tur) tam biterken.
Kilit döngüseldi: **ekmek için Lv2, Lv2 için ekmek cirosu.** R30'un bir basamak
yukarıdaki kardeşi. Lv2 eşiği ölçülen hıza göre 700 → **200** (≈2 gün). Sonraki
basamaklara dokunulmadı: ekmek açılınca ciro ve dolayısıyla XP hızlandığı için
merdiven kendi kendini toparlar.

---

## R52 — Ölçüt son ANIN fotoğrafını çekiyor ve "mal yok" ile "pahalı"yı ayıramıyor

**Şiddet:** 🟠 Yüksek · **Bulunma:** F8 kapı yayılma analizi · **Durum:** ✅ çözüldü

`supply_demand` beş tohumda 4, 0, 7, 2, 4/10 çıktı. Aynı kod, aynı parametreler.
Bu yayılmanın bir kısmı dünyanın gerçek farkı, ama önemli bir kısmı **ölçütün
kendisiydi**.

**(a) Tek turdan örnekleme.** Metrik `tick_id = lastTick` diyordu — koşunun
tamamı yerine son anın fotoğrafı. Dünya olayları, üretim kısma ve tesis
duruşları son pencereyi kolayca kaydırıyor. Artık ürün başına son GÜNÜN
ortalaması alınıyor: tek kötü tur bir ürünü banttan çıkaramaz.

**(b) İki farklı olguyu tek sayıya eziyordu.** Oran, üretimi ARZU EDİLEN talebe
böler. Ama tüketicinin bütçesi vardır (`referans × miktar × bütçe payı`) ve
fiyat yükselince daha az alır — `city_demand.budget_limited_units` bunu zaten
sayıyordu, kimse bakmıyordu. Sonuç: oran, fiyatın referansın üstünde olduğu her
durumda 1'e ulaşamaz; piyasa temizlenmiş olsa bile.

Ölçülen fark:

| ürün | karşılanan | bütçe engeli | gerçek durum |
|---|---|---|---|
| BREAD | %53,9 | %2,5 | **mal yok** — gerçek kıtlık |
| TOMATO | %82,0 | %38,6 | mal var, **pahalı** |
| CIGARETTE | %85,1 | %26,2 | mal var, pahalı |

Yeni ölçüt `retail_fulfilment` bu ayrımı yapıyor: karşılanma %85'in altındaysa
VE bunun sebebi bütçe değilse (%15 altı), ürün "mal bulunamıyor" sayılır.

★ Bu bir gevşetme DEĞİLDİR: ekmek %53,9 ile yine düşer. Domates geçer — çünkü
domates kıt değildi, pahalıydı; onu R51'deki indirim mekanizması ayrıca çözer.
Ölçütü değiştirmek kendi ödevine not vermeye benzer; o yüzden ikisi de
puanlamayı kolaylaştırmak için değil, DOĞRU soruyu sormak için yapıldı.

---

## R53 — İndirim fazlayı değil küçük dükkânı cezalandırıyordu

**Şiddet:** 🟠 Yüksek · **Bulunma:** R51 sonrası kapı koşusu · **Durum:** ✅ çözüldü

R51'in stok indirimi hedefine vurdu: domates fazlası **1,67 → 1,13** ile banda
girdi, dükkân başına satış **2,8 → 4,2 kg/tur** yükseldi ve `money_supply`
3/5'ten 5/5'e döndü.

Ama aynı koşuda `week1_value` **58.081 → 39.679 ₺** geriledi. İki koşu arasındaki
tek değişiklik R51 olduğu için sebep belliydi — ve kusur benim uygulamamdaydı.

Kapsam dükkânın KENDİ satış hızına bölünüyordu. Yavaş satan küçük bir dükkânda
az stok bile "20 turluk kapsam" çıkarıp %25 indirim tetikliyordu. Oysa oyuncu
rafları **%8,8 dolulukta**: ortada eritilecek fazla yoktu, dükkân sadece küçüktü.
İndirim fazlayı eritmek yerine küçük oyuncuyu cezalandırıyordu.

`clearanceFactor` artık ürünün PİYASA arz/talep oranını da alıyor ve oran
1,05'in altındaysa indirim uygulamıyor: piyasa kıt ya da dengedeyse sorun fiyat
değil, arzdır.

★ Ders: bir geri besleme kuralının sinyalini aktörün KENDİ durumundan alırsan,
küçük olmakla kötü olmayı ayırt edemezsin. Fazlalık bir piyasa olgusudur, tek
bir dükkânın raf durumu değil.

---

## R54 — Zincir kökten doldu ve orada kaldı: değirmen hiç kurulmadı

**Şiddet:** 🔴 Kritik · **Bulunma:** F8 kapı teşhisi (10/12) · **Durum:** ✅ çözüldü

R48 sermayenin fırına yığılmasını durdurdu ve zinciri kökten doldurmaya başladı.
Ama orada bıraktı. İki tohumun yatırım tablosu:

| tesis | tohum 0 | tohum 2 |
|---|---|---|
| BAKERY | +12 | +10 |
| WHEAT_FIELD | +5 | +15 |
| **MILL** | **+4** | **+5** |

8–9 değirmen turda ~176 kg un üretiyor; 21–23 fırın ise 210–230 kg istiyor.
Un yapısal darboğaz oldu ve ekmek 0,60'ta kaldı.

Sebep R48'in ölçüsüydü: `strategicNeed` girdinin MUTLAK arz sağlığıydı. Buğday
zincirin en sağlıklı halkasıydı (oran 0,69, HEALTHY) ama f_supply'ı 0,38
olduğundan değirmen 0,38 alıyordu; buğday tarlası ise girdisi olmadığı için
1,0. Sermaye köke akmaya devam etti, buğday birikti, un halkası büyümedi.

Doğru soru "girdim ne kadar bol" değil, **nerede değer katarım**:

    strategicNeed = clamp01(0,5 + girdi_arzı − çıktı_arzı)

Ölçülen değerlerle: buğday tarlası 1,00 · **değirmen 0,68** · fırın 0,50. Sıra
korunuyor ama değirmen artık fırının önünde ve anlamlı bir puan alıyor. Kendi
kendini de düzeltir: buğday arzı iyileştikçe tarlanın puanı 0,5'e iner,
değirminki yükselir.

★ Formül SQL'de bırakılmadı — `strategicNeed` saf fonksiyona taşındı ve sorgu
yalnız bileşenleri (`input_supply`, `output_supply`) taşıyor. R46'nın dersi:
model ile gerçek ayrı kodda yaşarsa sessizce ayrışır.

---

## R55 — Üretim kısma oyuncuyu korumuyordu: domates fazlası erimiyordu

**Şiddet:** 🟠 Yüksek · **Bulunma:** F8 kapı teşhisi (10/13) · **Durum:** ✅ çözüldü

Domates her tohumda fazlada takılı kaldı: **1,57–1,62**. R51'in indirimi fiyatı
düşürüyordu ama üretimi durdurmuyordu.

Ölçüm sebebi tek satırda verdi: **oyuncu tesisleri kullanım 1,000, NPC'ler
0,694.** Üretim kısma (`outputThrottle`) NPC döngüsünün İÇİNDEYDİ; oyuncu
tesisleri hiç kısılmıyordu. Sebze bahçesi Lv1'de kurulabilen tek üretim tesisi
olduğu için bütün oyuncular onu kuruyor ve deposu dolsa da tam gaz üretiyordu.

Bu R21 ("kapasiteye üretim para sızdırıyor") ile R41 ("çevrimdışı oyuncu
geriliyor") kesişimidir: dolu depoya üretmek yalnız işçilik yakar ve çevrimdışı
oyuncu bunu göremez. Motor NPC'yi bundan koruyordu, oyuncuyu korumuyordu.

Kısma artık oyuncu tesislerine de uygulanıyor. İki sınır konuldu:

- **Oyuncunun tercihi korunur:** `production_enabled` kapalıysa motor karışmaz.
  Kısma bir tavan değil, geri beslemedir; stok erirse kullanım geri çıkar.
- **NPC varlığından bağımsızdır.** İlk hâlinde fonksiyon erken çıkışın
  gerisinde kalıyordu: NPC'siz bir dünyada hiç çalışmıyordu ve testi bu yüzden
  düştü. Faz `npcs.length === 0` olduğunda hemen dönüyor.

★ Bu bir tasarım kararıdır: motor oyuncunun tesisini onun adına kısıyor.
Alternatifi çevrimdışı oyuncunun dolu depoya üretip işçilik yakmasıydı.

---

## R56 — Tur belirleyici değildi: aynı tohum farklı dünya üretiyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** iki kapı koşusunun karşılaştırılması · **Durum:** ✅ çözüldü

Arka arkaya iki kapı koşusu, **aynı tohumlarla** farklı sonuç verdi:

| tohum | koşu A | koşu B |
|---|---|---|
| 20261917 | 9/13 | 10/13 |
| 20263943 | **10/13** | **7/13** |
| 20264956 | 9/13 | 10/13 |

İki etiket arasındaki fark `git diff --stat` ile bakıldığında tek dosyaydı:
`apps/sim/sql/teshis.sql` — simülasyondan SONRA çalışan bir teşhis sorgusu.
Sonucu değiştirmesi mümkün değildi.

Kaynak, durumu sırayla değiştiren döngüleri besleyen **ORDER BY'sız sorgular**.
Postgres sıra garantisi vermez ve satırlar güncellendikçe fiziksel düzen
değişir. Sıranın önemi R45'te eklediğim tur içi taahhüt defteriyle arttı: ilk
karar veren NPC açığı kapıyor, sonrakiler kapanmış görüyor. Sıra değişince
kimin yatırım yaptığı, kimin kıt malı aldığı, kimin bütçesinin yettiği değişti.

Sıralanan yerler: NPC karar döngüsü, üretim, perakende teklifleri, bakım,
ilerleme ve simülasyonun oyuncu tesisi döngüsü. `p2-exchange` zaten doğruydu
(fiyat + `o.id` eşitlik bozucu) — kıt malın dağıtımı en kritik yerdi ve orada
sorun yoktu.

★ Bunun ağırlığı bir denge ayarından fazladır: **R51'den R55'e kadar yaptığım
her karşılaştırma bu gürültüyü içeriyordu.** "Tohum varyansı" dediğim ve
`unstableKeys` uyarısının işaret ettiği şeyin bir kısmı dünyanın gerçek farkı
değil, ölçüm aletinin kendi titremesiydi. R39'un çok tohumlu kapısı doğru bir
araçtı ama bu gürültüyü ortalamayla gizliyordu.

---

## R57 — Turun rastgelelik tohumu DUVAR SAATİNDEN türüyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** R56 sonrası determinizm doğrulaması · **Durum:** ✅ çözüldü

R56'da döngü sorgularını sıraladıktan sonra aynı tohumu iki kez koşturdum.
Hâlâ farklıydı — ve çıktı kaynağı gösterdi: bir koşu **2 dünya olayı**, diğeri
**4 dünya olayı** üretti.

Turun tohumu şuydu:

    (EXTRACT(EPOCH FROM NOW())::bigint * 2654435761) % 9223372036854775807

ADR-0003 "zaman `tick.seq`'tir, rastgelelik enjekte edilir" der; `rngFor`'un
kendi dokümanı "aynı tohum aynı dünyayı üretir" diye söz verir. Ama turun KENDİ
tohumu her koşuda farklıydı, yani söz hiç tutulmuyordu. Kapının "tohum"
parametresi yalnız OYUNCU dünyasının kurulumunu tohumluyordu; dünya olayları,
kalite dağılımı ve gürültü her koşuda yeniden zar atıyordu.

Tur tohumu artık **dünya tohumu + sıra sayısından** türer. Kapı tohumu
`world.rng` yapılandırmasına yazılır: her tohum farklı ama kendi içinde
tekrarlanabilir bir dünya kurar. Üretimde de değerlidir — bir turu yeniden
oynatıp hata ayıklamak ancak böyle mümkün.

**Ölçülen sonuç:** üç ardışık doğrulamada iki koşu da aynı skoru (8/13) ve aynı
sayıda dünya olayını (3) verdi. **Kapının KARARI artık tekrarlanabilir.**

### Kalan sapma ve nedeni — varlık kimlikleri rastgele

Sürekli metriklerde küçük sapmalar sürüyor (`npc_share` %0,7, `day1_growth`
%3,1). Kaynağı bulundu ve R56'nın neden yetmediğini açıklıyor: `companies.id` ve
`facilities.id` varsayılanı `gen_random_uuid()`. Yani `ORDER BY id` sırayı bir
koşu İÇİNDE sabitler, koşular ARASINDA sabitlemez — her koşuda farklı bir sıra.

Tam determinizm, varlık kimliklerinin içerikten türetilmesini gerektirir
(`deterministicUuid` projede var ama yalnız defter işlem kimliklerinde
kullanılıyor). Bu, şirket ve tesis oluşturma yollarına dokunan ayrı bir iştir.

★ Şu anki seviye "yapısal olarak deterministik": aynı tohum aynı dünyayı, aynı
olayları ve aynı kapı kararını üretir; sayısal ayrıntı milimetrik oynar. Kapı
kararı bu seviyede güvenilir olduğu için denge işine dönmek makul — ama bu
sınırın bilinerek kabul edildiğini not etmek gerekir.

---

## R58 — Sermaye tahsisi tek yönlü cırcırdı: NPC kötü yatırımdan çıkamıyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** determinizm sonrası ilk temiz kapı · **Durum:** ✅ çözüldü

Determinizm oturunca (R56, R57) beklentim tohumlar arası yayılmanın daralmasıydı.
**Daralmadı** — 7 ile 10 arasında kaldı ve kararsız metrik listesi uzadı. Yani o
fark ölçüm gürültüsü değil, ekonominin **gerçekten yol bağımlı** olmasıydı.

İki tohumun karşılaştırması mekanizmayı verdi (kapasiteler kg/tur):

| | tohum 1 (10/13) | tohum 0 (7/13) |
|---|---|---|
| un | **220** | 198 |
| buğday | 510 | **630** |
| sigara | 210 | **308** |
| sigara kullanımı | 1,00 · stok 148 | **0,48 · stok 6.056** |

Neredeyse aynı tesis sayılarıyla başlayan iki dünya farklı yerlere kilitlendi.
Kötü tohum sermayeyi sigaraya ve buğdaya yatırdı, una yatırmadı.

Sebep: **tesisler yalnız kredi tasfiyesiyle kapanıyordu** (`loans.ts`). NPC kötü
bir yatırımdan kendi iradesiyle asla çıkmıyordu. Sigara fabrikası bir kez
kurulunca sonsuza dek duruyor, malı satılmasa da bakım ve işçilik yakıyordu.
Kısma üretimi tabana indiriyor ama gideri durdurmuyor. Üstelik `maxFacilities`
sınırı yüzünden dört kötü tesise sıkışan NPC bir daha HİÇ yatırım yapamıyordu —
erken bir hata kalıcı felç oluyordu.

`shouldDivest` eklendi. Kural KATIDIR: yalnız kısma tabanında en az bir gün
geçirmiş VE çıktı stoğu birikmiş tesis kapanır.

★ İkinci şart kritiktir: **girdi bulamadığı için duran tesisi korur.** Un
bulamayan fırının çıktı stoğu yoktur; onu kapatmak kıtlığı derinleştirirdi.
Kapanan yalnız malı satılmadığı için duran tesistir.

Sermaye geri gelmez — batmış maliyet batmıştır. Kazanç, giderin durması ve
`maxFacilities` yuvasının boşalmasıdır; çıkış girişten ÖNCE değerlendirilir ki
NPC aynı turda daha iyi bir yere yatırım yapabilsin.

---

## R59 — Kıtlık ölçüsü SİMETRİKti: dolu ambar en cazip yatırım görünüyordu

**Şiddet:** 🔴 Kritik · **Bulunma:** R58 sonrası kapı teşhisi · **Durum:** ✅ çözüldü

R58'in çıkışı beklendiği kadar iş görmedi: kapı 7–10'dan 8–10'a daraldı ama
seviye düştü (bir tohum 10 → 8). Teşhis iki kusur gösterdi, ikisi de önceki
düzeltmelerimde.

**(a) Çıkış kuralı neredeyse hiç tetiklenmiyordu.** `shouldDivest` kısma
TABANINI (≤ 0,105) şart koşuyordu. Ama kısma kademelidir (≤%5/tur) ve orta
düzey fazla arzda tesis 0,45 civarında dengelenip tabana hiç inmez. Ölçülen:
26 buğday tarlası %45 kullanımda **31.756 kg** satılmamış stokla oturuyordu ve
hiçbiri kapanmıyordu. Eşik gerçeğe uyduruldu (`idleBelow: 0,5`).

**(b) `f_supply` simetrikti.** Formülü `1 − |oran−1|/0,5`. Oranı **2** olan
FAZLA arzdaki ürünün f_supply'ı 0 çıkar — tıpkı oranı 0 olan kıt ürün gibi.
Yatırım kararı bunu kıtlık sanıyordu:

- `demand_gap = 1 − f_supply` → dolu ambara **maksimum açık**
- R54'ün `strategicNeed`'i → fazla arzdaki hammaddeye **1,0**

Yani zaten dolu olan yere yatırım en cazip seçenek gibi görünüyordu. Tohum 3'ün
26 tarlası tam bu. `gap_per_tick` koruması fazla arzı yakalıyordu ama SKOR
şişkin kaldığı için sıralama bozuluyordu.

Yönlü ölçü kondu: **kıtlık yalnız oran 1'in ALTINDAYKEN vardır.**

    kitlik = clamp01(1 − arz/talep)

★ Bu, R54'ü de düzeltir: "değer katkısı" formülü doğruydu ama yanlış sinyalle
besleniyordu. Sağlık skoru için simetri DOĞRUdur (hem kıtlık hem bolluk
sağlıksızdır); yatırım kararı için değildir. Aynı sayıyı iki farklı soruya
cevap diye kullanmak hatanın kaynağıydı.

---

## R60 — Aynı hata sinyaline iki denetleyici: kısma + kapatma

**Şiddet:** 🔴 Kritik · **Bulunma:** R59 kapı teşhisi · **Durum:** ✅ çözüldü

R59 kapıyı 8,10,8,8,8'den **7,9,9,9,7**'ye taşıdı: üç tohum yükseldi, iki tohum
düştü. Yönlü kıtlık (R59b) tam istendiği gibi çalıştı — tohum 0'da sonradan
yapılan sebze bahçesi yatırımı 26 → **0**, tütün çiftliği 10 → 4, tütün
üretici stoğu 6.255 → 1.169, ekmeğin "girdi yetersiz" sayısı iki tohumda
1296 → 164 ve 932 → 246. Dolu ambara sermaye akışı durdu.

Ama birleşik etki bandı ıskaladı: **NPC üretim payı %81,5 → %59,6**. Hedef
%60–80. Bandın üstünden girip altından çıktı, üstelik üç tohum 59,3 / 59,4 /
59,6'da toplandı — bu dağılım değil, yapısal bir dip.

### Sebep

`shouldDivest`'in ilk şartı kısma seviyesine bakıyordu:

```ts
if (utilization > idleBelow) return false;   // utilization = KISMA seviyesi
```

Ve `idle_since_tick` damgası da aynı sayıya bağlıydı (`capped <= idleBelow`).

Kısma zaten fazla arza verilen cevaptır. Tesisi "kısılmış olduğu için"
kapatmak, **aynı hata sinyaline ikinci bir denetleyici asmaktır**: fazla arz
önce üretim kısılarak, sonra tesis kapatılarak iki kez cezalandırılır. İki
denetleyici birbirini görmediği için düzeltme toplanır ve hedefin öbür tarafına
geçer — kontrol teorisindeki klasik aşırı düzeltme.

Bu, R59'la **birebir aynı sınıfta** bir hata: bir sayıyı iki farklı sorunun
cevabı diye kullanmak. Üçüncü tekrarı (R54 → R59 → R60).

### Yanlış okuma — kayda geçsin

İlk teşhisim "demir kıtlığı" idi: çelik iki tohumda 352 ve 353 kez girdisiz
kaldı (önce sıfırdı) ve demir madeni sayısı 4 → 2 olmuştu. Yanlış. Teşhisteki
`kullanim` sütunu `AVG(f.utilization)`, yani **kısma seviyesi** — gerçekleşen
kullanım değil. Demir madenleri 1,00'da, hiç kısılmamış, ürettiğinin hepsini
satıyor (stok 36 birim). Kıtlık yok: 6 çelik fabrikası zincirin nihai talebinin
gerektirdiğinden fazla ve kısma onları ancak %53'e indirebiliyor. "Girdi
yetersiz" orada kıtlığı değil, **fazla kapasitenin boşa dönmesini** ölçüyordu.

Zincir talebinin kendisi sağlamdı: `city_demand.demand_units` İSTENEN talebi
yazar (`fulfilled_units` ayrı sütundur), yani kıtlık ölçülen talebi bastırıp
kendini besleyen bir döngü kurmuyor. Bu kontrol edildi ve temiz çıktı.

### Düzeltme

Çıkış kararı artık kısmanın **düzeltemediği** şeye bakar: kısma üretimi geri
çektiği hâlde stok hâlâ erimiyorsa sorun üretim hızı değil, malın alıcısının
olmamasıdır.

- `idle_since_tick` damgası: `coverage > throttleCfg.targetTicks * bias`
  (stok kısmanın hedefinin üstünde kaldığı sürece saat işler).
- `shouldDivest` girdisinde kısma seviyesi diye bir alan **yoktur** — bir test
  bunu koruyor.
- Süre ve stok eşiği **ayrı iki sayı** oldu (`minIdleTicks`,
  `minCoverageTicks`); önce tek sayı iki soruya cevap veriyordu.
- Kapatma kısmadan belirgin biçimde yavaş: kısma ≤%5/tur ile ~20 turda oturur,
  kapatma 192 tur (2 gün) ister.

`npc.divest`: `{ minIdleTicks: 192, minCoverageTicks: 96 }`.

### Ölçülen sonuç — düzeltme hedefini tutturmadı

Kapı 7,9,9,9,7'den **7,9,8,10,8**'e geçti (bir tohum 10'a çıktı, tekil rekor)
ama asıl hedef ıskalandı: `npc_share` %59,6 → **%58,9**, banda dönmedi.
Yayılma daraldığı yerde GENİŞLEDİ (%51,5–70,2 · önce %59,3–75,5) ve iki
tohumda perakende karşılanması çöktü (%88,5 → %60,8 ve %53,7).

Sebep akıl yürütmedeki bir boşluktu. Kısma kapısı gerçekten çifte sayımdı —
o kısım doğru — ama aynı zamanda bir **ŞİDDET FİLTRESİ** görüyordu: yalnız
belirgin geri çekilmiş tesisler aday oluyordu. Yerine konan "stok kısmanın
hedefinin (8 tur) üstünde" koşulu neredeyse her tesisi aday yaptı; üstelik
stok eşiği de 96'dan 48'e indirilmişti. İki şey gevşetilip biri sıkılmıştı.

Ölçülen: tohum dünyasının KURUCU tesisleri kapandı — tohum 2'de çelik
fabrikası 2+6'dan 1+1'e, buğday tarlası tohumdan 4'ten 3'e, tütün çiftliği
4'ten 3'e, mobilya fabrikası 2'den 1'e indi.

Düzeltildi (R61): tek eşik iki işi de görüyor — saat `minCoverageTicks`'in
üstünde işler, kapatma kararı da aynı seviyeyi arar; seviye bir GÜNLÜK
satılmamış üretime (96 tur) geri çekildi.

**Ders:** bir kapıyı kaldırırken o kapının kaç iş yaptığını saymak gerekiyor.
"Çifte sayım" teşhisi doğruydu ama kapı ikinci bir iş de görüyordu ve yerine
bir şey konmadı.

---

## R61 — Yatırım skorunun beş teriminden üçü bilgi taşımıyor

**Şiddet:** 🟠 Yüksek · **Bulunma:** R60 sonrası, karar girdileri ölçülünce · **Durum:** ⏳ eğilim terimi düzeltildi, kalanı ölçülecek

Sermayenin neden bir ürüne akıp ötekine akmadığını üç kez dolaylı sinyallerden
okumaya çalıştım ve üçünde de yanlış okudum (R54, R59, R60). Dördüncüsünü
tahminle yapmamak için kararın GİRDİLERİ kaydedilmeye başlandı
(`investment_opportunities`; yalnız teşhis, hiçbir mekanik okumaz).

İlk ölçüm (200 tur, 20 oyuncu — kapının 700/60 dünyası değil, oran göstergesi):

| ürün | skor | eşik | marj | açık | eğilim | zincir | rekabet |
|---|---|---|---|---|---|---|---|
| CIGARETTE | 0,204 | 0,371 | 0,117 | 0,112 | 0,001 | 0,074 | −0,100 |
| BREAD | 0,168 | 0,380 | 0,125 | 0,084 | 0,005 | 0,054 | −0,100 |
| FLOUR | 0,145 | 0,380 | 0,115 | 0,071 | 0,004 | 0,055 | −0,100 |
| IRON | 0,107 | 0,380 | 0,107 | 0,000 | 0,000 | 0,050 | −0,050 |

Sütunlar skora yapılan GERÇEK katkıdır (ham değer × ağırlık). Okunanlar:

**(a) Eğilim terimi ölü.** Ağırlığı 0,15, katkısı 0,000–0,012. İki kusur:

- *Yön körü:* `(MAX − MIN) / MIN` bir eğilim değil ARALIKtır. %20 düşen fiyat
  da %20 çıkan fiyat kadar cazip görünüyordu. Simetrik ölçü, yönlü soru —
  R59/R60 ile aynı kalıbın dördüncü tekrarı.
- *Ölçek körü:* ham kesir doğrudan `[0,1]`'e kırpılıyordu. Bir günde %3 artış
  0,03 puan verir; terimin bir şey ifade etmesi için fiyatın bir günde İKİYE
  KATLANMASI gerekirdi. R47'deki ölü marj teriminin aynısı.

Düzeltildi: pencerenin başı ile sonu arasındaki YÖNLÜ değişim, ölçeği
`priceTrendScore` / `PRICE_TREND_FULL_SIGNAL` (günlük %10 = tam sinyal) tek
kaynakta. Düşen fiyat ceza değil, yalnız ödülsüz.

**(b) `strategicNeed` çoğu üründe tam nötrde** (0,050 = ham 0,5). R54'te
eklenen "değer katkısı" terimi hem ağırlıkça en küçük (0,10) hem de çoğu zaman
sinyalsiz. Zincirin darboğazını göstermesi beklenen terim bunu yapmıyor.

**(c) Rekabet cezası tam da kıt ürünlerde doymuş.** `competition = f_sellers`
ve ekmek/un/buğday/sigarada 1,0'e oturmuş, yani −0,100 tavan ceza. Kapasitenin
en çok gerektiği yerler en ağır cezayı alıyor ve terim 5 satıcı ile 50 satıcıyı
ayırt edemiyor.

**Sonuç:** beş terimden yalnız ikisi (marj 0,35 ve yönlü açık 0,30) ayırt edici
bilgi taşıyor. Marj ise zincirin SON halkasını yapısal olarak kayırıyor —
referans fiyat perakende markupunu taşır, ara mal taşımaz. Tohum 0'da ekmek
0,71 ve un 0,72 iken (ikisi de kıt, kıtlık sinyalleri eşit) 17 fırın kuruldu,
4 değirmen.

(b) ve (c) düzeltilmeden ÖNCE kapı koşumunda ölçülecek: 200 turluk kısa
koşumun oranları 700 turluk dünyaya genellenemez.

**(d) R60'ın çıkış kuralı fazla gevşekti.** Ayrıntı R60 bölümünde; özeti:
kaldırılan kısma kapısı çifte sayımın yanı sıra bir şiddet filtresi de
görüyordu ve yerine bir şey konmamıştı. Tek eşik (`minCoverageTicks`, bir
günlük satılmamış üretim) hem saati başlatıyor hem kapatma kararını veriyor.

### Kapı dünyasında ölçüldü: açık terimi ORAN, fırsat ise BÜYÜKLÜK

(a) ve (d) düzeltilince kapı **9,9,10,10,9**'a çıktı (önce 7,9,8,10,8) ve
`supply_demand` oturum boyunca çakılı durduğu 1/10'dan **4/10**'a geldi.
Aynı koşumda teşhis ilk kez gerçek dünyada okundu — tohum 2, son 96 tur:

| ürün | skor | eşik | marj | açık | eğilim | zincir | rekabet | açık/tur | yolda |
|---|---|---|---|---|---|---|---|---|---|
| FURNITURE | 0,152 | 0,380 | 0,117 | 0,027 | 0,000 | 0,059 | −0,050 | **0,3** | 0,0 |
| BREAD | 0,135 | 0,380 | 0,125 | **0,049** | 0,010 | 0,052 | −0,100 | **140,9** | 0,0 |
| FLOUR | 0,124 | 0,380 | 0,115 | 0,044 | 0,000 | 0,064 | −0,100 | 31,8 | 0,0 |

Hiçbir üründe, hiçbir turda skor eşiği geçmiyor (`skor_yetti` = 0/96, her
üründe). Ekmekte tur başına **140,9 birimlik** karşılanmamış açık ve yolda
SIFIR kapasite varken açık terimi 0,049 puan veriyor; sıralamanın birincisi
ise tur başına **0,3 birim** açığı olan mobilya.

Sebep: `kitlik = 1 − arz/talep` bir ORANdır ve doyar. Ekmeğin oranı 0,837,
yani "neredeyse bandın içinde" görünüyor — oysa mutlak boşluk devasa. Büyük
bir pazardaki %16'lık açık, küçük bir pazardaki %90'lık açıktan daha büyük
bir iş fırsatıdır; skor tersini söylüyordu.

Açığın kaç TESİSE denk geldiği ölçülünce sıralama tersine dönüyor:

| ürün | açık/tur | tesis kapasitesi | kaç tesis |
|---|---|---|---|
| BREAD | 140,9 | 40 | **3,5** |
| CIGARETTE | 27,1 | 14 | 1,9 |
| FLOUR | 31,8 | 22 | 1,4 |
| FURNITURE | 0,3 | 2 | **0,15** |

Düzeltildi: `demandGapScore(gapPerTick, facilityCapacity)`, tam sinyal iki
tesislik açık. Yön korunur (fazla arzda `gapPerTick` negatif → 0, R59).

★ Oran YANLIŞ araç değil — başka bir sorunun aracı. `strategicNeed` zincirin
iki AŞAMASINI karşılaştırır, o göreli bir sorudur ve orada kitlik kalıyor.

**Beklenen etki (bir sonraki koşum bunu sınayacak):** ekmek skoru
0,135 → ~0,387, eşiğin (0,380) hemen üstüne çıkar ve fırın yapılır; mobilya
0,152 → ~0,149 ile sıralamanın sonuna düşer. Tahmin tutmazsa buraya yazılır.

---

## R62 — "Oyuncuya yer bırak" kuralı yalnız dünya kurulumunda vardı

**Şiddet:** 🔴 Kritik · **Bulunma:** R61 sonrası kapı koşumu · **Durum:** ✅ çözüldü

R61'in açık düzeltmesi çalıştı ve **tahmin sınandı**:

| ürün | R61 öncesi açık/tur | R61 sonrası |
|---|---|---|
| BREAD | **+140,9** (yolda 0) | **−68,4** |
| FLOUR | +31,8 | −21,1 |
| FURNITURE | 0,3 · sıralamada **1.** | 0,5 · sıralamada **4.** |

Ekmeğin 140 birimlik boşluğu kapandı, mobilya birincilikten düştü — mekanizma
tuttu. En sağlam kanıt: `retail_fulfilment` ilk kez geçti, **mal bulunamayan
0/4**. Kapı 9,9,10,10,9'dan **7,10,8,11,10**'a geçti; bir tohum 11/13 ile
rekor kırdı.

Ama `npc_share` **%78,6 → %98,6** ile çöktü (4/5 → 0/5). Oyuncular üretimin
%1,4'ünü yapıyor.

### Sebep

`capacityGaps(..., npcShare = 0.7)` — "dünyanın %70'ini NPC karşılar, kalanı
oyuncuya kalır" (madde 31) — yalnızca dünya KURULUMUNDA uygulanıyordu.
Çalışma anındaki NPC yatırım yolunda (`loadOpportunities`) bu kural hiç yoktu:
`gap_per_tick` açığın TAMAMIydı ve NPC'ler %100'ünü kovalıyordu. Kurulumun
niyeti yedi gün içinde eziliyordu.

★ Bunun yedi faz boyunca görünmemesinin sebebi bir **KAZA**ydı: NPC'ler açık
kovalamakta zaten beceriksizdi — yatırım skoru eşiği hiç geçmiyordu (R61).
Oyuncuya yer kalması bir tasarım değil, bir kusurun yan etkisiydi. Skor
düzeltilip NPC'ler etkili olunca kaza bitti.

**Ders:** bir kuralın tuttuğunu görmek, o kuralın YAZILDIĞI anlamına gelmiyor.
Doğru sonuç yanlış sebepten de gelebilir ve o sebep düzeltildiğinde kaybolur.

### Düzeltme

`NPC_CAPACITY_SHARE = 0.7` tek kaynak oldu; hem `capacityGaps` varsayılanı hem
çalışma anındaki `gap_per_tick` onu kullanıyor. NPC'ler açığın %70'ini
kovalıyor, %30 oyuncuya kalıyor — kapının %60–80 bandının tam ortası.

★ Ürün başına `products.npc_target_market_share` sütunu BİLEREK kullanılmadı:
adı "npc" diyor ama `health.ts` onu OYUNCU hedef payı olarak okuyor
(varsayılan 0,5) ve kapının kendi bandıyla da çelişiyor. Anlamı bulanık bir
sayıyı üçüncü bir soruya cevap yapmak bu fazın tekrar eden hatasıydı
(R54/R59/R60/R61). Önce o sütunun anlamı netleşmeli — ayrı iş.

---

## R44 — Dış ticaret hiç sınanmıyor: kapının ufku mekaniğin kilidinden kısa

**Şiddet:** 🟡 Orta · **Bulunma:** F8 kapı ölçümleri · **Durum:** ⏳ ayrı senaryo gerekiyor

`foreign_faucet` her koşuda **%0,0** çıktı. İlk okumada bu bir hata gibi görünür;
değil. Ölçüt bir TAVANdır (< %30) — ekonominin kendi üretimiyle değil dışarıdan
akan parayla dönmesini yakalamak için var. %0 onu geçer.

Asıl bulgu şu: liman, kur, dünya fiyatı ve ithalat/ihracat kapasitesi kurulu ve
`foreign-capacity` fazı her tur çalışıyor, ama **hiçbir aktör bu yolu
kullanmıyor**. Alım–satım yalnız `ForeignService` üzerinden, yani oyuncuya açık
uçtan yapılabiliyor; NPC'lerin böyle bir davranışı yok, simülasyon oyuncuları da
o ucu çağırmıyor.

Sebep tasarımın kendisi: Liman 200.000 ₺, **Lv7** ve 20 tur inşaat. Kapı 700 tur
(7,3 gün) koşuyor ve `week1_value` 40.261 ₺ ölçüldü. Yani kapının ufkunda hiçbir
oyuncu limana ne parayla ne seviyeyle ulaşabilir. Dış ticaret **geç oyun**
mekaniği; 7 günlük kapıya zorla sokmak oyunu yanlış temsil eder.

Doğru çözüm ölçütü zorlamak değil, ayrı bir senaryo testi: Lv7 + limanlı bir
şirket tohumlanır ve iki şey doğrulanır —
- ithalat/ihracat uçtan uca çalışıyor mu,
- **R18 arbitrajı**: dünya fiyatından alıp iç piyasada satmak sınırsız para
  basmaya dönüşüyor mu (`import_capacity` ve kota bunu tutuyor mu).

İkincisi asıl risktir: kapasite sınırı yanlış ayarlanırsa dış ticaret ekonominin
para muslugunu ele geçirir ve iç üretim anlamsızlaşır.

**Çözüldü (F8).** `foreign.e2e.test.ts` Lv7 + limanlı bir tüccar kurup uçtan
uca sınıyor. Yazarken üç şey öğrenildi:

- **İthalat DÖVİZLE ödenir** — oyuncu önce ₺ bozdurmak zorunda. Dış ticaret
  böylece kur riskine bağlı: ithalatçı yalnız mal fiyatını değil kuru da
  üstlenir.
- **Kapasite paylaşılan bir havuzdur** — `talep × %15`, ve Ekonomik Direktör'ün
  acil rezerv alımları da aynı havuzdan yer. Boş dünyada ED havuzu tüketiyordu.
- **Arbitraj kapalı.** İthalat dünya fiyatının 1,35 katı, ihracat 0,75 katı:
  %60'lık makas, turu kapatanı zararda bırakır. Test bunu doğruluyor —
  ithal edip hemen ihraç eden oyuncunun döviz bakiyesi DÜŞÜYOR. İkinci savunma
  tur başına kapasite tavanı. Para arzı zaten haftada ~%56 büyüdüğü için
  (R47 sonrası ölçüm) sınırsız bir arbitraj bunun üstüne binerdi; binmiyor.

Geriye kalan tek şey mekaniğin kapı ufkunda hiç ÇALIŞMAMASI: liman Lv7 ve
200.000 ₺, kapı 7 gün koşuyor. Bu bir kusur değil, geç oyun tasarımıdır —
ölçüt de zaten bir tavandır (< %30) ve %0 onu geçer.

---

## R51 — Raf fiyatı satılmayan stoğa tepki vermiyordu: fazla mal, buna rağmen pahalı

**Şiddet:** 🟠 Yüksek · **Bulunma:** F8 karşılanan/istenen talep ölçümü · **Durum:** ✅ çözüldü

Domates paradoksu: arz/talep oranı 1,28–1,67 ile FAZLA üretilirken talebin
**%38,6'sı tüketicinin bütçesi yetmediği için alınamıyordu** ve %18'i hiç
karşılanmıyordu. Fazla mal, buna rağmen pahalı.

`city_demand` bu ayrımı zaten kaydediyordu ama kimse bakmıyordu:

| ürün | istenen | karşılanan | bütçe yetmedi |
|---|---|---|---|
| BREAD | 99.815 | %53,9 | %2,5 |
| TOMATO | 62.319 | %82,0 | **%38,6** |
| CIGARETTE | 19.932 | %85,1 | %26,2 |

Ekmek gerçekten kıttı (bütçe engeli %2,5 — mal yok). Domates ise pahalıydı.

Sebep: raf fiyatı dükkânın KENDİ satılmayan stoğuna hiç bakmıyordu. Hem NPC hem
oyuncu referansın sabit `retailMarkup` katıyla fiyatlıyor, çıpa da rakiplerin
ortalama raf fiyatı olduğu için herkes pahalıysa herkes pahalı kalıyordu —
kapalı döngü, fiyatı aşağı çeken hiçbir kuvvet yok.

Üretimde bu geri besleme vardı (`outputThrottle`: satılmayan stok birikince
kapasiteyi kıs), fiyatta yoktu. `clearanceFactor` eklendi: dükkânın kendi satış
hızına göre 8 turdan fazla stok birikince fiyat kademeli düşer, en çok %25.
Maliyet tabanı korunur — amaç zararına satmak değil, rafı döndürmektir. NPC ve
oyuncu aynı kuralı kullanır ve ikisi de GERÇEK satış hızını okur; NPC tarafında
kullanılan `base_demand × 0,35` tahmini tam da ölçmek istediğimiz farkı siliyordu.

★ Ders: bir piyasada fiyatı yukarı çeken kuvvet varsa (maliyet, marj hedefi),
aşağı çeken kuvvet de olmalı. Yoksa çıpa rakiplere bağlandığı anda fiyat
kendi kendini yukarıda tutar.

---


## Risk özeti

| Kod | Risk | Şiddet | Ne zaman ele alınır |
|---|---|---|---|
| R10 | Sınırsız para basma (perakende) | 🔴 Kritik | **F2** (tasarımda) |
| R15 | Kredi anaparası para yaratır | 🔴 Kritik | ✅ F5 — limit + enflasyona bağlı faiz + %20 alarm |
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
| R19 | Derin zincirde kalite çöküşü | 🟡 Orta | F8 (simülasyonla) |
| R16 | Kredi yeni oyuncuyu atar | 🟠 Yüksek | ✅ F5 — kademeli temerrüt + yük uyarısı |
| R17 | İhracat musluğu | 🟠 Yüksek | F4 |
| R18 | Dış ticaret fiyat keşfini boğar | 🟠 Yüksek | F4 |
| R20 | NPC teklifi navlunu kapsamıyor | 🔴 Kritik | ✅ F6 — `inputBid` + medyan mesafe |
| R21 | Kapasiteye üretim para arzını sızdırıyor | 🟠 Yüksek | ✅ F6 — `utilization` + `outputThrottle` |
| R22 | Tohum fiyatları tariflerle tutarsız | 🟠 Yüksek | ✅ F6 mekanizma · ince ayar F8 |
| R23 | Ürün grafı tohuma karşı doğrulanmıyor | 🟡 Orta | ✅ F6 — `seed-data.test.ts` |
| R24 | ED bolluğu kıtlık sanıp büyütüyor | 🔴 Kritik | ✅ F7 — yön duyarlı direktifler |
| R25 | ED duruşu tutarsız (eski direktifler yaşıyor) | 🟠 Yüksek | ✅ F7 — anında iptal |
| R26 | Ölü piyasa "istikrarlı" sayılıyor | 🟠 Yüksek | ✅ F7 — `tradeCount` |
| R27 | `f_playerShare` oyuncusuz dünyada ceza | 🟡 Orta | ✅ F7 — soğuk başlangıç kuralı |
| R28 | Eşzamanlı yatırım balonu | 🟠 Yüksek | ✅ F7 — boru hattı farkındalığı |
| R29 | CAPEX para arzını sızdırıyor | 🟡 Orta | ⏳ F8 (ölçüldü) |
| R30 | Seviye merdiveni kilitli — Lv1 geçilemiyor | 🔴 Kritik | ✅ F8 — ilerleme + merdiven düzeltmesi |
| R31 | Çoklu sevkiyat turu düşürüyor | 🔴 Kritik | ✅ F8 — kapasite izleme |
| R32 | Dünya talebi oyuncu tabanıyla ölçeklenmiyor | 🔴 Kritik | ⏳ F8 — mekanizma kuruldu, varsayılan kapalı |
| R33 | Giriş yolu tek ürüne bağlı ve o ürün kıt | 🔴 Kritik | ✅ F8 — bahçe kilidi Lv2 + dünya dengesi |
| R34 | Perakende marjı yapısal olarak sıfır | 🔴 Kritik | ✅ F8 — `retailMarkup` |
| R35 | Tohum dünyası perakende ağırlıklı | 🟠 Yüksek | ✅ F8 — üretim ağırlıklı plan |
| R36 | Başlangıç tesisleri oyunun en kötüleriydi | 🔴 Kritik | ✅ F8 — maliyet yarıya, bahçe Lv1 |
| R37 | Toptan satış tesise yazılmıyordu | 🔴 Kritik | ✅ F8 — satış emri üzerinden atıf |
| R38 | Volatilite ölçütü kendi tasarımıyla çelişiyor | 🟡 Orta | ✅ F8 — haftalık aralığa taşındı |
| R39 | Rastgele dünya tek koşuluk kapıyı güvenilmez kılıyor | 🟡 Orta | ✅ çok tohumlu kapı (`gate.ts`) |
| R40 | Kıtlıkta kazanan hepsini alıyor | 🔴 Kritik | ✅ F8 — `scarcityRation` |
| R41 | Çevrimdışı oyuncu geriliyor | 🔴 Kritik | ✅ F8 — kalıcı emirler |
| R42 | Başlangıç tesisi kurulmuyor · deneyim iki yerde | 🟠 Yüksek | ✅ F8 |
| R43 | Ara mal talebi kapasiteden ölçülüyordu | 🟠 Yüksek | ✅ F8 — `chainRequirements` |
| R44 | Dış ticaret hiç sınanmıyor (kapı ufku < Lv7 limanı) | 🟡 Orta | ✅ senaryo testi · arbitraj kapalı |
| R51 | Raf fiyatı satılmayan stoğa tepki vermiyor | 🟠 Yüksek | ✅ F8 — `clearanceFactor` |
| R52 | Ölçüt tek turdan · "mal yok" ile "pahalı" ayrılmıyor | 🟠 Yüksek | ✅ F8 — gün ortalaması + `retail_fulfilment` |
| R53 | İndirim fazlayı değil küçük dükkânı cezalandırıyor | 🟠 Yüksek | ✅ F8 — piyasa oranı kapısı |
| R54 | Zincir kökten doldu, değirmen halkası büyümedi | 🔴 Kritik | ✅ F8 — `strategicNeed` = değer katkısı |
| R55 | Üretim kısma oyuncuyu korumuyor (domates fazlası) | 🟠 Yüksek | ✅ F8 — kısma oyuncuya da |
| R56 | Tur belirleyici değil: aynı tohum farklı dünya | 🔴 Kritik | ✅ F8 — döngü sorgularına `ORDER BY` |
| R57 | Tur tohumu duvar saatinden türüyor | 🔴 Kritik | ✅ F8 — dünya tohumu + `seq` · sayısal kalıntı biliniyor |
| R58 | NPC kötü yatırımdan çıkamıyor (tek yönlü cırcır) | 🔴 Kritik | ✅ F8 — `shouldDivest` |
| R59 | Kıtlık ölçüsü simetrik: dolu ambar cazip görünüyor | 🔴 Kritik | ✅ F8 — yönlü `kitlik` |
| R60 | Aynı sinyale iki denetleyici: kısma + kapatma | 🔴 Kritik | ✅ F8 — çıkış kısmadan ayrıldı · şiddet R61'de geri geldi |
| R61 | Yatırım skorunun 5 teriminden 3'ü bilgi taşımıyor | 🟠 Yüksek | ⏳ eğilim + açık düzeltildi · zincir/rekabet ölçülüyor |
| R62 | "Oyuncuya yer bırak" yalnız dünya kurulumunda | 🔴 Kritik | ✅ F8 — `NPC_CAPACITY_SHARE` tek kaynak |
| R45 | Sürü hücumu: 58 NPC aynı turda yatırım kararı | 🔴 Kritik | ✅ F8 — faz dağıtımı + tur içi defter |
| R46 | Tohum denge testi kendi modelini doğruluyordu | 🟠 Yüksek | ✅ F8 — `planSlots` tek kaynak |
| R47 | ED kıtlığı görüp susuyor · marj terimi ölü | 🔴 Kritik | ✅ F8 — kıtlık tavanı + `PRICE_MARKUP_BAND` |
| R48 | Sermaye zincirin son halkasına yığılıyor | 🔴 Kritik | ✅ F8 — `strategicNeed` zincirden |
| R49 | Yatırım eşiği ulaşılabilir skorun üstünde | 🟠 Yüksek | ✅ F8 — eşik 0,55 → 0,38 |
| R50 | İlk haftanın tamamı tek ürün (ticaret kilitleri) | 🔴 Kritik | ⏳ kilitler indi, XP kapısı açık |
