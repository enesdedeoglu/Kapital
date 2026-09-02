# ADR-0007: NestJS'te açık `@Inject()` token'ları

**Durum:** Kabul edildi · **Tarih:** 2026-09-02 · **Faz:** F0

## Bağlam
NestJS'in varsayılan bağımlılık enjeksiyonu, TypeScript'in `emitDecoratorMetadata`
ile ürettiği `design:paramtypes` verisine dayanır. **esbuild bu metadata'yı üretmez** —
`tsx` ve `vitest` esbuild kullanır. Sonuç sessizdir ve teşhisi zordur: tüm
bağımlılıklar `undefined` gelir, uygulama açılır, her istek 500 döner.

Bu, F0 sırasında gerçekten yaşandı: `JwtGuard`'da `Reflector` `undefined`'dı.

## Karar
**Her constructor bağımlılığı açık token ile verilir:**

```ts
constructor(
  @Inject(SQL) private readonly sql: Sql,
  @Inject(JwtService) private readonly jwt: JwtService,
) {}
```

Sınıf tipine dayalı örtük enjeksiyon kullanılmaz.

## Sonuçlar
- ✅ Uygulama `tsc`, `tsx`, `vitest` ve herhangi bir paketleyici altında aynı çalışır
- ✅ Testler üretim derlemesine gerek kalmadan koşar
- ✅ Bağımlılıklar okurken görünür
- ⚠️ Biraz daha uzun yazım; kural `app.module.ts` başında not edilmiştir
