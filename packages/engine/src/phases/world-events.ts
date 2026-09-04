import type { Sql } from '@kapital/db';
import {
  rollWorldEvent, DEFAULT_EVENT_CONFIG,
  type ActiveEvent, type EventGeneratorConfig,
} from '@kapital/economy';
import { configValue, rngFor, type EngineTick } from '../context.js';
import { PHASE } from '../phases.js';

export interface WorldEventResult {
  active: number;
  started: number;
  ended: number;
}

/**
 * DÜNYA OLAYLARI — madde 30/45, docs/05 §P0.2.
 *
 * Ekonominin havasıdır: kuraklık, bayram, enerji krizi, sağlık uyarısı.
 * Onsuz Kapital doğru çalışan ama tepki verilecek hiçbir şeyi olmayan bir
 * arz-talep öğütmesi kalır — F8'de ölçülen fiyat oynaklığı %0,1'di, hedef
 * %5–15. Spekülatör arketipinin var olma sebebi de burada.
 *
 * P0'da koşar (docs/05: "Aktif world_events çarpanlarını hesapla ve tick
 * context'ine yaz"): olay bu turun ÜRETİMİNİ ve TALEBİNİ etkiler, dolayısıyla
 * P1'den önce yerini almalıdır.
 *
 * Rastgelelik tohumludur (`rngFor`): aynı tohum aynı dünyayı üretir, denge
 * koşuları tekrarlanabilir olur (ADR-0003).
 */
export async function runWorldEvents(sql: Sql, tick: EngineTick): Promise<WorldEventResult> {
  const config = configValue<EventGeneratorConfig>(tick, 'world.events', DEFAULT_EVENT_CONFIG);

  const active = await loadActiveEvents(sql, tick);
  const [ended] = await sql<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM world_events WHERE end_tick = ${tick.seq}`;

  // Biten olaylar duyurulur: oyuncu kuraklığın bittiğini de görmeli.
  const finished = await sql<{ id: bigint; name: string; code: string }[]>`
    SELECT id, name, code FROM world_events WHERE end_tick = ${tick.seq}`;
  for (const event of finished) {
    await notice(sql, tick, {
      kind: 'WORLD_EVENT_ENDED', severity: 'INFO',
      title: `${event.name} sona erdi`,
      body: 'Etkileri bu turdan itibaren geçerli değil.',
      payload: { code: event.code },
      dedupeKey: `event-end:${event.id}`,
    });
  }

  const products = await sql<{ id: number; code: string }[]>`
    SELECT id, code FROM products WHERE is_active ORDER BY id`;
  const cities = await sql<{ id: number; name: string }[]>`
    SELECT id, name FROM cities WHERE is_active ORDER BY id`;

  const recent = await sql<{ code: string; ended: bigint }[]>`
    SELECT code, MAX(end_tick) AS ended FROM world_events
     WHERE end_tick <= ${tick.seq} GROUP BY code`;

  const rolled = rollWorldEvent({
    rng: rngFor(tick, PHASE.OPEN, 0, 'world-event'),
    activeCount: active.length,
    lastEndedByCode: new Map(recent.map((r) => [r.code, r.ended])),
    tickSeq: tick.seq,
    productCodes: products.map((p) => p.code),
    cityCount: cities.length,
    config,
  });

  let started = 0;
  if (rolled) {
    const product = rolled.productCode
      ? products.find((p) => p.code === rolled.productCode) ?? null : null;
    const city = rolled.cityIndex !== undefined ? cities[rolled.cityIndex] ?? null : null;
    const t = rolled.template;

    const inserted = await sql<{ id: bigint }[]>`
      INSERT INTO world_events (code, name, description, scope, product_id, city_id, category,
                                demand_multiplier, supply_multiplier, cost_multiplier,
                                start_tick, end_tick)
      VALUES (${t.code}, ${t.name}, ${t.description}, ${t.scope},
              ${product?.id ?? null}, ${city?.id ?? null}, ${t.category ?? null},
              ${t.demandMultiplier}, ${t.supplyMultiplier}, ${t.costMultiplier},
              ${tick.seq}, ${tick.seq + BigInt(rolled.durationTicks)})
      ON CONFLICT DO NOTHING
      RETURNING id`;

    if (inserted.length > 0) {
      started = 1;
      const where = product ? ` — ${product.code}` : city ? ` — ${city.name}` : '';
      await notice(sql, tick, {
        kind: 'WORLD_EVENT_STARTED',
        severity: t.supplyMultiplier < 1 || t.demandMultiplier < 1 ? 'WARNING' : 'INFO',
        title: `${t.name}${where}`,
        body: `${t.description} Yaklaşık ${Math.round(rolled.durationTicks / 96)} gün sürecek.`,
        payload: {
          code: t.code, scope: t.scope,
          demand: t.demandMultiplier, supply: t.supplyMultiplier, cost: t.costMultiplier,
          endsAtTick: (tick.seq + BigInt(rolled.durationTicks)).toString(),
        },
        dedupeKey: `event-start:${inserted[0]!.id}`,
      });
    }
  }

  return { active: active.length + started, started, ended: Number(ended?.count ?? 0n) };
}

/** Bu turda yürürlükte olan olaylar — P1 ve P3 bunları çarpan olarak kullanır. */
export async function loadActiveEvents(sql: Sql, tick: EngineTick): Promise<ActiveEvent[]> {
  return sql<ActiveEvent[]>`
    SELECT scope, product_id AS "productId", city_id AS "cityId", category,
           demand_multiplier AS "demandMultiplier",
           supply_multiplier AS "supplyMultiplier",
           cost_multiplier AS "costMultiplier"
      FROM world_events
     WHERE start_tick <= ${tick.seq} AND end_tick > ${tick.seq}`;
}

interface Notice {
  kind: string; severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string; body: string; payload: unknown; dedupeKey: string;
  productId?: number; cityId?: number;
}

async function notice(sql: Sql, tick: EngineTick, event: Notice): Promise<void> {
  await sql`
    INSERT INTO world_notices (tick_id, kind, product_id, city_id, severity, title, body,
                               payload, dedupe_key)
    VALUES (${tick.seq}, ${event.kind}, ${event.productId ?? null}, ${event.cityId ?? null},
            ${event.severity}, ${event.title}, ${event.body},
            ${JSON.stringify(event.payload)}::text::jsonb, ${event.dedupeKey})
    ON CONFLICT (dedupe_key) DO NOTHING`;
}
