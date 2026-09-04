import type { Sql } from '@kapital/db';
import {
  advanceHysteresis, classifyBand, directivesForBand, marketHealthScore,
  npcShareTarget, DEFAULT_HEALTH_WEIGHTS, type HealthBand, type HealthWeights,
} from '@kapital/economy';
import { asMoney, qtyFromNumber, TICKS_PER_DAY } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';
import { loadReferencePrices } from '../reference-prices.js';

/** Ölçüm penceresi — bir oyun günü. */
const WINDOW_TICKS = TICKS_PER_DAY;

export interface DirectorResult {
  productsScored: number;
  directivesIssued: number;
  bandChanges: number;
  emergencies: number;
  reserveOffers: number;
  worldEvents: number;
  capacityCaps: number;
}

interface MeasureRow {
  product_id: number;
  supply: number;
  demand: number;
  seller_count: number;
  buyer_count: number;
  trade_count: number;
  stock: number;
  volatility: number;
  player_supply: number;
  target_player_share: number;
  importable: boolean;
}

interface PreviousRow {
  product_id: number;
  band: HealthBand;
  streak_band: HealthBand | null;
  streak_count: number;
}

/**
 * EKONOMİ DİREKTÖRÜ — madde 29–33, ADR-0004.
 *
 * ED ekonomiyi YÖNETMEZ, sınırlarını korur. Elinde yalnız 6 kaldıraç var ve
 * hepsi NPC davranışına dokunur: fiyat belirleyemez, emir veremez, şirket
 * nakdine dokunamaz, oyuncu tesisini değiştiremez. Yapabildiği tek doğrudan
 * eylem `SYS_RESERVE`'ün satışa çıkması ve o da SON ÇAREdir.
 *
 * ★ Müdahale sırası (docs/07 §4.1): önce İTHALAT kapısı, sonra rezerv.
 * İthalat ekonomik olarak gerçek bir cevaptır — pahalıdır, döviz harcar,
 * kuru yükseltir. Oyuncu "sistem hile yaptı" değil, "ithalat açıldı,
 * maliyetler arttı" görür ve yurt içi üretim kârlı bir fırsat olarak kalır.
 *
 * Her direktif `expires_tick` ile kendiliğinden söner: kalıcı müdahale yoktur.
 */
export async function runDirector(sql: Sql, tick: EngineTick): Promise<DirectorResult> {
  const out: DirectorResult = {
    productsScored: 0, directivesIssued: 0, bandChanges: 0,
    emergencies: 0, reserveOffers: 0, worldEvents: 0, capacityCaps: 0,
  };

  const cfg = configValue<{
    weights?: Partial<HealthWeights>; hysteresisTicks: number; directiveTtlTicks: number;
    targetSellers: number; targetBuyers: number;
  }>(tick, 'director', {
    hysteresisTicks: 6, directiveTtlTicks: 96, targetSellers: 4, targetBuyers: 6,
  });
  const weights: HealthWeights = { ...DEFAULT_HEALTH_WEIGHTS, ...cfg.weights };

  const from = tick.seq > BigInt(WINDOW_TICKS) ? tick.seq - BigInt(WINDOW_TICKS) : 0n;
  const measures = await measure(sql, tick, from);
  if (measures.length === 0) return out;

  /*
   * SOĞUK BAŞLANGIÇ KURALI (R11).
   *
   * `f_playerShare` oyuncuların ekonomiyi devralma ilerlemesini ölçer. Henüz
   * HİÇ oyuncu yokken bu bileşen her ürün için 0 çıkar ve sağlık skorunu
   * kalıcı olarak 15 puan aşağı çeker — ekonomi kusursuz işlese bile her ürün
   * ADJUST bandında kalır.
   *
   * Daha kötüsü: ED'nin elindeki hiçbir kaldıraç oyuncu getiremez. Yani
   * müdahale edilemez bir eksiklik için sürekli müdahale edilir. Bu yüzden
   * dünyada aktif oyuncu şirketi yokken bileşen NÖTRlenir (hedef 0 → katsayı 1).
   * İlk oyuncu girdiği anda ölçüm normale döner.
   */
  const [players] = await sql<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM companies WHERE kind = 'PLAYER' AND status = 'ACTIVE'`;
  const coldStart = (players?.count ?? 0n) === 0n;

  const previous = await loadPrevious(sql, tick);
  const prevByProduct = new Map(previous.map((p) => [p.product_id, p]));

  for (const m of measures) {
    const { score, components } = marketHealthScore({
      supply: m.supply,
      demand: m.demand,
      sellerCount: m.seller_count,
      buyerCount: m.buyer_count,
      // Derinlik: mevcut stok, günlük tüketimin kaç turuna yeter.
      inventoryDepthTicks: m.demand > 0 ? (m.stock * WINDOW_TICKS) / m.demand : 12,
      priceVolatility: m.volatility,
      tradeCount: m.trade_count,
      playerShare: m.supply > 0 ? m.player_supply / m.supply : 0,
      targetPlayerShare: coldStart ? 0 : m.target_player_share,
      targetSellers: cfg.targetSellers,
      targetBuyers: cfg.targetBuyers,
    }, weights);

    const observed = classifyBand(score);
    const prev = prevByProduct.get(m.product_id);
    const state = advanceHysteresis(
      prev ? { band: prev.band, streakBand: prev.streak_band, streakCount: prev.streak_count } : null,
      observed,
      cfg.hysteresisTicks,
    );
    if (prev && prev.band !== state.band) out.bandChanges++;

    await sql`
      INSERT INTO market_health (tick_id, product_id, city_id, score, band,
                                 supply_units, demand_units,
                                 f_supply, f_sellers, f_buyers, f_depth, f_stability,
                                 f_player_share, streak_band, streak_count)
      VALUES (${tick.seq}, ${m.product_id}, 0, ${score.toFixed(2)}, ${state.band},
              ${Math.round(m.supply * 1000)}, ${Math.round(m.demand * 1000)},
              ${components.supply}, ${components.sellers}, ${components.buyers},
              ${components.depth}, ${components.stability}, ${components.playerShare},
              ${state.streakBand}, ${state.streakCount})
      ON CONFLICT (tick_id, product_id, city_id) DO NOTHING`;
    out.productsScored++;

    const supplyRatio = m.demand > 0 ? m.supply / m.demand : (m.supply > 0 ? 2 : 0);
    const plan = directivesForBand(state.band, supplyRatio, m.importable);

    /*
     * ★ Geçerliliğini yitiren direktifler ANINDA iptal edilir.
     *
     * Süreleri dolmaya bırakılırsa (96 tur) ED tutarsız bir duruşta kalır:
     * ölçülen örnek — un arzı fazlaya döndüğünde ED üretimi kısarken
     * (PRODUCTION_BIAS −0,50) aynı anda eski kıtlık dönemindeki
     * IMPORT_QUOTA +0,50 ve INVESTMENT_BIAS +0,80 hâlâ yürürlükteydi. Yani
     * ED bir eliyle kısıp diğeriyle teşvik ediyordu.
     *
     * CAPACITY_CAP bunun dışındadır: onu bant değil oyuncu payı yönetir.
     */
    const keep = plan.map((d) => d.lever);
    await sql`
      UPDATE npc_directives SET expires_tick = ${tick.seq}
       WHERE product_id = ${m.product_id} AND expires_tick > ${tick.seq}
         AND lever <> 'CAPACITY_CAP'
         AND NOT (lever = ANY(${keep}::text[]))`;

    // Geçerli direktifler her tur YENİDEN yazılmaz, süresi uzatılır. Aksi
    // halde defter her turda 10 ürün × 5 kaldıraç şişerdi.
    for (const planned of plan) {
      const refreshed = await sql`
        UPDATE npc_directives
           SET expires_tick = ${tick.seq + BigInt(cfg.directiveTtlTicks)},
               magnitude = ${planned.magnitude},
               health_score_at_issue = ${score.toFixed(2)}
         WHERE lever = ${planned.lever} AND product_id = ${m.product_id}
           AND expires_tick > ${tick.seq}
        RETURNING id`;
      if (refreshed.length > 0) continue;

      await sql`
        INSERT INTO npc_directives (issued_tick, expires_tick, scope, product_id, lever,
                                    magnitude, reason, health_score_at_issue)
        VALUES (${tick.seq}, ${tick.seq + BigInt(cfg.directiveTtlTicks)}, 'PRODUCT',
                ${m.product_id}, ${planned.lever}, ${planned.magnitude},
                ${planned.reason}, ${score.toFixed(2)})`;
      out.directivesIssued++;
    }

    if (await issueCapacityCap(sql, tick, m, cfg.directiveTtlTicks)) out.capacityCaps++;

    if (state.band === 'EMERGENCY') {
      out.emergencies++;
      // Bolluk krizinde ithalat açılmaz: zaten fazla mal var.
      if (supplyRatio <= 1) {
        const announced = m.importable
          ? await announce(sql, tick, {
              kind: 'IMPORT_GATE_OPENED', productId: m.product_id, severity: 'WARNING',
              title: 'İthalat kapısı açıldı',
              body: `Piyasa sağlığı ${score.toFixed(0)}. İthalat derinliği artırıldı; ` +
                    'ithal mal dünya fiyatının üstünde satılır, yurt içi üretim kârlı kalır.',
              payload: { score, band: state.band, components },
              // Gün başına tek duyuru: her tur bildirim yağmuru olmasın.
              dedupeKey: `import-gate:${m.product_id}:${tick.seq / BigInt(TICKS_PER_DAY)}`,
            })
          // ★ İthal edilemeyen ürünlerde kapı açıldığını söylemek yanıltıcıdır:
          //   kota artar ama hiçbir mal gelmez. Doğrusu durumu olduğu gibi
          //   duyurmak ve tek kalan yolu (rezerv) işaret etmektir.
          : await announce(sql, tick, {
              kind: 'IMPORT_UNAVAILABLE', productId: m.product_id, severity: 'WARNING',
              title: 'Kıtlık: bu ürün ithal edilemiyor',
              body: `Piyasa sağlığı ${score.toFixed(0)}. Nihai tüketim ürünü olduğu için ` +
                    'dış tedarik yok; arz ancak yurt içi üretimle veya acil rezervle kapanır.',
              payload: { score, band: state.band, components },
              dedupeKey: `import-none:${m.product_id}:${tick.seq / BigInt(TICKS_PER_DAY)}`,
            });
        if (announced) out.worldEvents++;

        const offered = await maybeReserveOffer(sql, tick, m.product_id, score);
        if (offered) { out.reserveOffers++; out.worldEvents++; }
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */

/**
 * Ölçüm — tur indeksli kaynaklardan.
 *
 * `market_orders`'ın tur kolonu yok (yalnız `created_at`), bu yüzden pencere
 * ölçümleri üretim ve işlem kayıtlarından yapılır: ikisi de `tick_id` taşır
 * ve turların gerçek zamanla ilişkisinden bağımsızdır (ADR-0003).
 */
async function measure(sql: Sql, tick: EngineTick, from: bigint): Promise<MeasureRow[]> {
  return sql<MeasureRow[]>`
    WITH uretim AS (
      SELECT pr.product_id,
             SUM(pr.produced)::bigint AS produced,
             SUM(pr.produced) FILTER (WHERE c.kind = 'PLAYER')::bigint AS player_produced
        FROM production_records pr
        JOIN companies c ON c.id = pr.company_id
       WHERE pr.tick_id > ${from} AND pr.tick_id <= ${tick.seq}
       GROUP BY 1
    ),
    /*
     * Ara mal talebi — onu girdi olarak kullanan tesislerin KAPASİTESİnden.
     *
     * ★ Gerçekleşen üretimden ölçmek arz şokunu GÖRÜNMEZ kılar: çelik bitince
     * mobilya fabrikası da durur, dolayısıyla ölçülen çelik talebi de düşer ve
     * arz/talep oranı 1,00'da kalır. Ölçüldü (F7 çelik senaryosu): tüm çelik
     * üretimi durdurulduğu halde skor 75 → 70'te kaldı, hiçbir müdahale
     * tetiklenmedi.
     *
     * Kapasiteden ölçmek doğrusudur: girdisizlikten duran tesis o girdiyi
     * İSTEMEYE devam eder. Kullanım oranı çarpanı korunur, çünkü kasıtlı
     * kısılmış tesis gerçekten daha az girdi ister — girdisizlik ise kullanım
     * oranına dokunmaz.
     */
    ara_talep AS (
      SELECT ri.product_id,
             (SUM(ft2.base_capacity * COALESCE(lc.capacity_multiplier, 1) * f2.utilization
                  * ri.quantity / NULLIF(r.output_quantity, 0))
              * ${WINDOW_TICKS} * 1000)::bigint AS units
        FROM facilities f2
        JOIN facility_types ft2 ON ft2.id = f2.facility_type_id
        JOIN production_recipes r ON r.id = f2.active_recipe_id
        JOIN recipe_inputs ri ON ri.recipe_id = r.id
        LEFT JOIN facility_level_curve lc ON lc.level = f2.level
       WHERE f2.closed_at IS NULL AND f2.production_enabled
         AND f2.construction_complete_at_tick <= ${tick.seq}
       GROUP BY 1
    ),
    perakende_talep AS (
      SELECT cd.product_id, SUM(cd.demand_units)::bigint AS units
        FROM city_demand cd
       WHERE cd.tick_id > ${from} AND cd.tick_id <= ${tick.seq}
       GROUP BY 1
    ),
    islem AS (
      SELECT t.product_id,
             COUNT(DISTINCT t.seller_company_id) AS sellers,
             COUNT(DISTINCT t.buyer_company_id) AS buyers,
             COUNT(*) AS trades
        FROM market_trades t
       WHERE t.tick_id > ${from} AND t.tick_id <= ${tick.seq}
         AND NOT t.is_excluded_from_index
       GROUP BY 1
    ),
    stok AS (
      SELECT b.product_id, SUM(b.quantity)::bigint AS units
        FROM inventory_batches b GROUP BY 1
    ),
    oynaklik AS (
      SELECT ph.product_id,
             CASE WHEN AVG(ph.weighted_median) > 0
                  THEN COALESCE(STDDEV_POP(ph.weighted_median), 0) / AVG(ph.weighted_median)
                  ELSE 0 END AS ratio
        FROM price_history ph
       WHERE ph.tick_id > ${from} AND ph.tick_id <= ${tick.seq} AND ph.city_id = 0
       GROUP BY 1
    )
    SELECT p.id AS product_id,
           (COALESCE(u.produced, 0) / 1000.0)::float8 AS supply,
           ((COALESCE(at.units, 0) + COALESCE(pt.units, 0)) / 1000.0)::float8 AS demand,
           COALESCE(i.sellers, 0)::int AS seller_count,
           COALESCE(i.buyers, 0)::int AS buyer_count,
           COALESCE(i.trades, 0)::int AS trade_count,
           (COALESCE(s.units, 0) / 1000.0)::float8 AS stock,
           COALESCE(o.ratio, 0)::float8 AS volatility,
           (COALESCE(u.player_produced, 0) / 1000.0)::float8 AS player_supply,
           p.npc_target_market_share::float8 AS target_player_share,
           COALESCE(wm.importable, false) AS importable
      FROM products p
      LEFT JOIN uretim u ON u.product_id = p.id
      LEFT JOIN ara_talep at ON at.product_id = p.id
      LEFT JOIN perakende_talep pt ON pt.product_id = p.id
      LEFT JOIN islem i ON i.product_id = p.id
      LEFT JOIN stok s ON s.product_id = p.id
      LEFT JOIN oynaklik o ON o.product_id = p.id
      LEFT JOIN world_market wm ON wm.product_id = p.id
     ORDER BY p.id`;
}

async function loadPrevious(sql: Sql, tick: EngineTick): Promise<PreviousRow[]> {
  return sql<PreviousRow[]>`
    SELECT product_id, band, streak_band, streak_count FROM market_health
     WHERE city_id = 0
       AND tick_id = (SELECT MAX(tick_id) FROM market_health WHERE tick_id < ${tick.seq})`;
}

/**
 * `SYS_RESERVE` — SON ÇARE (madde 32).
 *
 * ED sıfırdan stok yaratmaz; rezerv GERÇEK bir şirkettir ve tüm değişmezlere
 * (I1–I8) tabidir. Koşullar dar tutulur:
 *   • bant 12 tur üst üste EMERGENCY,
 *   • ürünün üretimi fiilen durmuş,
 *   • hâlihazırda açık bir rezerv emri yok.
 *
 * Fiyat referansın 1,5–2,0 katıdır ve piyasanın ALTINA asla inmez: rezerv
 * bir sübvansiyon değil, pahalı ama mevcut bir tedarikçidir.
 */
async function maybeReserveOffer(
  sql: Sql, tick: EngineTick, productId: number, score: number,
): Promise<boolean> {
  const cfg = configValue<{ emergencyTicks: number; priceMultiplier: number; supplyPerTick: number }>(
    tick, 'director.reserve',
    { emergencyTicks: 12, priceMultiplier: 1.75, supplyPerTick: 200 },
  );

  const [streak] = await sql<{ ticks: bigint }[]>`
    SELECT COUNT(*) AS ticks FROM (
      SELECT band FROM market_health
       WHERE product_id = ${productId} AND city_id = 0 AND tick_id <= ${tick.seq}
       ORDER BY tick_id DESC LIMIT ${cfg.emergencyTicks}
    ) recent WHERE band = 'EMERGENCY'`;
  if (Number(streak?.ticks ?? 0n) < cfg.emergencyTicks) return false;

  const [production] = await sql<{ produced: bigint }[]>`
    SELECT COALESCE(SUM(produced), 0)::bigint AS produced FROM production_records
     WHERE product_id = ${productId} AND tick_id > ${tick.seq - BigInt(cfg.emergencyTicks)}`;
  if ((production?.produced ?? 0n) > 0n) return false; // üretim var, rezerve gerek yok

  const [reserve] = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE system_code = 'SYS_RESERVE'`;
  if (!reserve) return false;

  const [open] = await sql<{ id: bigint }[]>`
    SELECT id FROM market_orders
     WHERE company_id = ${reserve.id}::uuid AND product_id = ${productId}
       AND side = 'SELL' AND status IN ('OPEN', 'PARTIAL')`;
  if (open) return false;

  const references = await loadReferencePrices(sql, tick.seq);
  const reference = references.get(productId);
  if (!reference) return false;
  const price = asMoney((reference * BigInt(Math.round(cfg.priceMultiplier * 100))) / 100n);
  const supply = qtyFromNumber(cfg.supplyPerTick);

  // Rezervin malı: stok yaratmak yerine SYS_WORLD'den satın alınmış sayılır,
  // yani ithalat gibi davranır. Emir şehirsizdir: ulusal arz.
  await sql`
    INSERT INTO market_orders (company_id, product_id, city_id, side, quantity,
                               remaining_quantity, price_per_unit, quality, expires_at_tick)
    VALUES (${reserve.id}::uuid, ${productId}, 1, 'SELL', ${supply}, ${supply},
            ${price}, '60.000', ${tick.seq + BigInt(TICKS_PER_DAY)})`;

  await announce(sql, tick, {
    kind: 'RESERVE_INTERVENTION', productId, severity: 'CRITICAL',
    title: 'Acil rezerv piyasaya çıktı',
    body: `Üretim ${cfg.emergencyTicks} turdur durmuş durumda ve ithalat yetmedi. ` +
          `Devlet rezervi referans fiyatın ${cfg.priceMultiplier} katından satışa çıktı — ` +
          'piyasanın altında değil, üstünde.',
    payload: { score, price: price.toString(), quantity: supply.toString() },
    dedupeKey: `reserve:${productId}:${tick.seq}`,
  });
  return true;
}

interface Announcement {
  kind: string; productId?: number; cityId?: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string; body: string; payload: unknown; dedupeKey: string;
}

/** Her müdahale görünür olmalıdır: gizli müdahale "sistem hile yapıyor"dur. */
async function announce(sql: Sql, tick: EngineTick, event: Announcement): Promise<boolean> {
  const rows = await sql`
    INSERT INTO world_notices (tick_id, kind, product_id, city_id, severity, title, body,
                              payload, dedupe_key)
    VALUES (${tick.seq}, ${event.kind}, ${event.productId ?? null}, ${event.cityId ?? null},
            ${event.severity}, ${event.title}, ${event.body},
            ${JSON.stringify(event.payload)}::text::jsonb, ${event.dedupeKey})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/**
 * NPC payının kademeli geri çekilmesi — madde 31.
 *
 * ★ Spec'in formülü doğrudan uygulanamaz. `hedef_npc_share = clamp(1 −
 * oyuncu_payı × 1,15, 0,10, 0,85)` oyuncu payı SIFIRKEN bile 0,85 verir.
 * Bunu tesis kullanım oranı olarak uygularsak oyuncusuz bir dünyada NPC arzı
 * kalıcı olarak %15 kısılır ve boşluğu dolduracak kimse olmadığı için kıtlık
 * doğar — ED'nin önlemesi gereken şeyi ED'nin kendisi üretir.
 *
 * Bu yüzden hedef pay, NPC'nin MEVCUT payına göre bir TAVANA çevrilir:
 *
 *   tavan = oyuncu_payı > 0 ? min(1, hedef_npc_payı / (1 − oyuncu_payı)) : 1
 *
 * Oyuncu payı 0 iken tavan 1'dir (kısma yok). Oyuncu payı %30'a çıktığında
 * hedef NPC payı 0,655, mevcut NPC payı 0,70 → tavan 0,936, yani NPC %6,4
 * geri çekilir. Kademelilik `npcCapacityCap` içinde korunur (tur başına ≤%2).
 */
async function issueCapacityCap(
  sql: Sql, tick: EngineTick, m: MeasureRow, ttl: number,
): Promise<boolean> {
  const playerShare = m.supply > 0 ? Math.min(1, m.player_supply / m.supply) : 0;

  const [existing] = await sql<{ id: bigint; magnitude: number }[]>`
    SELECT id, magnitude FROM npc_directives
     WHERE lever = 'CAPACITY_CAP' AND product_id = ${m.product_id}
       AND expires_tick > ${tick.seq}`;

  // ★ Kademelilik TAVANA uygulanır, hedef paya değil.
  //
  // Hedef payı adım adım yürütüp tavanı ondan türetirsek, tavan uzun süre 1'de
  // kalır; 1 olduğu sürece direktif yazılmadığı için yürüyüşün durumu da
  // saklanmaz ve geri çekilme hiç başlamaz. Kademeliliği NPC'nin fiilen
  // tükettiği büyüklüğe taşımak bu kilidi açar ve madde 31'in amacını korur:
  // tur başına en fazla %2 değişim.
  const previousCeiling = existing?.magnitude ?? 1;
  const targetCeiling = playerShare > 0
    ? Math.min(1, npcShareTarget(playerShare) / (1 - playerShare))
    : 1;
  const step = Math.max(-0.02, Math.min(0.02, targetCeiling - previousCeiling));
  const ceiling = Math.max(0.10, Math.min(1, previousCeiling + step));

  // Tavan 1'de kaldıysa ve daha önce de yoksa direktife gerek yok.
  if (ceiling >= 0.999 && !existing) return false;

  if (existing) {
    await sql`UPDATE npc_directives
                 SET magnitude = ${ceiling}, expires_tick = ${tick.seq + BigInt(ttl)}
               WHERE id = ${existing.id}`;
    return false;
  }
  await sql`
    INSERT INTO npc_directives (issued_tick, expires_tick, scope, product_id, lever,
                                magnitude, reason)
    VALUES (${tick.seq}, ${tick.seq + BigInt(ttl)}, 'PRODUCT', ${m.product_id},
            'CAPACITY_CAP', ${ceiling},
            ${`oyuncu payı %${(playerShare * 100).toFixed(0)} — NPC kapasitesi geri çekiliyor`})`;
  return true;
}
