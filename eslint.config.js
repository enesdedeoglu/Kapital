// @ts-check
/**
 * Kapital — ESLint 9 flat config.
 *
 * Kök `package.json`'da `"type": "module"` yok, bu yüzden bu dosya CommonJS'tir.
 * Paketlerin kendisi ESM'dir (her paketin `package.json`'ında `"type": "module"`).
 *
 * Katmanlar:
 *   1. Yoksayılanlar (derleme çıktısı, bağımlılıklar)
 *   2. JS + TypeScript taban kuralları (`strict` + `stylistic`)
 *   3. Import sıralaması — mevcut düzen: dış paketler → @kapital/* → göreli
 *   4. Proje değişmezleri: `packages/economy` saflığı (ADR-0003),
 *      NestJS açık DI token'ları (ADR-0007)
 *   5. Test dosyaları için gevşetmeler
 *
 * PRETTIER NOTU — `.prettierrc` yalnız YAPILANDIRMA olarak duruyor, mevcut
 * dosyalara toplu uygulanmadı. Ayarlar (2 boşluk, tek tırnak, 100 sütun) bu
 * kod tabanının stiliyle örtüşür, AMA Prettier'in satır kırma algoritması
 * ikili çalışır: bir liste ya tek satıra sığar ya da her öğe kendi satırına
 * düşer. Bu kod tabanı 170 yerde bilinçli "sıkışık" yazım kullanıyor —
 *
 *     import {
 *       asQty, mulQty, priceTimesQty, QTY_SCALE, ZERO_MONEY, ZERO_QTY,
 *     } from '@kapital/shared';
 *
 * `prettier --write` bunu koruyamaz: ölçüldü, 181 dosyanın 124'ünü ve ~8.400
 * satırı yeniden yazıyor. Bu yüzden `format:check` CI'a BAĞLANMADI. Biçimi
 * toptan değiştirmek ayrı ve bilinçli bir karardır: `pnpm format` hazır bekliyor.
 *
 * Tip-farkında (type-aware) kurallar BİLEREK açılmadı: `strictTypeChecked`
 * 181 dosyada tam tip bilgisi ister, lint süresini derleme mertebesine çıkarır
 * ve mevcut yeşil kod tabanında büyük bir refactor kuyruğu üretir. Tip
 * güvenliği zaten `pnpm typecheck` ile ayrı bir CI adımında denetleniyor.
 */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const prettierConfig = require('eslint-config-prettier');

/** `packages/economy` içinde yasak modüller — çekirdek I/O'suz kalmalı. */
const SAF_CEKIRDEK_YASAK_MODULLER = [
  { name: '@kapital/db', message: 'Saf çekirdek DB bilmez (ADR-0003). Veriyi context olarak geçirin.' },
  { name: '@kapital/config', message: 'Saf çekirdek config yüklemez (ADR-0003). Değerleri parametre olarak geçirin.' },
  { name: 'postgres', message: 'Saf çekirdekte veritabanı sürücüsü kullanılamaz (ADR-0003).' },
  { name: 'drizzle-orm', message: 'Saf çekirdekte ORM kullanılamaz (ADR-0003).' },
];

module.exports = tseslint.config(
  /* ---------------------------------------------------------------- */
  /* 1. Yoksayılanlar                                                  */
  /* ---------------------------------------------------------------- */
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },

  /* ---------------------------------------------------------------- */
  /* 2. Taban kurallar                                                 */
  /* ---------------------------------------------------------------- */
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,

  /* ---------------------------------------------------------------- */
  /* 3. Ortak TypeScript ayarları                                      */
  /* ---------------------------------------------------------------- */
  {
    files: ['**/*.ts'],
    plugins: { import: importPlugin },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: false } },
    },
    rules: {
      // TypeScript zaten çözülmemiş adları derlemede yakalar; ESLint'in
      // kopyası ESM/global bilgisi olmadan yanlış pozitif üretir.
      'no-undef': 'off',

      // Kullanılmayan değişkenler: `_` önekli olanlar bilinçli atlamadır
      // (destructuring ile alan düşürme, imzayı bozmayan parametre).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],

      // Import düzeni — mevcut kod tabanının fiilî sırası:
      //   node: → dış paket → @kapital/* → üst dizin → kardeş
      'import/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        pathGroups: [{ pattern: '@kapital/**', group: 'internal', position: 'before' }],
        // Varsayılan liste 'external' içerir; @kapital/* node_modules'a
        // sembolik bağlı olduğu için external sayılır ve pathGroup yok
        // sayılırdı. Bu yüzden yalnızca 'builtin' hariç tutuluyor.
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'never',
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],
      'import/no-duplicates': 'error',
      // NOT: `import/no-unresolved` kapalı — NodeNext altında göreli import'lar
      // `.js` uzantısıyla yazılır, eklentinin çözücüsü bunu `.ts` kaynağına
      // eşleyemez ve toptan yanlış pozitif üretir.

      // `noUncheckedIndexedAccess: true` açık (tsconfig.base.json): derleyici
      // HER dizi/Map erişimini `T | undefined` yapar. Kod tabanındaki 121 `!`
      // kullanımının tamamı, derleyicinin izleyemediği bir güvenceden sonra
      // gelir — `parts.length !== 6` kontrolü, `INSERT ... RETURNING id`,
      // regex eşleşmesi. Bunları çalışma zamanı kontrolüne çevirmek ölü hata
      // dalları üretir. `!` burada kaçamak değil, tsconfig'in dayattığı
      // sözdizimidir; asıl güvenceyi `noUncheckedIndexedAccess` sağlıyor.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Sessiz hata yutmayı engelle.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 4a. `packages/economy` — saf ekonomi çekirdeği (ADR-0003)         */
  /*     I/O yok, saat yok, rastgelelik yok. Zaman `tick.seq` olarak,  */
  /*     rastgelelik seed'li RNG olarak ENJEKTE edilir.                */
  /* ---------------------------------------------------------------- */
  {
    files: ['packages/economy/**/*.ts'],
    ignores: ['packages/economy/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: SAF_CEKIRDEK_YASAK_MODULLER,
        patterns: [{
          group: ['node:*', 'fs', 'path', 'crypto', 'os', 'child_process'],
          message: 'Saf çekirdek Node API kullanamaz (ADR-0003).',
        }],
      }],
      'no-restricted-properties': ['error',
        { object: 'Date', property: 'now', message: 'Saf çekirdek saati okumaz (ADR-0003). Zamanı `tick.seq` olarak geçirin.' },
        { object: 'Math', property: 'random', message: 'Saf çekirdek rastgelelik üretmez (ADR-0003). Seed\'li RNG enjekte edin.' },
        { object: 'process', property: 'env', message: 'Saf çekirdek ortam değişkeni okumaz (ADR-0003). Değeri parametre olarak geçirin.' },
      ],
      'no-restricted-syntax': ['error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Saf çekirdek saati okumaz (ADR-0003). Zamanı `tick.seq` olarak geçirin.',
        },
      ],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 4b. NestJS — her constructor bağımlılığı açık token ister         */
  /*     (ADR-0007). esbuild `design:paramtypes` üretmez; örtük        */
  /*     enjeksiyon `tsx`/`vitest` altında sessizce `undefined` verir. */
  /* ---------------------------------------------------------------- */
  {
    files: ['apps/api/**/*.ts'],
    ignores: ['apps/api/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'MethodDefinition[kind="constructor"] > FunctionExpression > TSParameterProperty:not([decorators.length>0])',
        message: 'Her constructor bağımlılığı açık `@Inject(Token)` ister (ADR-0007) — örtük enjeksiyon esbuild altında `undefined` gelir.',
      }],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 4c. NestJS modülleri — dekoratörle işaretlenmiş boş sınıflar      */
  /* ---------------------------------------------------------------- */
  {
    files: ['apps/api/**/*.module.ts', 'apps/api/src/**/*.ts'],
    rules: {
      // `@Module({...}) export class XModule {}` gövdesiz olur; bu kural
      // onu "gereksiz sınıf" sanır.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 5. Testler ve CLI betikleri — gevşetilmiş kurallar                */
  /* ---------------------------------------------------------------- */
  {
    files: ['**/*.test.ts', '**/testing/**/*.ts', '**/vitest.config.ts'],
    rules: {
      // Testler kurulum verisini bilerek daraltır: `veri!` ve `as any`
      // burada ifade gücüdür, üretimde kaçaktır.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // Testler senaryo kurarken sabit tarih/rastgelelik kullanabilir.
      'no-restricted-syntax': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    files: [
      '**/cli/**/*.ts',
      'apps/sim/**/*.ts',
      '**/main.ts',          // süreç giriş noktaları (worker, api bootstrap)
      '**/seed/**/*.ts',     // seed rutinleri: ilerleme çıktısı arayüzlerinin parçası
      'apps/worker/src/scheduler.ts', // varsayılan `onLog` geri dönüşü
    ],
    rules: {
      // Bu dosyalarda stdout çıktısı arayüzün kendisidir, kaçak log değil.
      'no-console': 'off',
    },
  },

  /* ---------------------------------------------------------------- */
  /* 6. Prettier ile çakışan biçim kurallarını kapat                   */
  /*    (en sonda olmalı — önceki katmanları ezer)                     */
  /* ---------------------------------------------------------------- */
  prettierConfig,
);
