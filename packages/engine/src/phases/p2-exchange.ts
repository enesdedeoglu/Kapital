import { addBatch, consumeFefo, transfer, type Sql } from '@kapital/db';
import {
  matchBuyOrder, scarcityRation, shippingPerUnit,
  type BookOrder, type Match, type MatchCandidate,
} from '@kapital/economy';
import {
  InsufficientFunds, asMoney, asQty, deterministicUuid, priceTimesQty, qtyFromNumber, type Money,
} from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';

/** Bir alış emri için en fazla bu kadar eşleştirme turu — sonsuz döngü yok (R1 mantığı). */
const MAX_MATCH_ROUNDS = 3;

interface OrderRow {
  id: bigint; company_id: string; facility_id: string | null; city_id: number;
  remaining_quantity: bigint; price_per_unit: bigint; min_quality: string; quality: string;
  max_delivery_distance: number | null; created_epoch: number;
  logistics_modifier: number;
}

export interface ExchangePhaseResult {
  /** Kaç üründe kıtlık tayını uygulandı. */
  rationedProducts: number;
  products: number;
  matches: number;
  volume: bigint;
  goodsValue: bigint;
  shippingValue: bigint;
  shipmentsDispatched: number;
  shipmentsDelivered: number;
  deliveredUnits: bigint;
}

/**
 * P2 — TOPTAN PİYASA. Emir defteri eşleştirmesi ve sevkiyat.
 *
 * Shard anahtarı `product_id`: emir defteri ürün başına bölümlenir, böylece
 * iki worker asla aynı defteri görmez (ADR-0005). Oyuncunun uygulamadan emir
 * vermesiyle çakışmayı `pg_advisory_xact_lock` çözer (docs/06 §5).
 *
 * ESCROW YERİNE EŞLEŞME ANINDA BAKİYE DOĞRULAMASI (F4 kararı):
 * Ayrı bir escrow şirketi tutmak yerine para transferi eşleşme anında
 * denenir; bakiye yetmezse o eşleşme atlanır ve emir açık kalır. Satıcı zarar
 * görmez çünkü stok yalnız BAŞARILI eşleşmede tüketilir. Bu, bir sistem
 * şirketi ve para arzı ölçümünde bir sapma daha eklemekten yalındır.
 */
export async function runExchangePhase(sql: Sql, tick: EngineTick): Promise<ExchangePhaseResult> {
  const shippingCfg = configValue<{ baseRatePerKgDistance: string }>(
    tick, 'economy.shipping', { baseRatePerKgDistance: '3500' },
  );
  const baseRate = asMoney(BigInt(shippingCfg.baseRatePerKgDistance));

  const result: ExchangePhaseResult = {
    rationedProducts: 0,
    products: 0, matches: 0, volume: 0n, goodsValue: 0n, shippingValue: 0n,
    shipmentsDispatched: 0, shipmentsDelivered: 0, deliveredUnits: 0n,
  };
  const out = result as { -readonly [K in keyof ExchangePhaseResult]: ExchangePhaseResult[K] };

  const distances = await loadDistances(sql);
  const [sink] = await sql<{ id: string }[]>`SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;
  // Kıtlık tayını: asgari lot, payın anlamsız küçüklüğe inmesini engeller.
  const rationCfg = configValue<{ minLot: number }>(tick, 'economy.rationing', { minLot: 10 });

  // Yalnız alış emri olan ürünler taranır (madde 54)
  const products = await sql<{ id: number; weight_per_unit: number; shelf_life_ticks: number | null }[]>`
    SELECT DISTINCT p.id, p.weight_per_unit, p.shelf_life_ticks
    FROM market_orders o JOIN products p ON p.id = o.product_id
    WHERE o.side = 'BUY' AND o.status IN ('OPEN','PARTIAL') AND o.remaining_quantity > 0`;

  for (const product of products) {
    out.products++;
    // Emir defteri kilidi: oyuncu emirleriyle çakışmayı önler (docs/06 §5)
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'book:' + product.id}, 0))`;

    const buys = await loadOrders(sql, product.id, 'BUY');
    const sells = await loadOrders(sql, product.id, 'SELL');
    if (buys.length === 0 || sells.length === 0) continue;

    const remainingSell = new Map(sells.map((s) => [s.id, s.remaining_quantity]));

    /*
     * ★ KITLIKTA ADİL DAĞITIM.
     *
     * Alış emirleri fiyata göre sıralanır ve sırayla DOYANA KADAR doldurulur.
     * Gerçek bir borsada doğrudur; kıtlıkta oyunu kırar. Ölçüldü (F8): domates
     * arzı talebin dörtte biriyken 6 oyuncu arzın %85'ini aldı, 54 oyuncu
     * sıfır aldı ve 2.103 emri mal bulamadan öldü.
     *
     * Kıtlık varsa her ALICI ŞİRKET bu turda en fazla adil payını alır. Fiyat
     * önceliği kalkmaz: pay içinde yine en yüksek teklif önce eşleşir. Değişen
     * tek şey, bir alıcının tüm arzı süpürememesi.
     *
     * İki tur: önce tavanlı, sonra tavansız. İkincisi, fiyat veya mesafe
     * yüzünden eşleşemeyen alıcıların bıraktığı malı dağıtır — adalet uğruna
     * mal çürütülmez.
     */
    const totalSupply = sells.reduce((sum, s) => sum + s.remaining_quantity, 0n);
    const totalDemand = buys.reduce((sum, b) => sum + b.remaining_quantity, 0n);
    const buyerCount = new Set(buys.map((b) => b.company_id)).size;
    const ration = scarcityRation({
      totalSupply: asQty(totalSupply), totalDemand: asQty(totalDemand),
      buyerCount, minLot: qtyFromNumber(rationCfg.minLot),
    });
    if (ration !== null) out.rationedProducts++;

    /** Bu turda alıcı şirkete verilen toplam — tayın tavanı buna bakar. */
    const takenByCompany = new Map<string, bigint>();

    /** Emir bazında bu turda dolan miktar — ikinci turda kalanı bundan bulunur. */
    const filledByOrder = new Map<bigint, bigint>();

    for (const pass of ration === null ? [null] : [ration, null]) {
    for (const buyRow of buys) {
      // `buyRow` veritabanı anlık görüntüsüdür; ilk turda dolan miktar
      // düşülmezse ikinci tur aynı emri baştan doldurmaya çalışır.
      let buyRemaining = buyRow.remaining_quantity - (filledByOrder.get(buyRow.id) ?? 0n);
      if (buyRemaining <= 0n) continue;
      if (pass !== null) {
        const already = takenByCompany.get(buyRow.company_id) ?? 0n;
        const headroom = (pass as bigint) - already;
        if (headroom <= 0n) continue;
        if (buyRemaining > headroom) buyRemaining = headroom;
      }

      // Bir satıcıyla uzlaşma başarısız olabilir (malı gitmiş, alıcının parası
      // yetmemiş). Bu durumda emir tur boyunca kilitlenmemeli: satıcı devre dışı
      // bırakılıp sıradakine geçilir. Sabit tur sayısı sonsuz döngüyü engeller.
      for (let round = 0; round < MAX_MATCH_ROUNDS && buyRemaining > 0n; round++) {
        const available = sells.filter((s) => (remainingSell.get(s.id) ?? 0n) > 0n);
        if (available.length === 0) break;

        const candidates: MatchCandidate[] = available.map((s) => {
          const link = distances.get(`${s.city_id}:${buyRow.city_id}`) ?? { distance: 0, transit: 0 };
          return {
            sell: toBookOrder(s, remainingSell.get(s.id)!),
            shippingPerUnit: shippingPerUnit({
              weightPerUnit: product.weight_per_unit,
              distanceIndex: link.distance,
              baseRate,
              logisticsModifier: buyRow.logistics_modifier,
            }),
            distanceIndex: link.distance,
            transitTicks: link.transit,
          };
        });

        const { matches } = matchBuyOrder(toBookOrder(buyRow, buyRemaining), candidates);
        if (matches.length === 0) break;

        let progressed = false;
        for (const match of matches) {
          const applied = await settleMatch(sql, tick, match, {
            productId: product.id,
            shelfLife: product.shelf_life_ticks,
            sinkId: sink!.id,
            buyerCityId: buyRow.city_id,
            buyerFacilityId: buyRow.facility_id,
            sellerFacilityId: match.sell.facilityId,
          });

          if (applied.quantity <= 0n) {
            // Bu satıcı bu turda teslim edemiyor — devre dışı bırak
            remainingSell.set(match.sell.orderId, 0n);
            continue;
          }

          progressed = true;
          out.matches++;
          out.volume += applied.quantity;
          out.goodsValue += applied.goodsTotal;
          out.shippingValue += applied.shippingTotal;
          out.shipmentsDispatched++;
          buyRemaining -= applied.quantity;
          filledByOrder.set(buyRow.id, (filledByOrder.get(buyRow.id) ?? 0n) + applied.quantity);
          takenByCompany.set(
            buyRow.company_id,
            (takenByCompany.get(buyRow.company_id) ?? 0n) + applied.quantity,
          );
          remainingSell.set(
            match.sell.orderId,
            (remainingSell.get(match.sell.orderId) ?? 0n) - applied.quantity,
          );
        }
        if (!progressed && matches.length === 0) break;
      }
    }
    }
  }

  const delivered = await deliverArrivals(sql, tick);
  out.shipmentsDelivered = delivered.count;
  out.deliveredUnits = delivered.units;

  return result;
}

/** Tek eşleşmeyi uygular: stok çıkar, para akar, sevkiyat yola çıkar. */
async function settleMatch(
  sql: Sql,
  tick: EngineTick,
  match: Match,
  ctx: {
    productId: number; shelfLife: number | null; sinkId: string;
    buyerCityId: number; buyerFacilityId: string | null; sellerFacilityId: string | null;
  },
): Promise<{ quantity: bigint; goodsTotal: bigint; shippingTotal: bigint }> {
  if (!ctx.buyerFacilityId) return empty();

  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;

    /*
     * NPC SENTETİK ARZI (F6'ya kadar geçici):
     * MVP NPC satıcılarının tesisi ve envanteri yoktur — "sabit arz"
     * (docs/08 MVP-0). Malları emir verildiğinde yaratılır. F6'da gerçek NPC
     * ajanları kendi tesislerinde üretim yapacak ve bu dal kalkacak.
     * Para akışı GERÇEKTİR: alıcı öder, NPC alır, defter dengede kalır.
     */
    let quantity = match.quantity as bigint;
    let quality = match.sell.quality;

    if (ctx.sellerFacilityId !== null) {
      const [sellerInv] = await t<{ id: string }[]>`
        SELECT id FROM inventories WHERE facility_id = ${ctx.sellerFacilityId}::uuid`;
      if (!sellerInv) return empty();

      // Satıcının malı gerçekten var mı? Perakendeden satılmış olabilir.
      const consumed = await consumeFefo(t, {
        inventoryId: sellerInv.id, productId: ctx.productId, quantity: match.quantity,
      });
      if (consumed.allocated <= 0n) return empty();
      quantity = consumed.allocated as bigint;
      quality = consumed.weightedQuality;
    }
    const goodsTotal = priceTimesQty(match.pricePerUnit, asQty(quantity)).value;
    const shippingTotal = priceTimesQty(match.shippingPerUnit, asQty(quantity)).value;

    const txSeed = `${match.buy.orderId}:${match.sell.orderId}`;
    try {
      await transfer(t, {
        tickId: tick.seq,
        txId: deterministicUuid('trade', tick.seq, txSeed),
        fromCompanyId: match.buy.companyId,
        toCompanyId: match.sell.companyId,
        amount: goodsTotal,
        account: 'TRADE',
        reason: 'toptan piyasa eşleşmesi',
        refType: 'order',
        refId: match.sell.orderId.toString(),
      });
      if (shippingTotal > 0n) {
        // Nakliye bir sistem gideridir: para ekonomiden çıkar (madde 34)
        await transfer(t, {
          tickId: tick.seq,
          txId: deterministicUuid('shipping', tick.seq, txSeed),
          fromCompanyId: match.buy.companyId,
          toCompanyId: ctx.sinkId,
          amount: shippingTotal,
          account: 'SHIPPING',
          reason: 'nakliye bedeli',
          refType: 'order',
          refId: match.sell.orderId.toString(),
        });
      }
    } catch (error) {
      if (error instanceof InsufficientFunds) throw new BuyerBroke();
      throw error;
    }

    const [trade] = await t<{ id: bigint }[]>`
      INSERT INTO market_trades (tick_id, buy_order_id, sell_order_id, buyer_company_id,
                                 seller_company_id, product_id, from_city_id, to_city_id,
                                 quantity, price_per_unit, quality, shipping_cost)
      VALUES (${tick.seq}, ${match.buy.orderId}, ${match.sell.orderId},
              ${match.buy.companyId}::uuid, ${match.sell.companyId}::uuid, ${ctx.productId},
              ${match.sell.cityId}, ${ctx.buyerCityId}, ${quantity}, ${match.pricePerUnit},
              ${quality.toFixed(3)}, ${shippingTotal})
      RETURNING id`;

    // ★ Mesafe = maliyet + SÜRE (A3). Yoldaki mal hiçbir envanterde değildir.
    await t`
      INSERT INTO shipments (tick_id, trade_tick_id, trade_id, from_company_id, to_company_id,
                             from_facility_id, to_facility_id, product_id, quantity, quality,
                             unit_cost, shipping_cost, expires_at_tick,
                             dispatched_tick, arrival_tick)
      VALUES (${tick.seq}, ${tick.seq}, ${trade!.id}, ${match.sell.companyId}::uuid,
              ${match.buy.companyId}::uuid, ${ctx.sellerFacilityId ?? null}::uuid,
              ${ctx.buyerFacilityId}::uuid, ${ctx.productId}, ${quantity},
              ${quality.toFixed(3)}, ${match.pricePerUnit}, ${shippingTotal},
              ${ctx.shelfLife === null ? null : tick.seq + BigInt(ctx.shelfLife)},
              ${tick.seq}, ${tick.seq + BigInt(match.transitTicks)})`;

    await updateOrder(t, match.buy.orderId, quantity);
    await updateOrder(t, match.sell.orderId, quantity);

    for (const companyId of [match.buy.companyId, match.sell.companyId]) {
      await t`UPDATE company_stats SET total_trade_volume = total_trade_volume + ${goodsTotal}
              WHERE company_id = ${companyId}::uuid`;
    }

    return { quantity, goodsTotal: goodsTotal as bigint, shippingTotal: shippingTotal as bigint };
  }).catch((error: unknown) => {
    // Alıcının parası yetmedi: eşleşme atlanır, emir açık kalır, satıcının
    // stoğu geri alınır (transaction rollback).
    if (error instanceof BuyerBroke) return empty();
    throw error;
  }) as Promise<{ quantity: bigint; goodsTotal: bigint; shippingTotal: bigint }>;
}

class BuyerBroke extends Error {}
const empty = () => ({ quantity: 0n, goodsTotal: 0n, shippingTotal: 0n });

async function updateOrder(tx: Sql, orderId: bigint, quantity: bigint): Promise<void> {
  await tx`
    UPDATE market_orders
       SET remaining_quantity = remaining_quantity - ${quantity},
           status = CASE WHEN remaining_quantity - ${quantity} <= 0
                         THEN 'FILLED'::order_status ELSE 'PARTIAL'::order_status END
     WHERE id = ${orderId} AND remaining_quantity >= ${quantity}`;
}

/** Vadesi gelen sevkiyatları teslim eder. Depo doluysa kısmi teslim edilir. */
async function deliverArrivals(sql: Sql, tick: EngineTick): Promise<{ count: number; units: bigint }> {
  const due = await sql<{
    id: bigint; to_company_id: string; to_facility_id: string; from_facility_id: string | null;
    product_id: number; quantity: bigint; delivered_quantity: bigint; quality: string;
    unit_cost: bigint; expires_at_tick: bigint | null; inventory_id: string; free: bigint;
  }[]>`
    SELECT s.id, s.to_company_id, s.to_facility_id, s.from_facility_id, s.product_id,
           s.quantity, s.delivered_quantity, s.quality::text, s.unit_cost, s.expires_at_tick,
           i.id AS inventory_id, (i.capacity - i.used_capacity)::bigint AS free
    FROM shipments s
    JOIN inventories i ON i.facility_id = s.to_facility_id
    WHERE s.status IN ('IN_TRANSIT','PARTIAL') AND s.arrival_tick <= ${tick.seq}
    ORDER BY s.arrival_tick, s.id`;

  let count = 0;
  let units = 0n;

  /*
   * ★ Boş kapasite döngüden ÖNCE tek sorguda okunur. Aynı depoya birden çok
   * sevkiyat geldiğinde ikincisi bayat değeri kullanır ve depoyu taşırır;
   * `addBatch` STORAGE_FULL fırlatır ve TÜM TUR düşer.
   *
   * F8 simülasyonunda ortaya çıktı: oyuncular alım yapmaya başlayınca aynı
   * manavın deposuna iki sevkiyat aynı turda vardı ve tur çöktü.
   *
   * Bu harita, döngü içinde tüketilen kapasiteyi izler.
   */
  const consumed = new Map<string, bigint>();

  for (const shipment of due) {
    const pending = shipment.quantity - shipment.delivered_quantity;
    if (pending <= 0n) continue;
    const used = consumed.get(shipment.inventory_id) ?? 0n;
    const free = shipment.free - used;
    const deliverable = pending < free ? pending : free;
    if (deliverable <= 0n) continue; // depo dolu — sonraki turda tekrar denenir

    // İkinci kalkan: hesap doğru olsa bile tek bir sevkiyatın TÜM TURU
    // düşürmesine izin verilmez. Teslim edilemeyen sevkiyat bekler.
    try {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await addBatch(t, {
        inventoryId: shipment.inventory_id,
        productId: shipment.product_id,
        quantity: asQty(deliverable),
        quality: shipment.quality,
        unitCost: asMoney(shipment.unit_cost),
        producedInTick: null,
        expiresAtTick: shipment.expires_at_tick,
        sourceCompanyId: shipment.to_company_id,
        sourceFacilityId: shipment.from_facility_id,
      });
      await t`
        UPDATE shipments
           SET delivered_quantity = delivered_quantity + ${deliverable},
               status = CASE WHEN delivered_quantity + ${deliverable} >= quantity
                             THEN 'DELIVERED'::shipment_status
                             ELSE 'PARTIAL'::shipment_status END
         WHERE id = ${shipment.id}`;
    });
    } catch (error) {
      if ((error as { code?: string }).code !== 'STORAGE_FULL') throw error;
      continue;
    }

    consumed.set(shipment.inventory_id, used + deliverable);
    units += deliverable;
    if (deliverable >= pending) count++;
  }

  return { count, units };
}

async function loadOrders(sql: Sql, productId: number, side: 'BUY' | 'SELL'): Promise<OrderRow[]> {
  return sql<OrderRow[]>`
    SELECT o.id, o.company_id, o.facility_id, o.city_id, o.remaining_quantity,
           o.price_per_unit, o.min_quality::text, o.quality::text, o.max_delivery_distance,
           EXTRACT(EPOCH FROM o.created_at)::double precision AS created_epoch,
           c.logistics_modifier
    FROM market_orders o
    JOIN companies c ON c.id = o.company_id AND c.status = 'ACTIVE'
    WHERE o.product_id = ${productId} AND o.side = ${side}
      AND o.status IN ('OPEN','PARTIAL') AND o.remaining_quantity > 0
    ORDER BY ${side === 'BUY' ? sql`o.price_per_unit DESC` : sql`o.price_per_unit ASC`}, o.id`;
}

function toBookOrder(row: OrderRow, remaining: bigint): BookOrder {
  return {
    orderId: row.id,
    companyId: row.company_id,
    facilityId: row.facility_id,
    cityId: row.city_id,
    remaining: asQty(remaining),
    pricePerUnit: asMoney(row.price_per_unit),
    minQuality: Number(row.min_quality),
    quality: Number(row.quality),
    maxDeliveryDistance: row.max_delivery_distance,
    createdAt: row.created_epoch,
  };
}

async function loadDistances(sql: Sql): Promise<Map<string, { distance: number; transit: number }>> {
  const rows = await sql<{ o: number; d: number; distance_index: number; transit_ticks: number }[]>`
    SELECT origin_city_id AS o, destination_city_id AS d, distance_index, transit_ticks
    FROM city_distances`;
  return new Map(rows.map((r) => [`${r.o}:${r.d}`, { distance: r.distance_index, transit: r.transit_ticks }]));
}
