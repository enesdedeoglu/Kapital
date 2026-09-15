import { Inject, Injectable } from '@nestjs/common';
import { currentTickSeq, type Sql } from '@kapital/db';
import { asMoney, asQty, formatMoney, formatQty, NotFound, TICK_MINUTES } from '@kapital/shared';
import { SQL } from '../../common/db.module.js';

/** Bir defada geriye bakılacak en fazla tur — 7 gün (madde 45). */
const EN_FAZLA_TUR = 96 * 7;

/**
 * "Sen yokken ne oldu" raporu — madde 45.
 *
 * ★ NEDEN GEREKLİ: tur 15 dakikada bir koşuyor (96/gün). Uygulamayı 8 saat
 * kapatan oyuncu 32 turu kaçırıyor ve döndüğünde yalnız ŞU ANKİ sayıları
 * görüyor — hikâyeyi değil. Kasası artmış ama neden, rafı boşalmış ama ne
 * zaman, üretimi durmuş ama niye, hiçbiri belli değil. Pano "şu an" ekranıdır;
 * bu uç "aradaki" ekranıdır.
 *
 * ★ PENCEREYİ İSTEMCİ SÖYLER (`sinceTick`), sunucu işaret tutmaz. Sebebi:
 * "en son ne zaman baktım" bir OYUN GERÇEĞİ değil, istemcinin sunum durumudur
 * (raporu ne zaman göstereceğine o karar verir). Sunucuda tutulsaydı `GET`
 * yan etkili olurdu — çağıran her istek işareti ileri atar, rapor bir daha
 * okunamazdı. Böylece uç saf bir işlev: (şirket, sinceTick) → rapor.
 */
@Injectable()
export class ReportService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async rapor(userId: string, sinceTick: bigint | null) {
    const [sirket] = await this.sql<{ id: string }[]>`
      SELECT id FROM companies WHERE user_id = ${userId}::uuid AND kind = 'PLAYER'`;
    if (!sirket) throw new NotFound('Şirket', userId);

    const simdi = await currentTickSeq(this.sql);
    /*
     * Pencere KIRPILIR: bir ay sonra dönen oyuncu için 2880 turu taramak hem
     * yavaş hem okunamaz bir rapor üretirdi. Kırpıldığını da söyleriz —
     * "1.000 ₺ kazandın" derken aslında son 7 günü topladığımızı gizlemek
     * yanlış bilgi olurdu.
     */
    const istenen = sinceTick ?? simdi - BigInt(EN_FAZLA_TUR);
    const taban = simdi - BigInt(EN_FAZLA_TUR);
    const kirpildi = istenen < taban;
    const baslangic = kirpildi ? taban : istenen;
    const turSayisi = simdi > baslangic ? Number(simdi - baslangic) : 0;

    if (turSayisi === 0) {
      return {
        pencere: { baslangicTur: simdi.toString(), bitisTur: simdi.toString(), turSayisi: 0, dakika: 0, kirpildi: false },
        yeniMi: false,
        kar: { net: '0', netFormatted: formatMoney(asMoney(0n)), ciro: '0', ciroFormatted: formatMoney(asMoney(0n)), gider: '0', giderFormatted: formatMoney(asMoney(0n)) },
        satislar: [], uretim: [], sorunlar: [], dunya: [],
      };
    }

    const [kar, satislar, uretim, uretimSorunlari, rafSorunlari, dunya] = await Promise.all([
      this.kar(sirket.id, baslangic),
      this.satislar(sirket.id, baslangic),
      this.uretim(sirket.id, baslangic),
      this.uretimSorunlari(sirket.id, baslangic),
      this.rafSorunlari(sirket.id, baslangic, simdi),
      this.dunya(baslangic),
    ]);
    // Raf boşalması önce: perakendecinin kazancını durduran şey odur.
    const sorunlar = [...rafSorunlari, ...uretimSorunlari];

    return {
      pencere: {
        baslangicTur: baslangic.toString(),
        bitisTur: simdi.toString(),
        turSayisi,
        dakika: turSayisi * TICK_MINUTES,
        kirpildi,
      },
      yeniMi: true,
      kar, satislar, uretim, sorunlar, dunya,
    };
  }

  /*
   * ★ `SUM()` BIGINT DEĞİL STRING DÖNER.
   *
   * Postgres'te `SUM(bigint)` sonucu `numeric`tir ve postgres.js numeric'i
   * kesinlik kaybetmemek için STRING olarak verir — düz bigint sütunlar
   * (`MIN(tick_id)` gibi) bigint gelirken. Tipleri `bigint` diye yazmıştım,
   * tip yalan söylüyordu ve `formatMoney` string üzerinde bigint aritmetiği
   * yapınca uç 500 dönüyordu. Tip artık gerçeği söylüyor, dönüşüm açık.
   */
  private async kar(companyId: string, baslangic: bigint) {
    const [row] = await this.sql<{ net: string; ciro: string; gider: string }[]>`
      SELECT COALESCE(SUM(net_profit), 0) AS net,
             COALESCE(SUM(revenue), 0)    AS ciro,
             COALESCE(SUM(cogs + salary_cost + maintenance
                          + shipping_cost + interest_cost + tax), 0) AS gider
        FROM company_financials
       WHERE company_id = ${companyId}::uuid AND tick_id > ${baslangic}`;
    const net = asMoney(BigInt(row?.net ?? '0'));
    const ciro = asMoney(BigInt(row?.ciro ?? '0'));
    const gider = asMoney(BigInt(row?.gider ?? '0'));
    return {
      net: net.toString(), netFormatted: formatMoney(net),
      ciro: ciro.toString(), ciroFormatted: formatMoney(ciro),
      gider: gider.toString(), giderFormatted: formatMoney(gider),
    };
  }

  /** En çok ciro getiren ürünler — "ne sattın" sorusunun cevabı. */
  private async satislar(companyId: string, baslangic: bigint) {
    const rows = await this.sql<{
      code: string; name: string; unit: string; adet: string; ciro: string;
    }[]>`
      SELECT p.code, p.name, p.unit,
             SUM(rs.quantity) AS adet, SUM(rs.revenue) AS ciro
        FROM retail_sales rs JOIN products p ON p.id = rs.product_id
       WHERE rs.company_id = ${companyId}::uuid AND rs.tick_id > ${baslangic}
       GROUP BY p.code, p.name, p.unit
       ORDER BY SUM(rs.revenue) DESC LIMIT 5`;
    return rows.map((r) => {
      const ciro = asMoney(BigInt(r.ciro));
      const adet = asQty(BigInt(r.adet));
      return {
        urunKodu: r.code, urunAdi: r.name,
        adet: adet.toString(), adetFormatted: formatQty(adet, r.unit),
        ciro: ciro.toString(), ciroFormatted: formatMoney(ciro),
      };
    });
  }

  private async uretim(companyId: string, baslangic: bigint) {
    const rows = await this.sql<{
      name: string; unit: string; uretilen: string;
    }[]>`
      SELECT p.name, p.unit, SUM(pr.produced) AS uretilen
        FROM production_records pr JOIN products p ON p.id = pr.product_id
       WHERE pr.company_id = ${companyId}::uuid AND pr.tick_id > ${baslangic}
         AND pr.produced > 0
       GROUP BY p.name, p.unit
       ORDER BY SUM(pr.produced) DESC LIMIT 5`;
    return rows.map((r) => {
      const uretilen = asQty(BigInt(r.uretilen));
      return {
        urunAdi: r.name,
        uretilen: uretilen.toString(),
        uretilenFormatted: formatQty(uretilen, r.unit),
      };
    });
  }

  /**
   * Sen yokken TERS GİDENLER — raporun asıl işi bu.
   *
   * ★ `halted_reason` ürünü KİMLİKLE yazıyor ("girdi yetersiz: ürün 2",
   * `p1-produce.ts`). Oyuncuya böyle göstermek anlamsız olurdu; kimlik ürün
   * adıyla değiştirilir. Motordaki metni değiştirmedim: orası kayıt/hata
   * ayıklama metni, burası oyuncu metni — ikisi aynı olmak zorunda değil.
   */
  private async uretimSorunlari(companyId: string, baslangic: bigint) {
    const rows = await this.sql<{
      reason: string; tesis: string; kac: string; ilk: bigint; son: bigint;
    }[]>`
      SELECT pr.halted_reason AS reason,
             COALESCE(f.name, ft.name) AS tesis,
             COUNT(*)::text AS kac,
             MIN(pr.tick_id) AS ilk, MAX(pr.tick_id) AS son
        FROM production_records pr
        JOIN facilities f ON f.id = pr.facility_id
        JOIN facility_types ft ON ft.id = f.facility_type_id
       WHERE pr.company_id = ${companyId}::uuid AND pr.tick_id > ${baslangic}
         AND pr.halted_reason IS NOT NULL
       GROUP BY pr.halted_reason, COALESCE(f.name, ft.name)
       ORDER BY COUNT(*) DESC LIMIT 5`;
    if (rows.length === 0) return [];

    // Metinlerdeki "ürün N" kimliklerini ada çevir: tek sorguda topluca.
    const kimlikler = [...new Set(
      rows.flatMap((r) => [...r.reason.matchAll(/ürün (\d+)/g)].map((m) => Number(m[1]))),
    )];
    const adlar = new Map<number, string>();
    if (kimlikler.length > 0) {
      const urunler = await this.sql<{ id: number; name: string }[]>`
        SELECT id, name FROM products WHERE id = ANY(${kimlikler}::smallint[])`;
      for (const u of urunler) adlar.set(u.id, u.name);
    }

    return rows.map((r) => ({
      tesisAdi: r.tesis,
      mesaj: r.reason.replace(/ürün (\d+)/g, (tam, id: string) => adlar.get(Number(id)) ?? tam),
      /*
       * ★ SÜREYİ SUNUCU CÜMLEYE ÇEVİRİR. Önce ekrana çıplak `turSayisi`
       * gidiyordu ve panel hepsini "N turda" diye yazıyordu — oysa sayı iki
       * sorunda İKİ AYRI ŞEY demek: üretimde "kaç turda durdu", rafta "kaç
       * turdur satış yok". Anlamı bilen yer burası, cümle de burada kurulur.
       */
      sure: `${r.kac} turda durdu`,
      turSayisi: Number(r.kac),
      ilkTur: r.ilk.toString(),
      sonTur: r.son.toString(),
    }));
  }

  /**
   * RAF BOŞALMASI — perakendecinin başına gelen bir numaralı şey.
   *
   * ★ İlk sürümde rapor yalnız ÜRETİM duruşlarına bakıyordu ve her yeni oyuncu
   * perakendeci olduğu için pratikte hiçbir sorun göstermiyordu. Oysa
   * simülatörde tam da bu oldu: oyuncu yokken ekmek rafı boşaldı, satış durdu
   * ve rapor "her şey yolunda" dedi — kazancın neden kesildiğini söylemedi.
   *
   * Ölçüt iki koşulun BİRLİKTE sağlanması: pencerede satmış olacak (yani raf
   * gerçekten çalışıyordu) ve şu anda stoğu kalmamış olacak. Yalnız "stok sıfır"
   * demek yeni açılmış, hiç mal koyulmamış rafı da sorun sayardı; yalnız "satış
   * durdu" demek talebin düştüğü turları sorun sayardı.
   */
  private async rafSorunlari(companyId: string, baslangic: bigint, simdi: bigint) {
    const rows = await this.sql<{
      tesis: string; urun: string; son_satis: bigint; kalan: string;
    }[]>`
      WITH satis AS (
        SELECT rs.facility_id, rs.product_id, MAX(rs.tick_id) AS son_satis
          FROM retail_sales rs
         WHERE rs.company_id = ${companyId}::uuid AND rs.tick_id > ${baslangic}
         GROUP BY 1, 2
      )
      SELECT COALESCE(f.name, ft.name) AS tesis, p.name AS urun, satis.son_satis,
             COALESCE(SUM(ib.quantity - ib.reserved_quantity), 0)::text AS kalan
        FROM satis
        JOIN facilities f ON f.id = satis.facility_id AND f.closed_at IS NULL
        JOIN facility_types ft ON ft.id = f.facility_type_id
        JOIN products p ON p.id = satis.product_id
        LEFT JOIN inventories inv ON inv.facility_id = f.id
        LEFT JOIN inventory_batches ib
               ON ib.inventory_id = inv.id AND ib.product_id = satis.product_id
       GROUP BY f.id, f.name, ft.name, p.name, satis.son_satis
      HAVING COALESCE(SUM(ib.quantity - ib.reserved_quantity), 0) = 0
       ORDER BY satis.son_satis`;

    return rows.map((r) => {
      const bosTur = Number(simdi - r.son_satis);
      return {
        tesisAdi: r.tesis,
        mesaj: `${r.urun} rafı boşaldı — satış durdu`,
        sure: bosTur <= 1 ? 'son turda' : `${bosTur} turdur satış yok`,
        turSayisi: bosTur,
        ilkTur: r.son_satis.toString(),
        sonTur: simdi.toString(),
      };
    });
  }

  /** Dünya duyuruları — şirkete özel değil, herkesi ilgilendiren olaylar. */
  private async dunya(baslangic: bigint) {
    const rows = await this.sql<{
      tick_id: bigint; kind: string; severity: string; title: string; body: string;
      product_name: string | null; city_name: string | null;
    }[]>`
      SELECT n.tick_id, n.kind, n.severity, n.title, n.body,
             p.name AS product_name, c.name AS city_name
        FROM world_notices n
        LEFT JOIN products p ON p.id = n.product_id
        LEFT JOIN cities c ON c.id = n.city_id
       WHERE n.tick_id > ${baslangic}
       ORDER BY n.tick_id DESC LIMIT 8`;
    return rows.map((r) => ({
      tur: r.tick_id.toString(),
      kod: r.kind,
      onem: r.severity,
      baslik: r.title,
      metin: r.body,
      urunAdi: r.product_name,
      sehirAdi: r.city_name,
    }));
  }
}
