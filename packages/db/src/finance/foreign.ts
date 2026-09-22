import { expiryTick, fxConversion } from '@kapital/economy';
import { asMoney, asQty, NotFound, priceTimesQty, type Money } from '@kapital/shared';
import type { Sql } from '../client.js';
import { addBatch } from '../inventory/batches.js';
import { transfer } from './transfer.js';

/**
 * Döviz ve ithalatın DEFTER çekirdeği — API ile motor aynı kodu kullanır.
 *
 * ★★★★ NEDEN BURADA (R102). Bu işlemler önce yalnız API servisindeydi
 * (`apps/api/.../foreign.service.ts`) ve yalnız oyuncu kullanabiliyordu.
 * NPC'lerin kriz ithalatı (docs/12 §8, F6) aynı işlemi motordan yapmak
 * zorunda. Kodu ikinci bir yere kopyalamak, para hareketinin iki ayrı
 * yazımı demekti: biri spread'i bir hesaba, öteki başka bir hesaba yazar ve
 * I1 değişmezi (bakiye = defter) ancak bir sonraki kapı koşusunda patlar.
 * Para kodunda "aynı şeyi yapan iki fonksiyon" kabul edilemez.
 */

async function systemId(tx: Sql, code: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`SELECT id FROM companies WHERE system_code = ${code}`;
  if (!row) throw new NotFound('Sistem şirketi', code);
  return row.id;
}

export interface FxBuyResult {
  /** Şirketten çıkan toplam ₺ (spread dahil). */
  readonly tryAmount: Money;
  readonly spread: Money;
}

/**
 * ₺ → $ dönüşümü (BUY_USD). `fxConversion` spread'i ALIRKEN EKLER.
 *
 *   ₺ defteri : şirket → SYS_FX  (brüt)      · şirket → SYS_SINK (spread)
 *   $ defteri : SYS_FX → şirket  (usdAmount)
 *
 * Spread SYS_SINK'e gider: gidip gelmek bedava değildir (docs/12 §5).
 */
export async function buyUsd(tx: Sql, input: {
  tickId: bigint; companyId: string; usdAmount: Money; rate: Money; spreadPct: number;
  reason?: string;
}): Promise<FxBuyResult> {
  const { tryAmount, spread } = fxConversion(input.usdAmount, input.rate, input.spreadPct, 'BUY_USD');
  const fx = await systemId(tx, 'SYS_FX');
  const sink = await systemId(tx, 'SYS_SINK');
  const reason = input.reason ?? 'döviz alımı';

  await transfer(tx, {
    tickId: input.tickId, fromCompanyId: input.companyId, toCompanyId: fx,
    amount: asMoney((tryAmount as bigint) - (spread as bigint)),
    account: 'FX_CONVERSION', reason,
  });
  await transfer(tx, {
    tickId: input.tickId, fromCompanyId: fx, toCompanyId: input.companyId,
    amount: input.usdAmount, currency: 'USD', account: 'FX_CONVERSION', reason,
  });
  await transfer(tx, {
    tickId: input.tickId, fromCompanyId: input.companyId, toCompanyId: sink,
    amount: spread, account: 'FX_SPREAD', reason: 'döviz komisyonu',
  });
  await tx`
    INSERT INTO fx_trades (tick_id, company_id, side, usd_amount, try_amount, rate, spread_paid)
    VALUES (${input.tickId}, ${input.companyId}::uuid, 'BUY_USD', ${input.usdAmount},
            ${tryAmount}, ${input.rate}, ${spread})`;

  return { tryAmount, spread };
}

/**
 * $ → ₺ dönüşümü (SELL_USD). `fxConversion` spread'i SATARKEN DÜŞER.
 *
 *   $ defteri : şirket → SYS_FX  (usdAmount)
 *   ₺ defteri : SYS_FX → şirket  (brüt)      · şirket → SYS_SINK (spread)
 */
export async function sellUsd(tx: Sql, input: {
  tickId: bigint; companyId: string; usdAmount: Money; rate: Money; spreadPct: number;
}): Promise<FxBuyResult> {
  const { tryAmount, spread } = fxConversion(input.usdAmount, input.rate, input.spreadPct, 'SELL_USD');
  const fx = await systemId(tx, 'SYS_FX');
  const sink = await systemId(tx, 'SYS_SINK');

  await transfer(tx, {
    tickId: input.tickId, fromCompanyId: input.companyId, toCompanyId: fx,
    amount: input.usdAmount, currency: 'USD', account: 'FX_CONVERSION', reason: 'döviz satışı',
  });
  await transfer(tx, {
    tickId: input.tickId, fromCompanyId: fx, toCompanyId: input.companyId,
    amount: asMoney((tryAmount as bigint) + (spread as bigint)),
    account: 'FX_CONVERSION', reason: 'döviz satışı',
  });
  await transfer(tx, {
    tickId: input.tickId, fromCompanyId: input.companyId, toCompanyId: sink,
    amount: spread, account: 'FX_SPREAD', reason: 'döviz komisyonu',
  });
  await tx`
    INSERT INTO fx_trades (tick_id, company_id, side, usd_amount, try_amount, rate, spread_paid)
    VALUES (${input.tickId}, ${input.companyId}::uuid, 'SELL_USD', ${input.usdAmount},
            ${tryAmount}, ${input.rate}, ${spread})`;

  return { tryAmount, spread };
}

export interface ImportInput {
  tickId: bigint;
  companyId: string;
  facilityId: string;
  inventoryId: string;
  productId: number;
  quantity: bigint;
  /** Birim ithalat fiyatı, $ (dünya fiyatı × ithalat çarpanı). */
  unitUsd: Money;
  quality: number;
  shelfLifeTicks: number | null;
  /** ₺/$ — mal maliyetini ve ₺ karşılığını yazmak için. */
  rate: Money;
  reason: string;
}

export interface ImportResult {
  readonly usdTotal: Money;
  /** Parti maliyeti ve ticaret dengesi için ₺ karşılığı. */
  readonly tryEquivalent: Money;
}

/**
 * İthalat: $ SYS_WORLD'e gider, mal tesisin deposuna girer, kapasiteden düşer.
 *
 * ★ Çağıran $ bakiyesini ÖNCEDEN sağlar (oyuncu `convert` ile, NPC aynı
 * turda `buyUsd` ile). Yetmezse `transfer` InsufficientFunds fırlatır ve
 * işlem geri alınır — mal defterden önce gelmez.
 *
 * ★ `foreign_trades` kaydı ŞART: kurun ticaret dengesi terimi (docs/12 §4)
 * oradan okunur. Kayıtsız ithalat, kuru hiç etkilemeyen görünmez bir ithalat
 * olurdu.
 */
export async function importGoods(tx: Sql, input: ImportInput): Promise<ImportResult> {
  const usdTotal = priceTimesQty(input.unitUsd, asQty(input.quantity)).value;
  const world = await systemId(tx, 'SYS_WORLD');

  await transfer(tx, {
    tickId: input.tickId, fromCompanyId: input.companyId, toCompanyId: world,
    amount: usdTotal, currency: 'USD', account: 'FOREIGN_TRADE',
    reason: input.reason, refType: 'facility', refId: input.facilityId,
  });

  const unitTry = asMoney(((input.unitUsd as bigint) * (input.rate as bigint)) / 10_000n);
  const tryEquivalent = asMoney(((usdTotal as bigint) * (input.rate as bigint)) / 10_000n);

  await addBatch(tx, {
    inventoryId: input.inventoryId, productId: input.productId,
    quantity: asQty(input.quantity), quality: input.quality, unitCost: unitTry,
    producedInTick: input.tickId, expiresAtTick: expiryTick(input.tickId, input.shelfLifeTicks),
  });

  await tx`
    INSERT INTO foreign_trades (tick_id, company_id, facility_id, product_id, direction,
                                quantity, unit_price_usd, usd_amount, try_equivalent, quality)
    VALUES (${input.tickId}, ${input.companyId}::uuid, ${input.facilityId}::uuid, ${input.productId},
            'IMPORT'::trade_direction, ${input.quantity}, ${input.unitUsd}, ${usdTotal},
            ${tryEquivalent}, ${input.quality.toFixed(3)})
    ON CONFLICT (tick_id, company_id, facility_id, product_id, direction)
    DO UPDATE SET quantity = foreign_trades.quantity + EXCLUDED.quantity,
                  usd_amount = foreign_trades.usd_amount + EXCLUDED.usd_amount,
                  try_equivalent = foreign_trades.try_equivalent + EXCLUDED.try_equivalent`;

  await tx`UPDATE foreign_trade_capacity SET import_used = import_used + ${input.quantity}
            WHERE tick_id = ${input.tickId} AND product_id = ${input.productId}`;

  return { usdTotal, tryEquivalent };
}
