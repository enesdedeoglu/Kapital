import { Inject, Injectable } from '@nestjs/common';
import {
  addBatch, consumeFefo, currentTickSeq, runInTransaction, transfer, type Sql,
} from '@kapital/db';
import { expiryTick, foreignPrices, fxConversion } from '@kapital/economy';
import {
  asMoney, asQty, DomainError, formatMoney, formatQty, InsufficientFunds,
  NotFound, priceTimesQty, qtyFromNumber, type Money,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { ForeignTradeDto, FxConvertDto } from './foreign.dto.js';

interface PortContext {
  companyId: string; level: number; cash: bigint; usd: bigint;
  facilityId: string; inventoryId: string; cityName: string; free: bigint;
}

@Injectable()
export class ForeignService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /** Bu turda kalan ithalat/ihracat derinliği ve dünya fiyatları. */
  async capacity() {
    const tickSeq = await currentTickSeq(this.sql);
    const cfg = await this.foreignConfig();

    const rows = await this.sql<{
      product_id: number; code: string; name: string; unit: string;
      import_capacity: bigint; import_used: bigint;
      export_capacity: bigint; export_used: bigint; world_price_usd: bigint;
      importable: boolean; exportable: boolean; import_quota_mult: number;
    }[]>`
      SELECT c.product_id, p.code, p.name, p.unit,
             c.import_capacity, c.import_used, c.export_capacity, c.export_used,
             c.world_price_usd, w.importable, w.exportable, c.import_quota_mult
      FROM foreign_trade_capacity c
      JOIN products p ON p.id = c.product_id
      JOIN world_market w ON w.product_id = c.product_id
      WHERE c.tick_id = ${tickSeq} AND (w.importable OR w.exportable)
      ORDER BY p.id`;

    const [fxRate] = await this.sql<{ rate: bigint }[]>`
      SELECT rate_try_per_usd AS rate FROM fx_rates ORDER BY tick_id DESC LIMIT 1`;
    const rate = asMoney(fxRate?.rate ?? 350_000n);

    return {
      tickSeq: tickSeq.toString(),
      fxRate: rate.toString(),
      fxRateFormatted: formatMoney(rate),
      products: rows.map((r) => {
        const world = asMoney(r.world_price_usd);
        const { exportUsd, importUsd } = foreignPrices(
          world, cfg.exportMultiplier, cfg.importMultiplier,
        );
        return {
          code: r.code, name: r.name, unit: r.unit,
          worldPriceUsd: world.toString(),
          importable: r.importable,
          exportable: r.exportable,
          // ★ Fiyatı oyuncu belirlemez; band ~%60 (docs/12 §3.2, R18)
          importPriceUsd: importUsd.toString(),
          exportPriceUsd: exportUsd.toString(),
          importRemaining: (r.import_capacity - r.import_used).toString(),
          exportRemaining: (r.export_capacity - r.export_used).toString(),
          importQuotaMultiplier: r.import_quota_mult,
        };
      }),
    };
  }

  /** Dünya piyasasından ithalat — mal limana gelir, USD ile ödenir. */
  async import(userId: string, dto: ForeignTradeDto) {
    const ctx = await this.port(userId, dto.facilityId);
    const cfg = await this.foreignConfig();
    const { product, capacity } = await this.tradeContext(dto.productCode, 'IMPORT');
    const tickSeq = await currentTickSeq(this.sql);

    const remaining = capacity.import_capacity - capacity.import_used;
    if (remaining <= 0n) {
      throw new DomainError('CONFLICT', 'Bu turda ithalat kapasitesi doldu', {
        productCode: product.code,
      });
    }

    const wanted = qtyFromNumber(dto.quantity);
    const quantity = min(min(wanted, remaining), ctx.free);
    if (quantity <= 0n) {
      throw new DomainError('STORAGE_FULL', 'Limanın deposunda yer yok');
    }

    const { importUsd } = foreignPrices(
      asMoney(capacity.world_price_usd), cfg.exportMultiplier, cfg.importMultiplier,
    );
    const usdTotal = priceTimesQty(importUsd, asQty(quantity)).value;
    if (ctx.usd < usdTotal) {
      throw new InsufficientFunds({
        message: 'Yetersiz döviz — önce ₺ bozdurun',
        requiredUsd: usdTotal.toString(), availableUsd: ctx.usd.toString(),
      });
    }

    await runInTransaction(this.sql, async (tx) => {
      const world = await this.systemId(tx, 'SYS_WORLD');
      await transfer(tx, {
        tickId: tickSeq, fromCompanyId: ctx.companyId, toCompanyId: world,
        amount: usdTotal, currency: 'USD', account: 'FOREIGN_TRADE',
        reason: `${product.name} ithalatı`, refType: 'facility', refId: ctx.facilityId,
      });
      await addBatch(tx, {
        inventoryId: ctx.inventoryId, productId: product.id, quantity: asQty(quantity),
        quality: capacity.world_quality, unitCost: await this.tryValue(tx, importUsd),
        producedInTick: tickSeq, expiresAtTick: expiryTick(tickSeq, product.shelf_life_ticks),
      });
      await this.recordForeign(tx, tickSeq, ctx, product.id, 'IMPORT', quantity,
        importUsd, usdTotal, capacity.world_quality);
      await tx`UPDATE foreign_trade_capacity SET import_used = import_used + ${quantity}
                WHERE tick_id = ${tickSeq} AND product_id = ${product.id}`;
    });

    return this.tradeResult('İTHALAT', product, quantity, importUsd, usdTotal, wanted);
  }

  /** Dünya piyasasına ihracat — mal limandan çıkar, USD kazanılır. */
  async export(userId: string, dto: ForeignTradeDto) {
    const ctx = await this.port(userId, dto.facilityId);
    const cfg = await this.foreignConfig();
    const { product, capacity } = await this.tradeContext(dto.productCode, 'EXPORT');
    const tickSeq = await currentTickSeq(this.sql);

    const remaining = capacity.export_capacity - capacity.export_used;
    if (remaining <= 0n) {
      throw new DomainError('CONFLICT', 'Bu turda ihracat kapasitesi doldu', {
        productCode: product.code,
      });
    }

    const wanted = min(qtyFromNumber(dto.quantity), remaining);
    const { exportUsd } = foreignPrices(
      asMoney(capacity.world_price_usd), cfg.exportMultiplier, cfg.importMultiplier,
    );

    const sold = await runInTransaction(this.sql, async (tx) => {
      const consumed = await consumeFefo(tx, {
        inventoryId: ctx.inventoryId, productId: product.id, quantity: asQty(wanted),
      });
      if (consumed.allocated <= 0n) return { quantity: 0n, usdTotal: 0n as Money };

      const usdTotal = priceTimesQty(exportUsd, consumed.allocated).value;
      const world = await this.systemId(tx, 'SYS_WORLD');
      await transfer(tx, {
        tickId: tickSeq, fromCompanyId: world, toCompanyId: ctx.companyId,
        amount: usdTotal, currency: 'USD', account: 'FOREIGN_TRADE',
        reason: `${product.name} ihracatı`, refType: 'facility', refId: ctx.facilityId,
      });
      await this.recordForeign(tx, tickSeq, ctx, product.id, 'EXPORT',
        consumed.allocated as bigint, exportUsd, usdTotal, consumed.weightedQuality);
      await tx`UPDATE foreign_trade_capacity SET export_used = export_used + ${consumed.allocated}
                WHERE tick_id = ${tickSeq} AND product_id = ${product.id}`;
      return { quantity: consumed.allocated as bigint, usdTotal };
    });

    if (sold.quantity <= 0n) {
      throw new DomainError('INSUFFICIENT_STOCK', `Limanda ihraç edilecek ${product.name} yok`);
    }
    return this.tradeResult('İHRACAT', product, sold.quantity, exportUsd, sold.usdTotal, wanted);
  }

  /**
   * Kur işlemi — ₺ ↔ $ (docs/12 §2.1, S4).
   *
   * Tek taraflı bir "dönüşüm" DEĞİL, iki ayrı transferdir: karşı taraf
   * `SYS_FX`'tir ve her iki para biriminin defteri ayrı ayrı dengede kalır.
   * Spread `SYS_SINK`'e gider — round-trip bedava olmaz.
   */
  async convert(userId: string, dto: FxConvertDto) {
    const [company] = await this.sql<{ id: string; level: number; cash: bigint; usd_balance: bigint }[]>`
      SELECT id, level, cash, usd_balance FROM companies WHERE user_id = ${userId}::uuid`;
    if (!company) throw new NotFound('Şirket');

    const fx = await this.fxConfig();
    if (company.level < fx.unlockLevel) {
      throw new DomainError('LEVEL_LOCKED', `Döviz işlemi için seviye ${fx.unlockLevel} gerekli`, {
        required: fx.unlockLevel, current: company.level,
      });
    }

    const tickSeq = await currentTickSeq(this.sql);
    const [rateRow] = await this.sql<{ rate: bigint }[]>`
      SELECT rate_try_per_usd AS rate FROM fx_rates ORDER BY tick_id DESC LIMIT 1`;
    const rate = asMoney(rateRow?.rate ?? BigInt(Math.round(fx.rate0 * 10_000)));

    const usdAmount = asMoney(BigInt(Math.round(dto.usdAmount * 10_000)));
    const { tryAmount, spread } = fxConversion(usdAmount, rate, fx.spreadPct, dto.side);

    await runInTransaction(this.sql, async (tx) => {
      const fxCompany = await this.systemId(tx, 'SYS_FX');
      const sink = await this.systemId(tx, 'SYS_SINK');

      if (dto.side === 'BUY_USD') {
        // ₺ defteri: oyuncu → SYS_FX · $ defteri: SYS_FX → oyuncu
        await transfer(tx, {
          tickId: tickSeq, fromCompanyId: company.id, toCompanyId: fxCompany,
          amount: asMoney((tryAmount as bigint) - (spread as bigint)),
          account: 'FX_CONVERSION', reason: 'döviz alımı',
        });
        await transfer(tx, {
          tickId: tickSeq, fromCompanyId: fxCompany, toCompanyId: company.id,
          amount: usdAmount, currency: 'USD', account: 'FX_CONVERSION', reason: 'döviz alımı',
        });
        await transfer(tx, {
          tickId: tickSeq, fromCompanyId: company.id, toCompanyId: sink,
          amount: spread, account: 'FX_SPREAD', reason: 'döviz komisyonu',
        });
      } else {
        await transfer(tx, {
          tickId: tickSeq, fromCompanyId: company.id, toCompanyId: fxCompany,
          amount: usdAmount, currency: 'USD', account: 'FX_CONVERSION', reason: 'döviz satışı',
        });
        await transfer(tx, {
          tickId: tickSeq, fromCompanyId: fxCompany, toCompanyId: company.id,
          amount: asMoney((tryAmount as bigint) + (spread as bigint)),
          account: 'FX_CONVERSION', reason: 'döviz satışı',
        });
        await transfer(tx, {
          tickId: tickSeq, fromCompanyId: company.id, toCompanyId: sink,
          amount: spread, account: 'FX_SPREAD', reason: 'döviz komisyonu',
        });
      }

      await tx`
        INSERT INTO fx_trades (tick_id, company_id, side, usd_amount, try_amount, rate, spread_paid)
        VALUES (${tickSeq}, ${company.id}::uuid, ${dto.side}, ${usdAmount},
                ${tryAmount}, ${rate}, ${spread})`;
    });

    const [after] = await this.sql<{ cash: bigint; usd_balance: bigint }[]>`
      SELECT cash, usd_balance FROM companies WHERE id = ${company.id}::uuid`;
    return {
      side: dto.side,
      usdAmount: usdAmount.toString(),
      tryAmount: tryAmount.toString(),
      tryAmountFormatted: formatMoney(tryAmount),
      rate: rate.toString(),
      rateFormatted: formatMoney(rate),
      spread: spread.toString(),
      spreadFormatted: formatMoney(spread),
      balances: {
        cash: after!.cash.toString(),
        cashFormatted: formatMoney(asMoney(after!.cash)),
        usd: after!.usd_balance.toString(),
      },
    };
  }

  /* ------------------------------------------------------------------ */

  private async port(userId: string, facilityId: string): Promise<PortContext> {
    const [row] = await this.sql<{
      company_id: string; level: number; cash: bigint; usd_balance: bigint;
      facility_id: string; inventory_id: string; city_name: string; free: bigint;
      requires_port: boolean; ready: boolean;
    }[]>`
      SELECT co.id AS company_id, co.level, co.cash, co.usd_balance,
             f.id AS facility_id, i.id AS inventory_id, c.name AS city_name,
             (i.capacity - i.used_capacity)::bigint AS free, ft.requires_port,
             (f.construction_complete_at_tick <= COALESCE(
               (SELECT MAX(seq) FROM economic_ticks), 0)) AS ready
      FROM facilities f
      JOIN facility_types ft ON ft.id = f.facility_type_id
      JOIN companies co ON co.id = f.company_id
      JOIN inventories i ON i.facility_id = f.id
      JOIN cities c ON c.id = f.city_id
      WHERE f.id = ${facilityId}::uuid AND co.user_id = ${userId}::uuid AND f.closed_at IS NULL`;
    if (!row) throw new NotFound('Tesis', facilityId);
    if (!row.requires_port) {
      throw new DomainError('VALIDATION', 'Dış ticaret yalnız Liman üzerinden yapılır');
    }
    if (!row.ready) throw new DomainError('CONFLICT', 'Liman inşaatı henüz bitmedi');

    const fx = await this.fxConfig();
    if (row.level < fx.unlockLevel) {
      throw new DomainError('LEVEL_LOCKED', `Dış ticaret için seviye ${fx.unlockLevel} gerekli`, {
        required: fx.unlockLevel, current: row.level,
      });
    }
    return {
      companyId: row.company_id, level: row.level, cash: row.cash, usd: row.usd_balance,
      facilityId: row.facility_id, inventoryId: row.inventory_id,
      cityName: row.city_name, free: row.free,
    };
  }

  private async tradeContext(productCode: string, direction: 'IMPORT' | 'EXPORT') {
    const tickSeq = await currentTickSeq(this.sql);
    const [row] = await this.sql<{
      id: number; code: string; name: string; unit: string; shelf_life_ticks: number | null;
      importable: boolean; exportable: boolean;
      import_capacity: bigint; import_used: bigint;
      export_capacity: bigint; export_used: bigint;
      world_price_usd: bigint; world_quality: string;
    }[]>`
      SELECT p.id, p.code, p.name, p.unit, p.shelf_life_ticks,
             w.importable, w.exportable, w.world_quality::text,
             c.import_capacity, c.import_used, c.export_capacity, c.export_used, c.world_price_usd
      FROM products p
      JOIN world_market w ON w.product_id = p.id
      JOIN foreign_trade_capacity c ON c.product_id = p.id AND c.tick_id = ${tickSeq}
      WHERE p.code = ${productCode} AND p.is_active`;
    if (!row) throw new NotFound('Dış ticaret kaydı', productCode);

    if (direction === 'IMPORT' && !row.importable) {
      throw new DomainError('VALIDATION',
        `${row.name} ithal edilemez — nihai perakende ürünleri yurt içinde üretilir (docs/12 §3.4)`);
    }
    if (direction === 'EXPORT' && !row.exportable) {
      throw new DomainError('VALIDATION', `${row.name} ihraç edilemez`);
    }

    return {
      product: { id: row.id, code: row.code, name: row.name, unit: row.unit, shelf_life_ticks: row.shelf_life_ticks },
      capacity: {
        import_capacity: row.import_capacity, import_used: row.import_used,
        export_capacity: row.export_capacity, export_used: row.export_used,
        world_price_usd: row.world_price_usd, world_quality: Number(row.world_quality),
      },
    };
  }

  private async recordForeign(
    tx: Sql, tickSeq: bigint, ctx: PortContext, productId: number,
    direction: 'IMPORT' | 'EXPORT', quantity: bigint,
    unitUsd: Money, usdTotal: Money, quality: number,
  ) {
    const tryEquivalent = await this.tryValue(tx, usdTotal);
    await tx`
      INSERT INTO foreign_trades (tick_id, company_id, facility_id, product_id, direction,
                                  quantity, unit_price_usd, usd_amount, try_equivalent, quality)
      VALUES (${tickSeq}, ${ctx.companyId}::uuid, ${ctx.facilityId}::uuid, ${productId},
              ${direction}::trade_direction, ${quantity}, ${unitUsd}, ${usdTotal},
              ${tryEquivalent}, ${quality.toFixed(3)})
      ON CONFLICT (tick_id, company_id, facility_id, product_id, direction)
      DO UPDATE SET quantity = foreign_trades.quantity + EXCLUDED.quantity,
                    usd_amount = foreign_trades.usd_amount + EXCLUDED.usd_amount,
                    try_equivalent = foreign_trades.try_equivalent + EXCLUDED.try_equivalent`;
  }

  private async tryValue(tx: Sql, usd: Money): Promise<Money> {
    const [rate] = await tx<{ rate: bigint }[]>`
      SELECT rate_try_per_usd AS rate FROM fx_rates ORDER BY tick_id DESC LIMIT 1`;
    return asMoney(((usd as bigint) * (rate?.rate ?? 350_000n)) / 10_000n);
  }

  private async systemId(tx: Sql, code: string): Promise<string> {
    const [row] = await tx<{ id: string }[]>`SELECT id FROM companies WHERE system_code = ${code}`;
    if (!row) throw new NotFound('Sistem şirketi', code);
    return row.id;
  }

  private async foreignConfig() {
    const [row] = await this.sql<{ value: { exportMultiplier: number; importMultiplier: number } }[]>`
      SELECT value FROM game_configs WHERE key = 'economy.foreign' ORDER BY version DESC LIMIT 1`;
    return row?.value ?? { exportMultiplier: 0.75, importMultiplier: 1.35 };
  }

  private async fxConfig() {
    const [row] = await this.sql<{ value: { rate0: number; spreadPct: number; unlockLevel: number } }[]>`
      SELECT value FROM game_configs WHERE key = 'economy.fx' ORDER BY version DESC LIMIT 1`;
    return row?.value ?? { rate0: 35, spreadPct: 0.015, unlockLevel: 7 };
  }

  private tradeResult(
    label: string, product: { code: string; name: string; unit: string },
    quantity: bigint, unitUsd: Money, usdTotal: Money, wanted: bigint,
  ) {
    return {
      direction: label,
      product: { code: product.code, name: product.name },
      quantity: quantity.toString(),
      quantityFormatted: formatQty(asQty(quantity), product.unit),
      unitPriceUsd: unitUsd.toString(),
      totalUsd: usdTotal.toString(),
      complete: quantity >= wanted,
    };
  }
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
