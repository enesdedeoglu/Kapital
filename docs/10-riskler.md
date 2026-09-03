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
