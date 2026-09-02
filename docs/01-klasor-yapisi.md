# 01 — Proje Klasör Yapısı

pnpm workspace monorepo. Tek repo, çok deploy hedefi.

```
kapital/
├── apps/
│   ├── api/                    # NestJS HTTP + WebSocket (oyuncu istekleri)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       └── modules/        # bkz. madde 50 modül listesi
│   │           ├── auth/
│   │           ├── company/
│   │           ├── city/
│   │           ├── product/
│   │           ├── facility/
│   │           ├── inventory/
│   │           ├── production/
│   │           ├── market/
│   │           ├── retail/
│   │           ├── finance/
│   │           ├── loan/
│   │           ├── technology/
│   │           ├── employee/
│   │           ├── notification/
│   │           ├── ranking/
│   │           └── admin/
│   │
│   ├── worker/                 # BullMQ tüketicileri — tick motoru burada koşar
│   │   └── src/
│   │       ├── main.ts
│   │       ├── orchestrator/   # tick zamanlayıcı + faz durum makinesi
│   │       ├── phases/         # her tick fazı = ayrı processor
│   │       ├── npc/            # NpcModule runtime
│   │       └── director/       # EconomicDirectorModule runtime
│   │
│   ├── mobile/                 # Expo / React Native
│   │   └── src/
│   │       ├── app/            # expo-router
│   │       ├── features/       # ekran bazlı dikey dilimler
│   │       ├── components/
│   │       ├── api/            # generated client (openapi-typescript)
│   │       └── theme/
│   │
│   └── admin/                  # Next.js admin paneli
│       └── src/app/
│
├── packages/
│   ├── economy/                # ★ SAF EKONOMİ ÇEKİRDEĞİ — I/O YOK
│   │   └── src/
│   │       ├── formulas/       # attractiveness, quality, decay, shipping...
│   │       ├── pricing/        # ağırlıklı medyan, EMA, outlier trim
│   │       ├── production/     # reçete çözümleme, verim
│   │       ├── npc/            # NPC karar fonksiyonları (saf)
│   │       ├── director/       # market health, müdahale kararı (saf)
│   │       └── types/
│   │
│   ├── db/                     # Drizzle şema + migration + seed
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── seed/               # şehir, ürün, reçete, tesis tipi, NPC tohumları
│   │
│   ├── shared/                 # DTO, zod şemaları, hata kodları, Money/Qty tipleri
│   │
│   ├── config/                 # oyun dengesi config yükleyici + tip tanımları
│   │
│   └── sim/                    # ★ HEADLESS EKONOMİ SİMÜLASYONU (madde 55)
│       └── src/
│           ├── harness.ts      # 1000 şirket × 90 gün
│           ├── agents/         # davranış profilleri
│           └── metrics/        # CPI, Gini, volatilite, ROI raporları
│
├── docs/                       # bu klasör
├── infra/
│   ├── docker-compose.dev.yml  # postgres + redis + grafana
│   ├── grafana/
│   └── migrations-ci/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Neden `packages/economy` ayrı bir paket?

Bu, planın **en önemli tek mimari kararı**dır.

Tüm oyun dengesi formülleri (çekicilik, pazar payı, kalite bozulması, üretim
kalitesi, NPC fiyatlama, market health) **saf fonksiyon** olarak burada yaşar:

```ts
// packages/economy/src/formulas/attractiveness.ts
export function attractiveness(
  input: StoreOffer,
  ctx: MarketContext,
  cfg: ProductWeights,
): number
```

Sonuçları:

1. **`packages/sim` gerçek formülleri koşar.** Simülasyon, üretimin paralel bir
   yeniden-implementasyonu değildir → denge testi ile canlı oyun asla ayrışmaz.
   (Madde 55'in tek gerçekçi uygulama yolu budur.)
2. Formüller veritabanı olmadan mikrosaniyede unit-test edilir.
3. NPC ve Economic Director aynı formülleri okur → NPC "oyunun kurallarını bilen"
   bir ajan olur, ayrıcalıklı bir varlık değil (madde 23'ün gereği).
4. Denge değişikliği tek pakette; API ve worker'a dokunulmaz.

**Kural:** `packages/economy` içinde `import` edilebilecek şey yoktur — DB yok,
Redis yok, `Date.now()` yok, `Math.random()` doğrudan yok (seed'li RNG enjekte edilir).
Bu, tick'in **deterministik ve tekrar oynanabilir** olmasını sağlar.

## Deploy hedefleri

| Süreç | Kaynak | Ölçekleme |
|---|---|---|
| `api` | `apps/api` | Yatay, stateless, N replika |
| `worker-tick` | `apps/worker` | Yatay, shard'lı; orchestrator lider seçimi Redis lock |
| `mobile` | `apps/mobile` | EAS Build → App Store / Play |
| `admin` | `apps/admin` | Tek replika yeterli |
