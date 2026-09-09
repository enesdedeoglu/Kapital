import { addBatch, consumeFefo, transfer, type Sql } from '@kapital/db';
import {
  cityBonusFor, expiryTick, outputQuality, productionCapacity, rawInputQuality,
  type FacilityCategory,
  eventMultipliersFor, type ActiveEvent,
} from '@kapital/economy';
import {
  asMoney, asQty, deterministicUuid, divRoundHalfEven, InsufficientFunds,
  qtyFromNumber,
} from '@kapital/shared';
import { configValue, rngFor, type EngineTick } from '../context.js';
import { PHASE } from '../phases.js';
import { loadActiveEvents } from './world-events.js';

/**
 * Ücretin fiyat seviyesini ne kadar takip ettiği (0 = hiç, 1 = tamamen).
 *
 * 1 sarmal yaratır (R76): fiyatlama maliyet artı marj olduğu için döngü
 * kapanır. 0 ise para arzı sızar (R75): musluk bütçe sınırlı, gider adede
 * bağlıdır ve adet düşünce açık büyür. Yarım, ikisinin arasıdır.
 */
const WAGE_INDEXATION = 0.5;

interface ProducerRow {
  facility_id: string; company_id: string; city_id: number; inventory_id: string;
  facility_name: string; category: FacilityCategory; level: number; condition: string;
  technology_bonus: number; staff_score: number; base_capacity: number; utilization: number;
  level_multiplier: number; agriculture_bonus: number; industrial_bonus: number;
  free_capacity: bigint;
  recipe_id: number; output_product_id: number; output_quantity: bigint;
  cycle_ticks: number; labor_cost: bigint; energy_cost: bigint;
  product_unit: string; shelf_life_ticks: number | null;
}

interface RecipeInputRow {
  recipe_id: number; product_id: number; quantity: bigint; min_quality: string;
}

export interface ProducePhaseResult {
  facilities: number;
  produced: bigint;
  jobsStarted: number;
  jobsCompleted: number;
  halted: number;
  overheadCharged: bigint;
}

/**
 * P1 — ÜRETİM. Tarla, maden ve fabrika AYNI kod yolunu kullanır; aralarındaki
 * tek fark reçetedir (girdisiz reçete = hammadde üreticisi).
 *
 * Sıra: önce yeni işler başlatılır (girdiler tüketilir), sonra vadesi gelen
 * işler tamamlanır (çıktı eklenir). `cycle_ticks = 1` olan reçeteler aynı turda
 * başlayıp biter — özel durum yoktur.
 *
 * Shard anahtarı `company_id`: üretim yalnız kendi tesisine yazar (ADR-0005).
 */
export async function runProducePhase(sql: Sql, tick: EngineTick): Promise<ProducePhaseResult> {
  const rawBaseQuality = configValue<{ rawBaseQuality?: number; qualityVariance?: number }>(
    tick, 'economy.production', {},
  );
  const baseQuality = rawBaseQuality.rawBaseQuality ?? 70;
  const variance = rawBaseQuality.qualityVariance ?? 1.5;

  const [sink] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;

  // Yalnız iş gerektiren tesisler taranır (madde 54): üretimi açık, inşaatı
  // bitmiş, reçetesi atanmış, şirketi aktif.
  // ★ Sıra belirleyici olmalı (R56): döngü durumu sırayla değiştirir, Postgres
  // ise ORDER BY olmadan sıra garantisi vermez.
  const producers = await sql<ProducerRow[]>`
    SELECT f.id AS facility_id, f.company_id, f.city_id, i.id AS inventory_id,
           COALESCE(f.name, ft.name) AS facility_name, ft.category, f.level,
           f.condition::text, f.technology_bonus, f.staff_score, f.utilization, ft.base_capacity,
           COALESCE(lc.capacity_multiplier, 1) AS level_multiplier,
           c.agriculture_bonus, c.industrial_bonus,
           (i.capacity - i.used_capacity)::bigint AS free_capacity,
           r.id AS recipe_id, r.output_product_id, r.output_quantity, r.cycle_ticks,
           r.labor_cost, r.energy_cost, p.unit AS product_unit, p.shelf_life_ticks
    FROM facilities f
    JOIN facility_types ft        ON ft.id = f.facility_type_id
    JOIN production_recipes r     ON r.id = f.active_recipe_id AND r.is_active
    JOIN products p               ON p.id = r.output_product_id
    JOIN inventories i            ON i.facility_id = f.id
    JOIN cities c                 ON c.id = f.city_id
    JOIN companies co             ON co.id = f.company_id AND co.status = 'ACTIVE'
    LEFT JOIN facility_level_curve lc ON lc.level = f.level
    WHERE f.production_enabled
      AND f.closed_at IS NULL
      AND f.construction_complete_at_tick <= ${tick.seq}
      AND NOT EXISTS (
        SELECT 1 FROM production_jobs j
        WHERE j.facility_id = f.id AND j.started_tick = ${tick.seq}
      )
    ORDER BY f.id`;

  const recipeIds = [...new Set(producers.map((p) => p.recipe_id))];
  const inputsByRecipe = new Map<number, RecipeInputRow[]>();
  if (recipeIds.length > 0) {
    const rows = await sql<RecipeInputRow[]>`
      SELECT recipe_id, product_id, quantity, min_quality::text
      FROM recipe_inputs WHERE recipe_id = ANY(${recipeIds.map(String)}::int[])`;
    for (const row of rows) {
      (inputsByRecipe.get(row.recipe_id) ?? inputsByRecipe.set(row.recipe_id, []).get(row.recipe_id)!).push(row);
    }
  }

  const result = { facilities: 0, produced: 0n, jobsStarted: 0, jobsCompleted: 0, halted: 0, overheadCharged: 0n };

  // Dünya olayları arzı ve maliyeti çarpar (madde 45): kuraklık üretimi kısar,
  // enerji krizi işçilik+enerji giderini şişirir.
  const events = await loadActiveEvents(sql, tick);

  /*
   * ★ ÜCRET ENDEKSİ (R75) — para arzı sızıntısının kaynağı.
   *
   * Musluk (tüketici harcaması) BÜTÇE sınırlıdır: fiyat artınca tüketici daha
   * az ADET alır, aynı parayı harcar. Gider (işçilik+enerji) ise reçeteden
   * gelen SABİT NOMİNAL bir sayıdır ve ÜRETİLEN ADEDE göre ödenir. Adet
   * düşünce gider küçülür, musluk sabit kalır ve para birikir.
   *
   * Ölçüldü (tohum 1, gün 2→5): musluk 5.216.518 → 4.890.158 (sabit) iken
   * maaş 2.972.499 → 2.263.230 ve üretilen adet 261.918 → 205.949. Günlük
   * para yaratımı 1.592.144'ten 2.400.087'ye ÇIKTI — açık her gün büyüyor.
   * Kendini besleyen bir döngü: fiyat ↑ → adet ↓ → gider ↓ → para ↑ → fiyat ↑.
   *
   * Bu ayrıca CAPEX'in dört katına çıkmasını da açıklıyor: sabit nominal
   * maliyet + artan fiyat = genişleyen marj = yatırım patlaması.
   *
   * Endeks, fiyat seviyesinin tohum seviyesine oranıdır. Ücret onunla birlikte
   * hareket edince reel ücret sabit kalır, gider musluğa ayak uydurur ve marj
   * yapay olarak şişmez. Gerçek ekonomilerde de böyledir.
   */
  const [endeks] = await sql<{ index: number | null }[]>`
    SELECT AVG(ph.ema_reference::float8 / NULLIF(p.base_reference_price, 0)) AS index
      FROM price_history ph
      JOIN products p ON p.id = ph.product_id
     WHERE ph.city_id = 0
       AND ph.tick_id = (SELECT MAX(tick_id) FROM price_history WHERE tick_id <= ${tick.seq})
       AND p.base_reference_price > 0`;
  /*
   * ★★ KISMİ endeksleme (R76) — tam endeksleme SARMAL yaratıyor.
   *
   * İlk hâli endeksi doğrudan uyguluyordu ve pozitif geri besleme kurdu:
   * fiyat ↑ → ücret ↑ → maliyet ↑ → fiyat ↑. Fiyatlama maliyet artı marj
   * olduğu için döngü kapanıyor ve kendini besliyor. Ölçüldü: para arzı
   * düzeldi (%40,7 → %37,9) ama kur %8,5'ten %50,0'ye fırladı — kur
   * `baseRate × gameCpi` ile fiyat seviyesini takip eder, yani sarmalın
   * göstergesi.
   *
   * Gerçek ekonomilerdeki ücret-fiyat sarmalının aynısı ve çözümü de aynı:
   * ücret fiyatın TAMAMINI değil, bir KISMINI takip eder. Böylece maliyet
   * fiyattan yavaş artar, döngü yakınsar.
   *
   * Sızıntı yine kapanır (gider musluğa ayak uydurur) ama sarmal kurulmaz.
   */
  const ham = Math.max(0.5, Math.min(3, endeks?.index ?? 1));
  const wageIndex = 1 + WAGE_INDEXATION * (ham - 1);

  for (const producer of producers) {
    result.facilities++;
    const started = await startJob(sql, tick, producer, inputsByRecipe.get(producer.recipe_id) ?? [], {
      sinkId: sink!.id, baseQuality, variance, events, wageIndex,
    });
    if (started.halted) result.halted++;
    if (started.jobId !== null) result.jobsStarted++;
    result.overheadCharged += started.overhead;
  }

  const completed = await completeJobs(sql, tick);
  result.jobsCompleted = completed.count;
  result.produced = completed.produced;

  return result;
}

/** Tek tesisin üretimini başlatır: girdileri tüketir, işi kaydeder. */
async function startJob(
  sql: Sql,
  tick: EngineTick,
  p: ProducerRow,
  inputs: readonly RecipeInputRow[],
  ctx: {
    sinkId: string; baseQuality: number; variance: number; events: ActiveEvent[];
    /** Fiyat seviyesi endeksi — işçilik+enerji gideri bununla ölçeklenir (R75). */
    wageIndex: number;
  },
): Promise<{ jobId: bigint | null; halted: boolean; overhead: bigint }> {
  const cityBonus = cityBonusFor(p.category, {
    agricultureBonus: p.agriculture_bonus,
    industrialBonus: p.industrial_bonus,
  });
  // Tesis kategorisi sektör olaylarının hedefi; çıktı ürünü ürün olaylarının.
  const effects = eventMultipliersFor(ctx.events, {
    category: p.category, productId: p.output_product_id, cityId: p.city_id,
  });
  const capacity = productionCapacity({
    baseCapacity: p.base_capacity,
    levelMultiplier: p.level_multiplier,
    condition: Number(p.condition),
    cityBonus,
    technologyBonus: p.technology_bonus,
    utilization: p.utilization,
    eventMultiplier: effects.supply,
  });
  const planned = qtyFromNumber(capacity) as bigint;

  if (planned <= 0n) {
    await record(sql, tick, p, 0n, 0n, 0, 0n, 0n, 'kapasite sıfır — tesis yıpranmış');
    return { jobId: null, halted: true, overhead: 0n };
  }
  if (p.free_capacity <= 0n) {
    await record(sql, tick, p, planned, 0n, 0, 0n, 0n, 'depo dolu');
    return { jobId: null, halted: true, overhead: 0n };
  }

  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // Depoya sığmayan üretilmez — I4 zaten engellerdi, burada erken kesiyoruz.
    let output = planned < p.free_capacity ? planned : p.free_capacity;
    let inputCost = 0n;
    let inputQuality: number;
    let haltedReason: string | null = null;

    if (inputs.length === 0) {
      // Hammadde üreticisi: toprak/cevher kalitesi şehir bonusuyla ölçeklenir
      inputQuality = rawInputQuality(ctx.baseQuality, cityBonus);
    } else {
      // Her girdinin desteklediği çıktıyı bul; en kısıtlayıcısı üretimi belirler
      const picks: { qty: bigint; quality: number; cost: bigint }[] = [];
      let feasible = output;

      for (const input of inputs) {
        // Tam sayı bölmesi aşağı yuvarlar: planlanan çıktı için gereken girdi
        // hesaplanır, sonra gerçekleşen çıktı tüketilen girdiden türetilir.
        // Yuvarlama farkı en fazla 1 mili-birimdir ve yönü BİLİNÇLİ olarak
        // "biraz fazla girdi tüketilir" tarafındadır — yoktan çıktı üretilmez.
        const needed = (input.quantity * output) / p.output_quantity;
        const allocation = await consumeFefo(t, {
          inventoryId: p.inventory_id,
          productId: input.product_id,
          quantity: asQty(needed),
          minQuality: Number(input.min_quality),
        });
        const supports = (allocation.allocated * p.output_quantity) / input.quantity;
        if (supports < feasible) feasible = supports;
        picks.push({
          qty: allocation.allocated as bigint,
          quality: allocation.weightedQuality,
          cost: (allocation.weightedUnitCost * allocation.allocated) / 1000n,
        });
        if (allocation.allocated < needed) {
          haltedReason = `girdi yetersiz: ürün ${input.product_id}`;
        }
      }

      if (feasible <= 0n) {
        await record(sql, tick, p, planned, 0n, 0, 0n, 0n, haltedReason ?? 'girdi yok');
        return { jobId: null, halted: true, overhead: 0n };
      }
      output = feasible;

      const totalQty = picks.reduce((s, x) => s + x.qty, 0n);
      inputQuality = totalQty > 0n
        ? picks.reduce((s, x) => s + x.quality * Number(x.qty), 0) / Number(totalQty)
        : 0;
      inputCost = picks.reduce((s, x) => s + x.cost, 0n);
    }

    const rng = rngFor(tick, PHASE.PRODUCE, p.city_id, p.facility_id);
    const quality = outputQuality({
      inputQuality,
      technologyBonus: p.technology_bonus,
      staffScore: p.staff_score,
      condition: Number(p.condition),
      rng,
      variance: ctx.variance,
    });

    // İşçilik ve enerji reçete başınadır; üretilen orana göre ölçeklenir.
    const scale = output * 1000n / p.output_quantity;
    // Maliyet çarpanı işçilik ve enerjiye uygulanır: enerji krizinde üretim
    // durmaz, PAHALILAŞIR (madde 45).
    // ★ Ücret endeksi: gider fiyat seviyesiyle birlikte hareket eder (R75).
    const overhead = (((p.labor_cost + p.energy_cost) * scale) / 1000n
      * BigInt(Math.round(effects.cost * ctx.wageIndex * 1000))) / 1000n;

    if (overhead > 0n) {
      try {
        await transfer(t, {
          tickId: tick.seq,
          txId: deterministicUuid('production', tick.seq, p.facility_id),
          fromCompanyId: p.company_id,
          toCompanyId: ctx.sinkId,
          amount: asMoney(overhead),
          account: 'SALARY',
          reason: `${p.facility_name} işçilik ve enerji`,
          refType: 'facility',
          refId: p.facility_id,
        });
      } catch (error) {
        if (!(error instanceof InsufficientFunds)) throw error;
        // Girdi tüketimi geri alınır: transaction rollback eder.
        throw new ProductionUnaffordable(p.facility_id);
      }
    }

    const totalCost = inputCost + overhead;
    const unitCost = output > 0n ? divRoundHalfEven(totalCost * 1000n, output) : 0n;

    const [job] = await t<{ id: bigint }[]>`
      INSERT INTO production_jobs (facility_id, company_id, recipe_id, started_tick,
                                   complete_tick, planned_output, input_quality,
                                   output_quality, input_cost, unit_cost)
      VALUES (${p.facility_id}::uuid, ${p.company_id}::uuid, ${p.recipe_id}, ${tick.seq},
              ${tick.seq + BigInt(Math.max(0, p.cycle_ticks - 1))}, ${output},
              ${inputQuality.toFixed(3)}, ${quality.toFixed(3)}, ${totalCost}, ${unitCost})
      ON CONFLICT (facility_id, started_tick) DO NOTHING
      RETURNING id`;

    await record(sql, tick, p, planned, output, quality, inputCost, overhead, haltedReason);
    return { jobId: job?.id ?? null, halted: haltedReason !== null, overhead };
  }).catch((error: unknown) => {
    if (error instanceof ProductionUnaffordable) {
      return record(sql, tick, p, planned, 0n, 0, 0n, 0n, 'işçilik gideri ödenemedi')
        .then(() => ({ jobId: null, halted: true, overhead: 0n }));
    }
    throw error;
  }) as Promise<{ jobId: bigint | null; halted: boolean; overhead: bigint }>;
}

class ProductionUnaffordable extends Error {
  constructor(readonly facilityId: string) { super('işçilik gideri ödenemedi'); }
}

/** Vadesi gelen işleri tamamlar: çıktı stoğa girer. */
async function completeJobs(sql: Sql, tick: EngineTick): Promise<{ count: number; produced: bigint }> {
  const due = await sql<{
    id: bigint; facility_id: string; company_id: string; inventory_id: string;
    output_product_id: number; planned_output: bigint; output_quality: string;
    unit_cost: bigint; shelf_life_ticks: number | null;
  }[]>`
    SELECT j.id, j.facility_id, j.company_id, i.id AS inventory_id,
           r.output_product_id, j.planned_output, j.output_quality::text, j.unit_cost,
           p.shelf_life_ticks
    FROM production_jobs j
    JOIN production_recipes r ON r.id = j.recipe_id
    JOIN products p           ON p.id = r.output_product_id
    JOIN inventories i        ON i.facility_id = j.facility_id
    WHERE j.status = 'RUNNING' AND j.complete_tick <= ${tick.seq}
     ORDER BY j.id`;

  let produced = 0n;
  let count = 0;

  for (const job of due) {
    try {
      await sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        await addBatch(t, {
          inventoryId: job.inventory_id,
          productId: job.output_product_id,
          quantity: asQty(job.planned_output),
          quality: job.output_quality,
          unitCost: asMoney(job.unit_cost),
          producedInTick: tick.seq,
          expiresAtTick: expiryTick(tick.seq, job.shelf_life_ticks),
          sourceCompanyId: job.company_id,
          sourceFacilityId: job.facility_id,
        });
        await t`UPDATE production_jobs SET status = 'COMPLETED' WHERE id = ${job.id}`;
        await t`UPDATE company_stats
                   SET total_units_produced = total_units_produced + ${job.planned_output}
                 WHERE company_id = ${job.company_id}::uuid`;
        // Farklı ürün sayacı bir seviye şartıdır (madde 11) ve F8'e kadar hiç
        // güncellenmiyordu. Ayrık ürünü her turda saymak yerine ilk üretimde
        // kaydedilir.
        await t`
          INSERT INTO company_products (company_id, product_id, first_tick)
          VALUES (${job.company_id}::uuid, ${job.output_product_id}, ${tick.seq})
          ON CONFLICT (company_id, product_id) DO NOTHING`;
      });
      produced += job.planned_output;
      count++;
    } catch (error) {
      // Depo dolduysa iş bekler; sonraki turda yer açılırsa tamamlanır.
      const code = (error as { code?: string }).code;
      if (code !== 'STORAGE_FULL' && !(error as Error).message?.includes('Depo')) throw error;
    }
  }

  return { count, produced };
}

async function record(
  sql: Sql, tick: EngineTick, p: ProducerRow,
  capacity: bigint, produced: bigint, quality: number,
  inputCost: bigint, overhead: bigint, haltedReason: string | null,
): Promise<void> {
  await sql`
    INSERT INTO production_records (tick_id, facility_id, company_id, recipe_id, product_id,
                                    capacity, produced, output_quality, input_cost,
                                    overhead_cost, halted_reason)
    VALUES (${tick.seq}, ${p.facility_id}::uuid, ${p.company_id}::uuid, ${p.recipe_id},
            ${p.output_product_id}, ${capacity}, ${produced}, ${quality.toFixed(3)},
            ${inputCost}, ${overhead}, ${haltedReason})
    ON CONFLICT (tick_id, facility_id) DO NOTHING`;
}
