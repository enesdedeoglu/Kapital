/**
 * Simülasyon döngüsü.
 *
 * Her tur: karar veren oyuncular hareket eder → tur koşar → ölçüm alınır.
 * Oyuncular AYNI turda toplu hareket etmez; profilin `actEveryTicks` değeri
 * ve oyuncu indeksi kaydırması yükü zamana yayar (gerçek oyuncu tabanı da
 * böyledir).
 */
import type { Sql } from '@kapital/db';
import { loadReferencePrices, runTick } from '@kapital/engine';
import {
  actPlayer, loadDecisionContext, loadPlayerStates, makeServices,
  type ActionCounters, type FacilityState, type StockState,
} from './behaviour.js';
import { actsThisTick } from './profiles.js';
import type { SimPlayer } from './world.js';

export interface TickSample {
  readonly seq: bigint;
  readonly durationMs: number;
  readonly moneySupply: number;
  readonly cpi: number;
  readonly trades: number;
  readonly retailRevenue: number;
  readonly actingPlayers: number;
}

export interface RunResult {
  readonly samples: TickSample[];
  readonly counters: ActionCounters;
  readonly firstTick: bigint;
  readonly lastTick: bigint;
}

export async function runSimulation(
  sql: Sql,
  players: readonly SimPlayer[],
  opts: { ticks: number; reportEvery: number; onReport?: (s: TickSample) => void },
): Promise<RunResult> {
  const services = makeServices(sql);
  const counters: ActionCounters = {
    retailPrices: 0, standingRules: 0, buyOrders: 0, sellOrders: 0, builds: 0,
    recipes: 0, loans: 0, errors: 0, errorsByCode: new Map(),
  };
  // Kurulmuş kalıcı emirler — her turda yeniden kurulmaya çalışılmasın.
  const standingSet = new Set<string>();
  const samples: TickSample[] = [];
  let firstTick = 0n;

  for (let i = 0; i < opts.ticks; i++) {
    const [current] = await sql<{ seq: bigint }[]>`
      SELECT COALESCE(MAX(seq), 0) AS seq FROM economic_ticks`;
    const nextSeq = (current?.seq ?? 0n) + 1n;

    const acting = players.filter((p) => actsThisTick(p.profile, p.index, nextSeq));
    if (acting.length > 0) {
      const references = await loadReferencePrices(sql, nextSeq);
      const ctx = await loadDecisionContext(sql, references);
      const state = await loadPlayerStates(sql, acting.map((p) => p.companyId));

      const byCompany = new Map(state.players.map((p) => [p.company_id, p]));
      const facilitiesByCompany = new Map<string, FacilityState[]>();
      for (const f of state.facilities) {
        const list = facilitiesByCompany.get(f.company_id) ?? [];
        list.push(f);
        facilitiesByCompany.set(f.company_id, list);
      }
      const stockByInventory = new Map<string, StockState[]>();
      for (const s of state.stock) {
        const list = stockByInventory.get(s.inventory_id) ?? [];
        list.push(s);
        stockByInventory.set(s.inventory_id, list);
      }

      for (const player of acting) {
        const playerState = byCompany.get(player.companyId);
        if (!playerState) continue;
        await actPlayer(
          services, player, ctx, playerState,
          facilitiesByCompany.get(player.companyId) ?? [], stockByInventory, counters,
          standingSet,
        );
      }
    }

    const result = await runTick(sql);
    if (result.skipped) throw new Error('tur atlandı — kilit tutulu');
    if (firstTick === 0n) firstTick = result.seq;

    const retail = result.phases.RETAIL?.result as { revenue?: bigint } | undefined;
    const exchange = result.phases.EXCHANGE?.result as { matches?: number } | undefined;
    const settle = result.phases.SETTLE?.result as { gameCpi?: number } | undefined;
    const [snap] = await sql<{ supply: string }[]>`
      SELECT total_money_supply::text AS supply FROM economy_snapshots
       WHERE tick_id = ${result.seq}`;

    const sample: TickSample = {
      seq: result.seq,
      durationMs: result.durationMs,
      moneySupply: Number(snap?.supply ?? 0) / 10_000,
      cpi: settle?.gameCpi ?? 1,
      trades: exchange?.matches ?? 0,
      retailRevenue: Number(retail?.revenue ?? 0n) / 10_000,
      actingPlayers: acting.length,
    };
    samples.push(sample);
    if ((i + 1) % opts.reportEvery === 0 || i === 0) opts.onReport?.(sample);
  }

  return {
    samples, counters, firstTick,
    lastTick: samples.at(-1)?.seq ?? firstTick,
  };
}
