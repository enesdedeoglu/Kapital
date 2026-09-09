import { validateProductGraph } from '@kapital/economy';
import {
  asMoney, deterministicUuid, divRoundHalfEven, InvariantViolation, money, qty,
  SYSTEM_COMPANIES, SYSTEM_COMPANY_CODES,
} from '@kapital/shared';
import { createSql, type Sql } from '../client.js';
import * as d from './data.js';

/** Tekrar çalıştırılabilir (idempotent): var olan satırları günceller, yenisini ekler. */
export async function seed(sql: Sql, opts: { quiet?: boolean } = {}): Promise<void> {
  const log = (m: string) => { if (!opts.quiet) console.log('  ' + m); };

  await sql.begin(async (tx) => {
    // 1) Şehirler ------------------------------------------------------------
    for (const c of d.cities) {
      await tx`
        INSERT INTO cities (id, code, name, population_index, income_index, land_cost_index,
                            industrial_bonus, agriculture_bonus, consumer_demand_index,
                            logistics_modifier, has_port)
        VALUES (${c.id}, ${c.code}, ${c.name}, ${c.populationIndex}, ${c.incomeIndex},
                ${c.landCostIndex}, ${c.industrialBonus}, ${c.agricultureBonus},
                ${c.consumerDemandIndex}, ${c.logisticsModifier}, ${c.hasPort})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, population_index = EXCLUDED.population_index,
          income_index = EXCLUDED.income_index, land_cost_index = EXCLUDED.land_cost_index,
          industrial_bonus = EXCLUDED.industrial_bonus,
          agriculture_bonus = EXCLUDED.agriculture_bonus,
          consumer_demand_index = EXCLUDED.consumer_demand_index,
          logistics_modifier = EXCLUDED.logistics_modifier, has_port = EXCLUDED.has_port`;
    }
    // Mesafeler simetriktir; kendine mesafe 0.
    for (const c of d.cities) {
      await tx`INSERT INTO city_distances (origin_city_id, destination_city_id, distance_index, transit_ticks)
               VALUES (${c.id}, ${c.id}, 0, 0)
               ON CONFLICT (origin_city_id, destination_city_id) DO NOTHING`;
    }
    for (const [a, b, dist, ticks] of d.cityDistances) {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        await tx`INSERT INTO city_distances (origin_city_id, destination_city_id, distance_index, transit_ticks)
                 VALUES (${from}, ${to}, ${dist}, ${ticks})
                 ON CONFLICT (origin_city_id, destination_city_id)
                 DO UPDATE SET distance_index = EXCLUDED.distance_index,
                               transit_ticks  = EXCLUDED.transit_ticks`;
      }
    }
    log(`${d.cities.length} şehir · ${d.cityDistances.length * 2 + d.cities.length} mesafe`);

    // 2) Ürünler -------------------------------------------------------------
    for (const c of d.productCategories) {
      await tx`INSERT INTO product_categories (id, code, name, price_weight, quality_weight, brand_weight)
               VALUES (${c.id}, ${c.code}, ${c.name}, ${c.priceWeight}, ${c.qualityWeight}, ${c.brandWeight})
               ON CONFLICT (id) DO UPDATE SET
                 price_weight = EXCLUDED.price_weight, quality_weight = EXCLUDED.quality_weight,
                 brand_weight = EXCLUDED.brand_weight`;
    }
    for (const p of d.products) {
      await tx`
        INSERT INTO products (id, code, name, category_id, unit, base_reference_price, base_demand,
                              price_sensitivity, quality_sensitivity, brand_sensitivity,
                              shelf_life_ticks, quality_decay_rate, weight_per_unit, unlock_level,
                              is_raw_material, is_intermediate, is_retail_product)
        VALUES (${p.id}, ${p.code}, ${p.name}, ${p.categoryId}, ${p.unit}, ${money(p.price)},
                ${p.demand}, ${p.priceSens}, ${p.qualSens}, ${p.brandSens}, ${p.shelfLife},
                ${p.decay}, ${p.weight}, ${p.unlock}, ${p.raw}, ${p.inter}, ${p.retail})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, base_reference_price = EXCLUDED.base_reference_price,
          base_demand = EXCLUDED.base_demand, price_sensitivity = EXCLUDED.price_sensitivity,
          quality_sensitivity = EXCLUDED.quality_sensitivity,
          brand_sensitivity = EXCLUDED.brand_sensitivity,
          shelf_life_ticks = EXCLUDED.shelf_life_ticks,
          quality_decay_rate = EXCLUDED.quality_decay_rate,
          weight_per_unit = EXCLUDED.weight_per_unit, unlock_level = EXCLUDED.unlock_level`;
    }
    // Dünya fiyatı USD'de çıpalanır: base_price_usd = ₺ fiyat / kur_0 (docs/12 §3.1)
    for (const w of d.worldMarket) {
      const product = d.products.find((p) => p.id === w.productId)!;
      // Bölme bigint uzayında yapılır: 10 ₺ / 35 = 0,2857142857… float'ta kayıp verir.
      const usd = asMoney(divRoundHalfEven(money(product.price), BigInt(d.FX_RATE_0)));
      await tx`INSERT INTO world_market (product_id, importable, exportable, base_price_usd)
               VALUES (${w.productId}, ${w.importable}, ${w.exportable}, ${usd})
               ON CONFLICT (product_id) DO UPDATE SET
                 importable = EXCLUDED.importable, exportable = EXCLUDED.exportable,
                 base_price_usd = EXCLUDED.base_price_usd`;
    }
    log(`${d.productCategories.length} kategori · ${d.products.length} ürün · ${d.worldMarket.length} dünya piyasası kaydı`);

    // 3) Tesisler ------------------------------------------------------------
    for (const f of d.facilityTypes) {
      await tx`
        INSERT INTO facility_types (id, code, name, category, base_cost, base_capacity,
                                    maintenance_cost, storage_capacity, construction_ticks,
                                    unlock_level, requires_port)
        VALUES (${f.id}, ${f.code}, ${f.name}, ${f.category}::facility_cat, ${money(f.cost)},
                ${f.capacity}, ${money(f.maintenance)}, ${qty(f.storage)}, ${f.ticks},
                ${f.unlock}, ${f.port})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, base_cost = EXCLUDED.base_cost,
          base_capacity = EXCLUDED.base_capacity, maintenance_cost = EXCLUDED.maintenance_cost,
          storage_capacity = EXCLUDED.storage_capacity,
          construction_ticks = EXCLUDED.construction_ticks, unlock_level = EXCLUDED.unlock_level,
          requires_port = EXCLUDED.requires_port`;
    }
    for (const [level, mult] of d.facilityLevelCurve) {
      await tx`INSERT INTO facility_level_curve (level, capacity_multiplier) VALUES (${level}, ${mult})
               ON CONFLICT (level) DO UPDATE SET capacity_multiplier = EXCLUDED.capacity_multiplier`;
    }

    // 4) Reçeteler -----------------------------------------------------------
    for (const r of d.recipes) {
      const ft = d.facilityTypes.find((f) => f.code === r.facilityCode)!;
      const out = d.products.find((p) => p.code === r.outputCode)!;
      const [row] = await tx<{ id: number }[]>`
        INSERT INTO production_recipes (facility_type_id, output_product_id, output_quantity,
                                        cycle_ticks, labor_cost, energy_cost, unlock_level)
        VALUES (${ft.id}, ${out.id}, ${qty(r.outputQty)}, ${r.cycleTicks},
                ${money(r.labor)}, ${money(r.energy)}, ${r.unlock})
        ON CONFLICT (facility_type_id, output_product_id) DO UPDATE SET
          output_quantity = EXCLUDED.output_quantity, cycle_ticks = EXCLUDED.cycle_ticks,
          labor_cost = EXCLUDED.labor_cost, energy_cost = EXCLUDED.energy_cost
        RETURNING id`;
      await tx`DELETE FROM recipe_inputs WHERE recipe_id = ${row!.id}`;
      for (const input of r.inputs) {
        const ip = d.products.find((p) => p.code === input.code)!;
        await tx`INSERT INTO recipe_inputs (recipe_id, product_id, quantity, min_quality)
                 VALUES (${row!.id}, ${ip.id}, ${qty(input.qty)}, ${input.minQuality ?? 0})`;
      }
    }
    log(`${d.facilityTypes.length} tesis tipi · ${d.recipes.length} reçete`);

    // 4b) ★ Ürün grafı doğrulaması — değişmez I8, risk R13.
    //     Döngülü reçete (Çelik → Motor → Çelik) üretim fazını sonsuz döngüye
    //     sokar. Seed ve CI'da yakalanır; bozuk graf hiç yazılmaz.
    await assertProductGraph(tx as unknown as Sql);

    // 5) Kredi şartları ve seviyeler ------------------------------------------
    for (const t of d.loanTerms) {
      await tx`INSERT INTO loan_terms (level_min, leverage_ratio, interest_rate, max_term_ticks, default_after_missed)
               VALUES (${t.levelMin}, ${t.leverageRatio}, ${t.interestRate}, ${t.maxTermTicks}, ${t.defaultAfterMissed})
               ON CONFLICT (level_min) DO UPDATE SET
                 leverage_ratio = EXCLUDED.leverage_ratio, interest_rate = EXCLUDED.interest_rate,
                 max_term_ticks = EXCLUDED.max_term_ticks`;
    }
    for (const l of d.companyLevels) {
      await tx`INSERT INTO company_levels (level, required_xp, required_company_value,
                                           required_trade_volume, required_units_produced,
                                           required_distinct_products, title)
               VALUES (${l.level}, ${l.xp}, ${money(l.value)}, ${money(l.volume)},
                       ${qty(l.units)}, ${l.products}, ${l.title})
               ON CONFLICT (level) DO UPDATE SET
                 required_xp = EXCLUDED.required_xp,
                 required_company_value = EXCLUDED.required_company_value,
                 required_trade_volume = EXCLUDED.required_trade_volume,
                 required_units_produced = EXCLUDED.required_units_produced,
                 required_distinct_products = EXCLUDED.required_distinct_products,
                 title = EXCLUDED.title`;
    }

    // 6) Denge config'i — yeni sürüm olarak eklenir, eskisi tarihte kalır -------
    for (const c of d.gameConfigs) {
      // ::text::jsonb — düz ${...}::jsonb postgres.js'te ÇİFT KODLAMAYA yol açar
      // (nesne yerine JSON string saklanır); sql.json() ise parametre tipi
      // çıkarımına bağlıdır. Bu form her iki tuzağı da kapatır.
      const json = JSON.stringify(c.value);
      await tx`
        INSERT INTO game_configs (key, version, value)
        SELECT ${c.key}, COALESCE(MAX(version), 0) + 1, ${json}::text::jsonb
        FROM game_configs WHERE key = ${c.key}
        HAVING NOT EXISTS (
          SELECT 1 FROM game_configs g
          WHERE g.key = ${c.key} AND g.value = ${json}::text::jsonb
        )`;
    }
    log(`${d.loanTerms.length} kredi kademesi · ${d.companyLevels.length} seviye · ${d.gameConfigs.length} config anahtarı`);

    // 7) Sistem şirketleri — para arzının kaynağı ve hedefi (docs/02 §3.1) ------
    for (const code of SYSTEM_COMPANY_CODES) {
      // ★ Kimlik deterministik (R79): `system_code` zaten benzersiz anahtar.
      await tx`INSERT INTO companies (id, kind, system_code, name, home_city_id, cash, usd_balance)
               VALUES (${deterministicUuid('company', code)}::uuid,
                       'SYSTEM', ${code}, ${SYSTEM_COMPANIES[code]}, 1, 0, 0)
               ON CONFLICT (system_code) DO NOTHING`;
    }
    log(`${SYSTEM_COMPANY_CODES.length} sistem şirketi`);

    // 7b) MVP-0 NPC satıcıları — sabit fiyatlı arz kaynağı (gerçek NPC ajanları F6)
    for (const npc of d.simpleNpcSellers) {
      const city = d.cities.find((c) => c.code === npc.cityCode)!;
      // companies_npc_name_unique (0006) sayesinde tekrar koşu kopya yaratmaz
      await tx`INSERT INTO companies (id, kind, name, home_city_id, cash)
               VALUES (${deterministicUuid('company', npc.name)}::uuid,
                       'NPC', ${npc.name}, ${city.id}, 0)
               ON CONFLICT (name) WHERE kind = 'NPC' DO NOTHING`;
    }
    const npcRows = await tx<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM companies WHERE kind = 'NPC'`;
    log(`${npcRows[0]?.count ?? 0n} NPC satıcı`);

    /*
     * 8) Genesis tur — tick 0.
     *
     * ★ `rng_seed` DUVAR SAATİNDEN türüyordu (`Date.now()`) — hem de "zaman
     * kaynağı NOW() değil, tick.seq'tir" yazan yorumun altında. R57 turun
     * tohumunu duvar saatinden kurtarmıştı ama SIFIRINCI turu atlamıştı.
     *
     * Ölçülen bedeli (R79): kimlikler deterministik yapıldıktan sonra bile
     * aynı tohumla iki koşum farklı sonuç veriyordu — oynaklık %9,9 vs %9,5,
     * oyuncu payı %44,4 vs %41,9. Kalan kaynak buydu.
     *
     * Artık dünya tohumundan türüyor: `world.rng` yapılandırması kapı
     * koşumunda tohuma göre yazılır, yoksa sabit bir varsayılan kullanılır.
     */
    const [rng] = await tx<{ seed: string | null }[]>`
      SELECT (value->>'seed') AS seed FROM game_configs
       WHERE key = 'world.rng' ORDER BY version DESC LIMIT 1`;
    const genesisSeed = BigInt(rng?.seed ?? '20260101');
    await tx`INSERT INTO economic_ticks (seq, scheduled_at, started_at, completed_at, status, rng_seed, season)
             VALUES (0, NOW(), NOW(), NOW(), 'COMPLETED', ${genesisSeed}, 0)
             ON CONFLICT (seq) DO NOTHING`;
  });
}

/** Ürün grafını okur ve doğrular; sorunluysa transaction geri alınır. */
export async function assertProductGraph(sql: Sql): Promise<void> {
  const products = await sql<{
    id: number; code: string; unlock_level: number;
    is_raw_material: boolean; is_retail_product: boolean;
  }[]>`SELECT id, code, unlock_level, is_raw_material, is_retail_product
       FROM products WHERE is_active`;

  const recipes = await sql<{
    id: number; facility_code: string; output_product_id: number;
    unlock_level: number; inputs: number[] | null;
  }[]>`
    SELECT r.id, ft.code AS facility_code, r.output_product_id, r.unlock_level,
           ARRAY_AGG(ri.product_id) FILTER (WHERE ri.product_id IS NOT NULL) AS inputs
    FROM production_recipes r
    JOIN facility_types ft ON ft.id = r.facility_type_id
    LEFT JOIN recipe_inputs ri ON ri.recipe_id = r.id
    WHERE r.is_active
    GROUP BY r.id, ft.code, r.output_product_id, r.unlock_level`;

  const report = validateProductGraph(
    recipes.map((r) => ({
      recipeId: r.id,
      facilityTypeCode: r.facility_code,
      outputProductId: r.output_product_id,
      unlockLevel: r.unlock_level,
      inputProductIds: r.inputs ?? [],
    })),
    products.map((p) => ({
      id: p.id, code: p.code, unlockLevel: p.unlock_level,
      isRawMaterial: p.is_raw_material, isRetailProduct: p.is_retail_product,
    })),
  );

  // MVP-1'de Mobilya kereste zinciri gelmediği için ithalatla karşılanıyor;
  // "üretilemiyor" uyarısı beklenen durumdur (docs/08 istisnası).
  const blocking = report.issues.filter(
    (i) => !(i.kind === 'UNREACHABLE' && i.message.startsWith('FURNITURE')),
  );
  if (blocking.length > 0) {
    throw new InvariantViolation('I8', 'ürün grafı geçersiz', {
      issues: blocking.map((i) => i.message),
    });
  }
}

export async function seedFromEnv(url?: string): Promise<void> {
  const sql = createSql({ url, max: 1, statementTimeoutMs: 60_000 });
  try { await seed(sql); } finally { await sql.end({ timeout: 5 }); }
}
