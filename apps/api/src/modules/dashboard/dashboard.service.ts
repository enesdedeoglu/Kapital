import { Inject, Injectable } from '@nestjs/common';
import { currentTickSeq, nextTickAt, type Sql } from '@kapital/db';
import { NotFound, TICKS_PER_DAY, TICK_MINUTES } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';

/**
 * Ana sayfa özeti — roadmap F9.
 *
 * ★ NEDEN TEK UÇ: ana sayfa beş ayrı şey gösteriyor (tur geri sayımı, 24s
 * K/Z, kritik stok, son olaylar, şirket künyesi). Bunları beş isteğe bölmek
 * mobilde beş kez gidiş-dönüş demek; ekran parça parça dolar ve en yavaş
 * istek açılışı belirler. Hepsi tek turluk bir fotoğraf olduğu için tek
 * yanıtta gelmeleri hem daha hızlı hem daha TUTARLI — karışık turlardan
 * derlenmiş bir ekran görmezsiniz.
 */
export interface OzetView {
  tur: {
    /** Şu anki tur sırası. Oyunun tek zaman kaynağı (ADR-0003). */
    seq: string;
    /** Sıradaki turun planlandığı an (ISO). Geri sayım buradan hesaplanır. */
    sonraki: string | null;
    /** Tur uzunluğu dakika — istemci geri sayımı buna göre kurar. */
    dakika: number;
  };
  kar: {
    /** Son 24 saatin (96 tur) net kâr/zararı, kuruş. */
    net: string;
    ciro: string;
    gider: string;
    /** Dönem başındaki nakde oranı; null = karşılaştırılacak bakiye yok. */
    oran: number | null;
  };
  kritikStok: {
    facilityId: string;
    facilityName: string;
    productCode: string;
    productName: string;
    /** Rafta kalan adet (Qty ölçeği düşürülmüş). */
    kalan: number;
    /** Bu tesisin son 24 saatte tur başına ortalama satışı. */
    turBasiSatis: number;
    /** Kaç tur sonra biter. 0 = raf zaten boş. */
    kalanTur: number;
  }[];
  olaylar: {
    kod: string;
    ad: string;
    aciklama: string;
    kapsam: string;
    urunKodu: string | null;
    /** Kaç tur sonra biter; negatifse bitmiş. */
    kalanTur: number;
    /** Talep/arz/maliyet çarpanları — oyuncu etkiyi görsün. */
    talep: number;
    arz: number;
    maliyet: number;
  }[];
}

@Injectable()
export class DashboardService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async ozet(userId: string): Promise<OzetView> {
    const [sirket] = await this.sql<{ id: string }[]>`
      SELECT id FROM companies WHERE user_id = ${userId}::uuid AND kind = 'PLAYER'`;
    if (!sirket) throw new NotFound('Şirket', userId);

    const seq = await currentTickSeq(this.sql);
    const pencereBasi = seq - BigInt(TICKS_PER_DAY);

    const [tur, kar, kritikStok, olaylar] = await Promise.all([
      this.turBilgisi(seq),
      this.karZarar(sirket.id, pencereBasi),
      this.kritikStok(sirket.id, seq, pencereBasi),
      this.olaylar(seq),
    ]);

    return { tur, kar, kritikStok, olaylar };
  }

  /**
   * Sıradaki turun planlandığı an. Geri sayımı istemci kendi hesaplar.
   *
   * ★ "Sıradaki" = BEKLEYEN ilk tur, `seq > şimdiki` DEĞİL. `currentTickSeq`
   * durumdan bağımsız olarak en büyük sırayı döner; planlayıcı sıradaki turu
   * PENDING olarak yazdığı anda "şimdiki tur" o olur ve `seq > şimdiki` hiçbir
   * şey bulamaz. Duruma bakmak seq aritmetiğinden bağımsızdır ve niyeti
   * doğrudan anlatır.
   */
  private async turBilgisi(seq: bigint): Promise<OzetView['tur']> {
    // Sorgu `@kapital/db`'de: `/tick` ucu da aynı kaynaktan okur, ikisi ayrışmasın.
    const sonraki = await nextTickAt(this.sql);
    return {
      seq: seq.toString(),
      sonraki: sonraki ? sonraki.toISOString() : null,
      dakika: TICK_MINUTES,
    };
  }

  /** Son 96 turun finansal özeti. */
  private async karZarar(companyId: string, pencereBasi: bigint): Promise<OzetView['kar']> {
    const [row] = await this.sql<{
      net: bigint; ciro: bigint; gider: bigint; acilis: bigint | null;
    }[]>`
      SELECT COALESCE(SUM(net_profit), 0) AS net,
             COALESCE(SUM(revenue), 0)    AS ciro,
             COALESCE(SUM(cogs + salary_cost + maintenance
                          + shipping_cost + interest_cost + tax), 0) AS gider,
             -- Pencerenin EN ESKİ kapanış nakdi: oran bunun üzerinden hesaplanır.
             (ARRAY_AGG(cash_close ORDER BY tick_id))[1] AS acilis
        FROM company_financials
       WHERE company_id = ${companyId}::uuid AND tick_id > ${pencereBasi}`;

    const net = row?.net ?? 0n;
    const acilis = row?.acilis ?? null;
    return {
      net: net.toString(),
      ciro: (row?.ciro ?? 0n).toString(),
      gider: (row?.gider ?? 0n).toString(),
      // Sıfıra bölme yok: bakiye yoksa oran da yoktur, uydurulmaz.
      oran: acilis !== null && acilis > 0n ? Number(net) / Number(acilis) : null,
    };
  }

  /**
   * Rafı bitmek üzere olan ürünler.
   *
   * "Kritik" mutlak bir sayı değildir: 10 adet, tur başına 1 satan dükkânda
   * bol, 20 satanda bitmiş demektir. Ölçüt KAÇ TUR DAYANDIĞIdır.
   */
  private async kritikStok(
    companyId: string, seq: bigint, pencereBasi: bigint,
  ): Promise<OzetView['kritikStok']> {
    const rows = await this.sql<{
      facility_id: string; facility_name: string; product_code: string;
      product_name: string; kalan: string; tur_basi: number;
    }[]>`
      WITH satis AS (
        SELECT rs.facility_id, rs.product_id,
               SUM(rs.quantity)::numeric / ${TICKS_PER_DAY} AS tur_basi
          FROM retail_sales rs
         WHERE rs.company_id = ${companyId}::uuid AND rs.tick_id > ${pencereBasi}
         GROUP BY 1, 2
      )
      SELECT f.id AS facility_id,
             COALESCE(f.name, ft.name) AS facility_name,
             p.code AS product_code, p.name AS product_name,
             COALESCE(SUM(ib.quantity - ib.reserved_quantity), 0)::text AS kalan,
             satis.tur_basi::float8 AS tur_basi
        FROM satis
        JOIN facilities f ON f.id = satis.facility_id AND f.closed_at IS NULL
        JOIN facility_types ft ON ft.id = f.facility_type_id
        JOIN products p ON p.id = satis.product_id
        LEFT JOIN inventories inv ON inv.facility_id = f.id
        LEFT JOIN inventory_batches ib
               ON ib.inventory_id = inv.id AND ib.product_id = satis.product_id
       WHERE satis.tur_basi > 0
       GROUP BY f.id, f.name, ft.name, p.code, p.name, satis.tur_basi
       ORDER BY 5, 3`;

    return rows
      .map((r) => {
        const kalan = Number(BigInt(r.kalan)) / 1000;
        const turBasiSatis = r.tur_basi;
        return {
          facilityId: r.facility_id,
          facilityName: r.facility_name,
          productCode: r.product_code,
          productName: r.product_name,
          kalan,
          turBasiSatis,
          kalanTur: turBasiSatis > 0 ? Math.floor(kalan / turBasiSatis) : 0,
        };
      })
      // Bir günden az dayanan raflar uyarıdır; gerisi haber değildir.
      .filter((r) => r.kalanTur < TICKS_PER_DAY)
      .sort((a, b) => a.kalanTur - b.kalanTur)
      .slice(0, 5);
  }

  /** Şu an etkili olan dünya olayları — oyuncu neyin bastırdığını görsün. */
  private async olaylar(seq: bigint): Promise<OzetView['olaylar']> {
    const rows = await this.sql<{
      code: string; name: string; description: string; scope: string;
      product_code: string | null; end_tick: bigint;
      demand_multiplier: number; supply_multiplier: number; cost_multiplier: number;
    }[]>`
      SELECT w.code, w.name, w.description, w.scope, p.code AS product_code,
             w.end_tick, w.demand_multiplier, w.supply_multiplier, w.cost_multiplier
        FROM world_events w
        LEFT JOIN products p ON p.id = w.product_id
       WHERE w.start_tick <= ${seq} AND w.end_tick >= ${seq}
       ORDER BY w.end_tick, w.code
       LIMIT 5`;

    return rows.map((r) => ({
      kod: r.code,
      ad: r.name,
      aciklama: r.description,
      kapsam: r.scope,
      urunKodu: r.product_code,
      kalanTur: Number(r.end_tick - seq),
      talep: r.demand_multiplier,
      arz: r.supply_multiplier,
      maliyet: r.cost_multiplier,
    }));
  }
}
