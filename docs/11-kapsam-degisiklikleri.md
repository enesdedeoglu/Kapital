# 11 — Kapsam Değişiklikleri: Eklenecek / Çıkarılacak / Değiştirilecek

Kullanıcının isteği: *"eklenecek veya çıkarılacak yerleri hesap edebilirsin"*.
Bu doküman, orijinal spesifikasyona göre **önerilen sapmaları** ve gerekçelerini içerir.
Her madde ayrı ayrı onay/ret bekliyor.

---

## A. EKLENMESİ ZORUNLU (spec'te yoktu, olmadan sistem çalışmaz)

### A1. `ledger_entries` — çift taraflı kayıt defteri 🔴
Madde 34/35 "para arzını sürekli ölç" diyor ama tablo listesinde (madde 49) defter yok.
`companies.cash` tek başına para arzını **doğrulayamaz** — sadece raporlar.
Ledger olmadan "para nereden geldi, nereye gitti" sorusu cevapsız, R5 (yuvarlama sapması)
tespit edilemez.
**Karar: Ekle. F0'da.**

### A2. `SYS_CONSUMER` / `SYS_SINK` / `SYS_RESERVE` sistem şirketleri 🔴
Para musluğunun ve giderinin bir karşı tarafı olmalı. Aksi halde ledger dengelenmez.
`SYS_RESERVE` ayrıca ED'nin acil müdahalesini (madde 32) ekonomi kurallarının
**içinde** tutar — sistemin "hile yapması" gerekmez.
**Karar: Ekle. F0'da.**

### A3. `shipments` — sevkiyat transit süresi ✅ *(onaylandı: 2 Eylül 2026)*
Madde 17'de lojistik yalnız **maliyet**. Bu durumda mesafe bir vergiden ibaret kalır ve
"şehirler arası ticaret stratejik olmalıdır" hedefi karşılanmaz.
`city_distances.transit_ticks` ile mesafe **hem maliyet hem gecikme** olur:
yakın tedarikçi pahalı ama hızlı, uzak tedarikçi ucuz ama 3 tick sonra gelir.
Bu tek ekleme lojistiği gerçek bir stratejik karara dönüştürür.
Ayrıca `reserved_quantity` ile birlikte "aynı stok iki kez satıldı" hatasını da kapatır.

**Karar: onaylandı, F4'te.** Ek süre yok — F4'ün 2,5 haftası zaten sevkiyatı içeriyordu.

### A4. `demand_budget` + `reservation_price_mult` 🔴
Bkz. `10-riskler.md` R10. **Bu olmadan oyun sınırsız para basar.** Tartışmasız.
**Karar: Ekle. F2'de.**

### A5. `idempotency_keys` 🟠
Mobilde çift dokunma ve ağ retry gerçek. Bunsuz oyuncu bir tesisi iki kez satın alır.
**Karar: Ekle. F0'da.**

### A6. `game_configs` (versiyonlu) + `admin_audit_log` 🟠
Madde 47 "kod deploy etmeden değiştirilebilir" diyor ama config için tablo yok.
Versiyonsuz config, koşan tick'i bozar (R12).
**Karar: Ekle. F0'da.**

### A7. `tick_phase_runs` + `outbox` 🟠
Tick durum makinesi ve bildirim teslimi. Idempotency ve "tick içinde push gönderme"
yasağının uygulama noktası.
**Karar: Ekle. F0/F2'de.**

### A8. Partitioning + saklama politikası 🔴
Bkz. R7. Şemaya sonradan partition eklemek **çok pahalıdır** (tablo yeniden yazımı).
İlk migration'da yapılmalı.
**Karar: Ekle. F0'da.**

### A9. `trade_flags` + endeks dışı bırakma 🟡
Madde 48'in uygulanabilir hali.
**Karar: Ekle. F4'te.**

### A10. `npc_directives` 🟠
Madde 28'in "iki sistem kesinlikle ayrı" şartını **mimari olarak zorlayan** tek mekanizma.
ED'nin NPC'ye tek yazma kanalı.
**Karar: Ekle. F7'da.**

### A11. Catch-up politikası 🟡
Worker düşerse ne olacağı spec'te tanımsız. Tanımsız bırakılırsa üretimde
"8 tick birden koştu, ekonomi patladı" olayı yaşanır.
**Karar: Ekle. F2'de (`05-economic-tick.md` §5).**

### A12. Deterministik seed'li RNG 🟡
Madde 53 "idempotent tasarla" diyor. `Math.random()` ile idempotency **imkânsızdır**.
**Karar: Ekle. F2'de.**

---

## B. ÇIKARILMASI ÖNERİLENLER

### B1. `companies.usd_balance` — **KALIYOR** ✅ *(karar: 2 Eylül 2026)*

İlk öneri çıkarmaktı: spec'in hiçbir yerinde kullanılmıyordu ve iki para birimi defter
hesaplarını, para arzı ölçümünü ve arbitraj yüzeyini ikiye katlıyordu.

**Proje sahibinin kararı: kalsın, döviz mekaniği planlanacak.** Öneri geri çekildi.

Kararın maliyeti kabul edilebilir kılınacak şekilde sınırlandı — **tek şart: USD yurt içi
fiyatlamaya sızmayacak.** USD yalnızca cüzdan, kur işlemi ve dış ticarette görünür;
`market_orders`, `retail_offers`, maaş, kredi ve tüm endeksler ₺ kalır. Bu şart tutulursa
etki 3 tablo; tutulmazsa ~20 tablo ve her fiyat formülü.

Şemaya eklenenler: `currency_t` enum, `ledger_entries.currency`, `fx_rates`, `fx_trades`,
dördüncü sistem şirketi `SYS_FX`. Değişmez I1 artık para birimi başına koşuyor.

Kararın beklenmedik bir faydası çıktı: ithalat kotası, Economic Director'a
`SYS_RESERVE`'den **daha tutarlı** bir acil kaldıraç veriyor — arz krizinde sistem stok
yaratmaz, ithalat açılır. Ayrıntı ve tasarımın cevaplaması gereken 5 soru:
`12-doviz-mekanigi.md`.

**Ek süre: ~1,5 hafta.** Kapalı beta 19 → ~20,5 hafta.

### B2. Çalışan sistemi (madde 38) — F11'a ertele 🟡
Çalışan havuzu, işe alma UI'ı, maaş pazarlığı, uzmanlık eşleştirme = başlı başına
bir alt sistem. Formüldeki katkısı tek bir terim: `employee_score × 0.10`.

`facilities.staff_score` alanı **şimdi** eklenir (varsayılan 0.5), formül **şimdi**
yazılır. F11'da çalışanlar gerçek değeri besler. **Formül değişikliği gerekmez.**
**Karar: Ertele, alanı şimdi ekle.**

### B3. Teknoloji/AR-GE (madde 39) — F11'a ertele 🟡
Aynı mantık: `facilities.technology_bonus` alanı var, değeri 0. Formül hazır.
**Karar: Ertele, alanı şimdi ekle.**

### B4. Krediler — **MVP-1'DE** ✅ *(karar: 2 Eylül 2026)*

İlk öneri F10'a ertelemekti: kredi + iflas kendi UX akışını gerektiriyor ve MVP oyuncusu
30.000 ₺ ile başlayıp ilk hafta 100–250k'ya çıktığı için krediye ihtiyacı yok.

**Proje sahibinin kararı: MVP-1'de olsun.** Öneri geri çekildi — ve bu karar planı
iyileştiriyor:

> F8'in çıkış kriterlerinden biri *"90 günde iflas oranı < %15"*. **Kredi yoksa oyunda
> iflas mekanizması da yok** — bu metrik ölçülemez ve denge simülasyonu eksik kalır.

Bu yüzden krediler F10'dan alınıp **denge kapısının önüne**, yeni **F5** fazına konuldu.
Kredi bir para musluğu olduğu için (R15) simülasyonun onu görmesi zorunlu.

Şemaya eklenenler: beşinci sistem şirketi `SYS_BANK`, `loan_terms` tablosu (limit ve faiz
kod içine gömülmez), `loans` tablosuna `company_value_at_open` · `leverage_at_open` ·
`defaulted_at_tick`.

Getirdiği iki yeni risk: **R15** (kredi anaparası para yaratır) ve **R16** (kredi yeni
oyuncuyu oyundan atar — madde 40'ın açıkça uyardığı şey).

**Ek süre: +1,5 hafta kritik yola, −0,5 hafta F10'dan.**

### B5. Seviye 13–30 — veri olarak sonra 🟢
30 seviyenin **tasarımı** yapılır (`company_levels` tablosuna satır), ama MVP-1'de
yalnız 1–12 aktif. Seviye 20'nin (elektronik) çalışması için 8 yeni ürün + 6 yeni
tesis + 5 reçete gerekir.
**Karar: Lv1–12 MVP-1, gerisi F11.**

### B6. 250 NPC → 60 NPC (MVP-1'de) 🟢
10 ürün × 5 şehir = 50 pazar için 250 NPC gereksiz; denge ayarını da zorlaştırır.
Formül: `hedef_npc = ürün_sayısı × şehir_sayısı × 1.2`. 40 ürüne çıkınca otomatik 240 olur.
**Karar: Config'e bağla, MVP-1'de 60.**

### B7. 40 ürün → 10 ürün (MVP-1) 🟢
Zaten madde 57'de siz de öyle diyorsunuz. Burada sadece teyit: **10 üründe kalın.**
Fiyat dengesi 10 üründe ayarlanamıyorsa 40 üründe hiç ayarlanamaz.

### B8. Arsa (land) ayrı varlık — çıkar 🟢
Madde 41'de şirket değerinde "land" geçiyor ama arsa satın alma/satma mekaniği yok.
`cities.land_cost_index` zaten tesis kurulum maliyetini etkiliyor.
**Karar: Tesis değerine dahil et, ayrı varlık yapma.**

### B9. Push bildirim — F10'a ertele 🟢
Uygulama içi bildirim akışı MVP'de yeterli. Push, APNs/FCM sertifikaları + izin akışı
+ spam kontrolü demek.
**Karar: F10.**

---

### B10. Mobilya — tesis tipi ve reçete eklendi 🟠 *(F6, 3 Eylül 2026)*
Spec'te FURNITURE bir perakende ürünü olarak listeliydi ve referans fiyatı vardı,
ama onu üretecek ne bir tesis tipi ne bir reçete tanımlıydı. Zincirin ucu açıktı:
çelik üretiliyor, alıcısı olmadığı için depoya yığılıyordu.

`FURNITURE_FACTORY` tesis tipi ve `10 kg çelik → 1 mobilya` reçetesi eklendi.
Zincir artık maden → çelik → mobilya olarak üç aşamalı; bu aynı zamanda R19'un
(derin zincirde kalite çöküşü) F8'de ölçülebileceği en derin yol.

**Karar: eklendi.** Alternatifi ürünü listeden çıkarmaktı; spec'in ürün ağacını
kısaltmak yerine tamamlamayı tercih ettim.

---

### C6. Tohum referans fiyatları yeniden dengelendi 🟠 *(F6, 3 Eylül 2026)*
Spec'in ürün tablosundaki referans fiyatlar, benim yazdığım tariflerin maliyet
yapısıyla tutarsızdı. En uç örnek sigara: referans 80 ₺, tarif maliyeti 1,95 ₺.
500 turluk koşuda piyasa sigarayı 5,06 ₺'ye indirdi ve tek başına Game CPI'yı
1,00'dan 0,53'e çekti.

Referans fiyat bir tasarım sabiti değil, fiyat keşfinin **başlangıç çıpasıdır**.
Yanlış çıpa, yüzlerce turluk sahte bir deflasyon üretir ve her ölçümü kirletir.

Değişenler: buğday 10→8 ₺, un 16→22 ₺, demir 28→24 ₺, kömür 18→14 ₺. Tüketiciye
dönük fiyatlar (ekmek 15, domates 15, sigara 80) **korundu** — bunlar gerçekçi
Türkiye fiyatları ve spec'in kasıtlı çıpaları. Tutarlılık, işçilik/enerji ve
verim değerleri değiştirilerek sağlandı (ekmek 1 kg un → 4 somun; sigara 8 kg
tütün → 20 paket, işçilik paket başına 47,25 ₺ — gerçekte de paket fiyatının
büyük kısmı işleme ve vergidir).

`seed-data.test.ts` her tarif için `referans ÷ birim_maliyet` oranını **1,15–1,75**
bandında tutar. Bant tutarlılığı garanti eder, *isabetliliği* değil: talep
esneklikleri ve kapasitelerin nihai ayarı F8 simülasyon kapısında yapılacak.

**Karar: dengelendi.**

---

## C. DEĞİŞTİRİLMESİ ÖNERİLENLER

### C1. Tick adım sırası: üretim ↔ piyasa ilişkisi netleşmeli 🟠
Madde 53'te sıra: tarım(3) → maden(5) → **piyasa emirleri(6)** → fabrika(7).

Bu şu anlama gelir:
- Bu tick alınan hammadde, **bu tick** fabrikada kullanılabilir ✅
- Bu tick üretilen mal, **ancak sonraki tick** satılabilir ⏱

Bu tutarsız değil, ama **bilinçli bir 1 tick boru hattı gecikmesi**dir ve
dokümante edilmezse "bug" olarak raporlanır.
**Karar: Sırayı koru, davranışı dokümante et.** (`05-economic-tick.md` §2)

### C2. `market_orders` fiyat eşleşmesinde nakliye 🟠
Madde 16 doğru: alıcı için gerçek maliyet `fiyat + nakliye`. Ama eşleşme kuralı
belirsiz. Netleştirme:
```
eşleşir ⟺ sell.price + shipping(sell.city → buy.city) ≤ buy.price
```
Yani **alıcının verdiği fiyat, nakliye dahil tavan fiyattır.** UI'da "Maksimum toplam
maliyet" olarak gösterilir. Bu, uzak satıcının otomatik elenmesini sağlar.
**Karar: Eşleşme kuralını böyle sabitle.**

### C3. Şirket değerinde stok değerlemesi 🟡
Madde 41 doğru (piyasa medyanı). Ek kısıt: **likidite iskontosu.**
Bir şirketin stoğu o ürünün 24 saatlik toplam hacminin %20'sini aşıyorsa, aşan kısım
%50 iskontoyla değerlenir. Aksi halde bir oyuncu tüm piyasayı stoklayıp şirket
değerini yapay olarak şişirir ve sıralamayı ele geçirir.
**Karar: Ekle.**

### C4. Seviye atlama kriterleri 🟡
Madde 42 "sadece para transferi ile kasılamamalı" diyor. Somut kriter:
`company_levels` tablosunda **5 ayrı eşik** (XP, şirket değeri, ticaret hacmi,
üretilen birim, farklı ürün sayısı) ve **hepsi** sağlanmalı (AND, OR değil).
Böylece zengin bir arkadaştan para almak tek başına seviye atlatmaz.
**Karar: 5 kriterli AND koşulu.**

### C5. `economicCycle` çarpanı tanımsız 🟡
Madde 19'da formülde var ama nereden geldiği yazmıyor. Öneri:
sinüzoidal iş çevrimi, periyot = 1 oyun yılı (2688 tick), genlik ±%12,
`game_configs`'ten ayarlanır. Böylece ekonomide öngörülebilir ama etkili
bir "canlanma/durgunluk" ritmi olur.
**Karar: Böyle tanımla.**

### C6. `condition` (tesis aşınması) mekaniği tanımsız 🟢
Şemada var, davranışı yok. Öneri: tick başına -0.05 aşınma, kapasiteyi
`condition/100` oranında etkiler, bakım harcamasıyla onarılır.
`condition < 30` → `ProductionHalted`.
**Karar: Böyle tanımla, F3'te uygula.**

### C7. `reputation` nasıl değişir? 🟢
Madde 20'de marka skorunu besliyor ama kaynağı tanımsız. Öneri:
```
+ satış hacmi ve süreklilik      (yavaş artış, tavan 100)
+ yüksek kaliteli ürün satışı
− stok tükenmesi (mağaza boş kaldı)
− emir iptali / teslim edilmeyen satış
doğal gerileme: her tick ortalamaya %0.1 yaklaşır
```
**Karar: Böyle tanımla, F4'te uygula.**

---

## D. Özet karar tablosu

| Kod | Konu | Öneri | Faz | Şiddet |
|---|---|---|---|---|
| A1 | Ledger defteri | **Ekle** | F0 | 🔴 |
| A2 | Sistem şirketleri | **Ekle** | F0 | 🔴 |
| A4 | Talep bütçesi + rezervasyon fiyatı | **Ekle** | F2 | 🔴 |
| A8 | Partitioning | **Ekle** | F0 | 🔴 |
| A3 | Sevkiyat transit süresi | **Ekle** — onaylandı | F4 | ✅ |
| A5 | Idempotency anahtarları | **Ekle** | F0 | 🟠 |
| A6 | Versiyonlu config | **Ekle** | F0 | 🟠 |
| A7 | Faz durum makinesi + outbox | **Ekle** | F0/F2 | 🟠 |
| A10 | NPC direktifleri | **Ekle** | F7 | 🟠 |
| A9 | Ticaret bayrakları | **Ekle** | F4 | 🟡 |
| A11 | Catch-up politikası | **Ekle** | F2 | 🟡 |
| A12 | Seed'li RNG | **Ekle** | F2 | 🟡 |
| B1 | `usd_balance` | ~~Çıkar~~ → **Kalıyor** (döviz planlanacak) | F0 | ✅ |
| B2 | Çalışanlar | Ertele (alan kalsın) | F11 | 🟡 |
| B3 | Teknoloji | Ertele (alan kalsın) | F11 | 🟡 |
| B4 | Krediler | ~~Ertele~~ → **MVP-1, yeni F5** | F5 | ✅ |
| B5 | Seviye 13–30 | Ertele (veri) | F11 | 🟢 |
| B6 | NPC sayısı 250→60 | Değiştir | F6 | 🟢 |
| B8 | Arsa ayrı varlık | Çıkar | — | 🟢 |
| B9 | Push bildirim | Ertele | F10 | 🟢 |
| C1 | Tick sırası davranışı | Dokümante et | F2 | 🟠 |
| C2 | Nakliye dahil eşleşme | Netleştir | F4 | 🟠 |
| C3 | Likidite iskontosu | Ekle | F4 | 🟡 |
| C4 | 5 kriterli seviye | Netleştir | F1 | 🟡 |
| C5 | `economicCycle` tanımı | Tanımla | F2 | 🟡 |
| C6 | `condition` mekaniği | Tanımla | F3 | 🟢 |
| C7 | `reputation` mekaniği | Tanımla | F4 | 🟢 |

**Karara bağlananlar (2 Eylül 2026):**

| # | Konu | Karar | Etkisi |
|---|---|---|---|
| B1 | `usd_balance` | **Kalıyor** — döviz mekaniği tasarlanacak | +2,5 hafta · 4 yeni tablo |
| A3 | Lojistik transit süresi | **Ekleniyor** — F4 | Ek süre yok |
| B4 | Krediler | **MVP-1'de** — yeni F5, denge kapısı öncesi | +1,5 hafta · `SYS_BANK` · R15, R16 |
| S1 | USD ne işe yarar | **Dış ticaret** (ithalat/ihracat) | Liman tesisi · `world_market` |
| S2 | Kuru kim belirler | **Model** — PPP çıpası + ticaret dengesi | `fx_rates`, tur ±%0,5 |
| S3 | Para arzı etkisi | Fiyatı oyuncu belirlemez · derinlik tavanı | R17 kapandı |
| S4 | Kur riski | %1,5 spread → `SYS_SINK` · Lv7 kilidi | Şirket değerine USD girer |
| S5 | Director'ın rolü | **`IMPORT_QUOTA`** altıncı kaldıraç | `SYS_RESERVE` son çareye çekildi |

**Açık karar kalmadı.** Planlama tamamlandı; `docs/09-roadmap.md` F0 ile kod yazımına
başlanabilir.

**Güncel tahmin: kapalı betaya ~22,5 hafta.**

### Kararların getirdiği iki yeni risk
- **R18** — dış ticaret bandı yurt içi fiyat keşfini boğabilir. R10'un tersi yönde bir hata:
  biri ekonomiyi şişirir, diğeri dondurur. Azaltım: bandın geniş tutulması (×0,75 / ×1,35)
  ve nihai perakende ürünlerinin ithal edilememesi.
- **R17** — ihracat musluğu; fiyatın sabit ve derinliğin tavanlı olmasıyla kapatıldı.
