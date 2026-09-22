import { buyUsd, importGoods, type Sql } from '@kapital/db';
import { foreignPrices, fxConversion } from '@kapital/economy';
import { asMoney, asQty, DomainError, priceTimesQty, type Money } from '@kapital/shared';
import { configValue, type EngineTick } from '../context.js';

/**
 * NPC kriz ithalatı — docs/12 §6 ve §8 (F6).
 *
 * ★★★★ BU DAVRANIŞ PLANLANMIŞTI AMA HİÇ YAZILMAMIŞTI (R102). docs/12 §8,
 * F6 için "NPC dış ticaret yapar ama USD tutmaz" diyor ve "dahil" olarak
 * işaretli. Oysa hiçbir aktör ithalat yapmıyordu: `foreign_trades` dev
 * dünyasında boş, kapı raporunda dış ticaret payı her koşumda %0,0.
 *
 * Bunun asıl bedeli oyuncuda değil DIRECTOR'daydı. Kıtlık krizinde ilk
 * kaldıraç `IMPORT_QUOTA` — "ithalat kapısı açıldı" (docs/12 §6: SYS_RESERVE
 * son çaredir). Kaldıraç ithalat DERİNLİĞİNİ büyütüyor ama o derinliği
 * kullanan kimse yoktu. Kapı açılıyor, içeri mal girmiyordu.
 *
 * ★ TETİK KALDIRACIN KENDİSİ: NPC ancak o ürün için kota AÇIKKEN ithal eder
 * (`import_quota_mult > 1`, P0'da kapasiteye işlenmiş). İthalat pahalıdır
 * (dünya × 1,35 + döviz komisyonu); kriz dışında yurt içi üretim kârlı
 * kalmalı. Spec'in söylediği tam olarak bu: "ithalat açıldı, maliyetler arttı".
 *
 * ★ NPC YALNIZ KALDIRACIN EKLEDİĞİ PAYI KULLANIR. Kota derinliği `mult`
 * katına çıkarır; NPC'nin payı `kapasite − kapasite / mult`. Taban derinlik
 * OYUNCUNUNDUR: kriz müdahalesi oyuncunun ithalat hakkını yememeli.
 *
 * ★ NPC DÖVİZ TUTMAZ (docs/12 §5): ithalatın tam $ karşılığını AYNI işlemde
 * alır ve harcar; bakiyesi sıfırda kalır. Döviz ve ithalatın defter kaydı
 * API'nin kullandığı ÇEKİRDEKTEN geçer (`buyUsd`, `importGoods`).
 */

export interface KrizIthalati {
  /** NPC'lerin bu turda daha ne kadar ithal edebileceği (Qty ölçeği). */
  kalan: bigint;
  unitUsd: Money;
  quality: number;
  shelfLifeTicks: number | null;
}

export interface IthalatBaglami {
  urunler: Map<number, KrizIthalati>;
  kur: Money;
  spreadPct: number;
}

/** Kotası açık ürünler ve NPC'lere düşen ek derinlik. */
export async function loadCrisisImports(sql: Sql, tick: EngineTick): Promise<IthalatBaglami> {
  const foreignCfg = configValue<{ importMultiplier: number; exportMultiplier: number }>(
    tick, 'economy.foreign', { importMultiplier: 1.35, exportMultiplier: 0.75 },
  );
  const fxCfg = configValue<{ spreadPct: number; rate0: number }>(
    tick, 'economy.fx', { spreadPct: 0.015, rate0: 35 },
  );

  const [kurSatiri] = await sql<{ rate: bigint }[]>`
    SELECT rate_try_per_usd AS rate FROM fx_rates ORDER BY tick_id DESC LIMIT 1`;
  const kur = asMoney(kurSatiri?.rate ?? BigInt(Math.round(fxCfg.rate0 * 10_000)));

  // ★ Sıra belirleyici (R56): ürün kimliğine göre.
  const rows = await sql<{
    product_id: number; import_capacity: bigint; import_used: bigint;
    import_quota_mult: number; world_price_usd: bigint;
    world_quality: string; shelf_life_ticks: number | null;
  }[]>`
    SELECT c.product_id, c.import_capacity, c.import_used, c.import_quota_mult,
           c.world_price_usd, w.world_quality::text, p.shelf_life_ticks
      FROM foreign_trade_capacity c
      JOIN world_market w ON w.product_id = c.product_id AND w.importable
      JOIN products p ON p.id = c.product_id
     WHERE c.tick_id = ${tick.seq} AND c.import_quota_mult > 1
     ORDER BY c.product_id`;

  const urunler = new Map<number, KrizIthalati>();
  for (const r of rows) {
    // Kaldıracın eklediği pay: taban derinlik oyuncuya kalır.
    const taban = BigInt(Math.floor(Number(r.import_capacity) / r.import_quota_mult));
    const ek = r.import_capacity - taban;
    const bos = r.import_capacity - r.import_used;
    const kalan = ek < bos ? ek : bos;
    if (kalan <= 0n) continue;

    const { importUsd } = foreignPrices(
      asMoney(r.world_price_usd), foreignCfg.exportMultiplier, foreignCfg.importMultiplier,
    );
    urunler.set(r.product_id, {
      kalan, unitUsd: importUsd,
      quality: Number(r.world_quality), shelfLifeTicks: r.shelf_life_ticks,
    });
  }
  return { urunler, kur, spreadPct: fxCfg.spreadPct };
}

/** İthal edilen miktar ve kasadan çıkan toplam ₺ (komisyon dahil). */
export interface IthalatSonucu {
  miktar: bigint;
  odenen: Money;
}

/**
 * Bir NPC tesisi için kriz ithalatı dener. Bütçe ve kalan pay kadar alır.
 *
 * ★ Tek işlem: döviz alımı + ithalat birlikte ya olur ya olmaz. Depo dolarsa
 * `addBatch` fırlatır, işlem geri alınır ve NPC yurt içi alışa döner —
 * yarım kalmış bir döviz alımı (NPC'de $ bırakan) oluşmaz.
 */
export async function tryNpcImport(sql: Sql, tick: EngineTick, baglam: IthalatBaglami, input: {
  companyId: string; facilityId: string; inventoryId: string; productId: number;
  ihtiyac: bigint; butce: bigint; urunAdi?: string;
}): Promise<IthalatSonucu | null> {
  const kriz = baglam.urunler.get(input.productId);
  if (!kriz || kriz.kalan <= 0n || input.ihtiyac <= 0n || input.butce <= 0n) return null;

  let miktar = input.ihtiyac < kriz.kalan ? input.ihtiyac : kriz.kalan;

  // Bütçeye sığdır: komisyon dahil ₺ maliyeti doğrusal, orantılı küçültülür.
  const maliyet = (q: bigint) => {
    const usd = priceTimesQty(kriz.unitUsd, asQty(q)).value;
    return { usd, tl: fxConversion(usd, baglam.kur, baglam.spreadPct, 'BUY_USD').tryAmount };
  };
  let hesap = maliyet(miktar);
  if ((hesap.tl as bigint) > input.butce) {
    miktar = (miktar * input.butce) / (hesap.tl as bigint);
    if (miktar <= 0n) return null;
    hesap = maliyet(miktar);
    if ((hesap.tl as bigint) > input.butce || hesap.usd <= 0n) return null;
  }
  if (hesap.usd <= 0n) return null;

  try {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      // ★ NPC döviz TUTMAZ: harcayacağı $'ın tamamını ve yalnızca onu alır.
      await buyUsd(t, {
        tickId: tick.seq, companyId: input.companyId, usdAmount: hesap.usd,
        rate: baglam.kur, spreadPct: baglam.spreadPct, reason: 'kriz ithalatı dövizi',
      });
      await importGoods(t, {
        tickId: tick.seq, companyId: input.companyId, facilityId: input.facilityId,
        inventoryId: input.inventoryId, productId: input.productId, quantity: miktar,
        unitUsd: kriz.unitUsd, quality: kriz.quality, shelfLifeTicks: kriz.shelfLifeTicks,
        rate: baglam.kur, reason: `kriz ithalatı${input.urunAdi ? ` — ${input.urunAdi}` : ''}`,
      });
    });
  } catch (hata) {
    /*
     * ★ YALNIZ BEKLENEN İKİ DURUM YUTULUR: depo dolu, kasa yetmedi. İşlem
     * bütünüyle geri alınmıştır; NPC yurt içi alışa döner. Başka her hata —
     * SQL, değişmez ihlali — yukarı fırlar: para kodunda sessizce yutulan
     * bir hata, kapıda "neden para arzı kaydı" diye günlerce aranır.
     */
    if (hata instanceof DomainError
        && (hata.code === 'STORAGE_FULL' || hata.code === 'INSUFFICIENT_FUNDS')) {
      return null;
    }
    throw hata;
  }

  kriz.kalan -= miktar;
  return { miktar, odenen: hesap.tl };
}
