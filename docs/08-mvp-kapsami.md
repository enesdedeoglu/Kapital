# 08 — MVP Kapsamı

Madde 57'deki MVP tanımı (5 şehir, 10 ürün, 6–10 tesis, piyasa, NPC, ED, mobil)
doğru bir **ilk sürüm** tanımıdır ama **ilk çalışan dilim** için hâlâ büyüktür.
Bu yüzden ikiye ayrılıyor.

---

## MVP-0 — "Domates Döngüsü" (uçtan uca kanıt)

Madde 59'daki zorunlu akışın **en küçük çalışan hali**. Amaç özellik değil, mimari
kanıtı: tick motoru + ledger + lot sistemi + perakende dağıtımı gerçekten çalışıyor mu?

| Alan | Kapsam |
|---|---|
| Şehir | **1** (İstanbul) |
| Ürün | **2** (Domates, Buğday) |
| Tesis | **1** tip (Manav) |
| Üretim | **Yok** — ürün yalnız NPC'den alınır |
| Piyasa | Yalnız **NPC satıcılar** (sabit arz, oyuncu alıcı) |
| Lojistik | Yok (tek şehir) |
| Tick fazları | P0, P3 (retail), P4 (bozulma+bakım), P5 (finans), P7 |
| NPC | 5 basit satıcı NPC, sabit fiyat bandı |
| ED | Yok |
| Mobil | Tek ekran: nakit + stok + fiyat girişi + son tur raporu |

**Çıkış kriteri (kabul testi):**
```
✓ Kullanıcı kayıt olur, şirket kurar (30.000 ₺)
✓ İstanbul'da manav açar
✓ NPC'den 200 kg domates alır → nakit düşer, lot oluşur
✓ Satış fiyatı 22 ₺ olarak belirler
✓ Tick koşar → NPC tüketiciler alır → nakit artar
✓ Kâr raporunu görür
✓ Değişmez testleri I1–I8 geçer
✓ Kilitleme testleri T1–T6 geçer
```

Bu akış çalışmadan **hiçbir ileri özelliğe geçilmez** (madde 59 son paragrafın gereği).

---

## MVP-1 — İlk oynanabilir sürüm (kapalı beta)

Madde 57'nin tam karşılığı + planlama sırasında eklenen zorunluluklar.

### Kapsam İÇİNDE

| Alan | Kapsam |
|---|---|
| Şehir | 5 — İstanbul, Ankara, İzmir, Konya, Bursa |
| Ürün | **10** — Buğday, Un, Ekmek, Domates, Tütün, Sigara, Demir, Kömür, Çelik, Mobilya |
| Tesis | **13 tip**: Manav, Büfe, Market · Buğday Tarlası, Sebze Bahçesi, Tütün Tarlası, Orman İşletmesi · Demir Madeni, Kömür Madeni · Değirmen, Fırın, Çelik Fabrikası · **Liman** (yalnız İST/İZM/BRS) |
| Zincir | Buğday→Un→Ekmek · Tütün→Sigara · Demir+Kömür→Çelik · (Mobilya = ithal/NPC) |
| Piyasa | Oyuncu↔Oyuncu + Oyuncu↔NPC, BUY/SELL emirleri, min_quality |
| Lojistik | Mesafe maliyeti **+ transit süresi** (shipments) |
| Perakende | Şehir talebi, çekicilik, pazar payı, yeniden dağıtım |
| Kalite | Lot bazlı, üretim kalitesi formülü, bozulma |
| NPC | ~60 NPC / ~150 tesis (250 değil — bkz. gerekçe) |
| ED | Market health + 5 direktif kaldıracı + SYS_RESERVE |
| Finans | Ledger, tesis bazlı P&L, offline rapor |
| **Krediler** | **Dahil** — `SYS_BANK`, şirket değerine bağlı limit, kademeli temerrüt |
| **Döviz** | Cüzdan · model kur · **dış ticaret** (ithalat/ihracat, Liman, Lv7) — `12-doviz-mekanigi.md` |
| Seviye | **Lv 1–12** (veri odaklı, sonradan genişletilir) |
| Mobil | 5 sekme, tam akış |
| Admin | Config editörü + ekonomi dashboard |
| Simülasyon | `packages/sim` 1000 şirket × 90 gün |

### Kapsam DIŞINDA (bilinçli erteleme)

| Özellik | Neden ertelendi | Ne zaman |
|---|---|---|
| Kalan 30 ürün | Zincir derinliği önce dengelenmeli | F11 |
| **Çalışanlar** (madde 38) | `staff_score` sabiti aynı formül terimini besliyor → sonradan eklenmesi formül değişikliği gerektirmez | F11 |
| **Teknoloji/AR-GE** (39) | `technology_bonus` alanı şemada var, değeri 0 | F11 |
| Seviye 13–30 | `company_levels` tablosuna satır eklemek yeterli | Sürekli |
| Push bildirim | Önce uygulama içi bildirim akışı | F10 |
| Arsa (land) ayrı varlık | Tesis değerine dahil edildi | F11 |
| Holding / şirket birleşmesi | Lv28 özelliği | F11 |

### NPC sayısı neden 250 değil 60?

Madde 23'te 250 NPC / 600 tesis öneriliyor — bu **40 ürünlük** ekonomi için doğru.
MVP-1'de 10 ürün × 5 şehir = 50 pazar var. 60 NPC / 150 tesis ile:
- her ürün×şehir pazarında ortalama 3 satıcı → fiyat oluşumu anlamlı
- tick süresi bütçe içinde kalır
- denge ayarı yapılabilir kalır (250 NPC'nin davranışını gözlemlemek zordur)

NPC sayısı `game_configs` üzerinden ayarlıdır; ürün sayısı arttıkça **otomatik**
ölçeklenir: `hedef_npc = ürün_sayısı × şehir_sayısı × 1.2`.

---

## Başlangıç değerleri (madde 4)

```
Nakit           30.000 ₺
Şirket değeri   30.000 ₺
Seviye          1
Borç            0
İlk tesis       Manav | Büfe (seçmeli)
```

### Onboarding görev zinciri
```
1. Şehir seç                      → +50 XP
2. Manav aç                       → +100 XP
3. Piyasadan 200 kg domates al    → +100 XP
4. Satış fiyatı belirle           → +50 XP
5. İlk turu bekle (geri sayım)    → —
6. İlk satışını yap               → +200 XP
7. İlk kâr raporunu gör           → +200 XP  → Lv2
```
Uzun metin yok; her adım tek cümle + hedef vurgusu.

---

## Ekonomi hedefleri (madde 56, MVP-1 çıkış kriteri)

`packages/sim` ile doğrulanır. Bu eşikler tutmadan kapalı beta açılmaz:

| Metrik | Hedef |
|---|---|
| Supply / Demand (çoğu ürün) | 0.85 – 1.15 |
| Normal fiyat volatilitesi (24s) | ±%5 – 15 |
| Launch NPC payı | %60 – 80 |
| İlk gün aktif oyuncu şirket büyümesi | %10 – 30 |
| 1. hafta sonu şirket değeri (30k başlangıç) | 100.000 – 250.000 ₺ |
| Para arzı 90 günlük değişim | ±%40 içinde (kaçak enflasyon yok) |
| 90 günde iflas oranı (aktif oyuncu) | < %15 |
| Kredi kaynaklı para arzı artışı | < %20 (toplam para arzının) |
| Kur 90 günlük değişim | ±%25 içinde |
| Dış ticaret kaynaklı para girişi / toplam musluk | < %30 |
| Yurt içi fiyatın dış ticaret bandına yapışma oranı | < %20 tur |
| Tick p95 süresi | < 60 sn |
