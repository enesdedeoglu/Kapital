/**
 * `bigint` içeren bir nesneyi JSON'a çevrilebilir hâle getirir.
 *
 * ★★★★ BU YARDIMCI BİR OLAY KAYDINDAN DOĞDU (R99). `POST /admin/tick` turu
 * ÇALIŞTIRIYOR, sonra yanıtı yazarken patlıyordu:
 *
 *     TypeError: Do not know how to serialize a BigInt
 *
 * Operatörün gördüğü 500'dü; oysa tur koşmuştu. Tekrar denemek DÜZELTMİYOR,
 * bir tur daha koşturuyordu — dünyayı istemeden ileri sarmak.
 *
 * ★ NEDEN GENEL BİR ARA KATMAN DEĞİL: diğer uçlar bigint'i bilerek elle
 * çeviriyor (çoğu zaman `formatMoney` ile birlikte, ADR-0001). Global bir
 * dönüştürücü o kararı görünmez kılar ve "sayı mı metin mi" sorusunu her uçta
 * belirsizleştirirdi. Burada dönüştürülen şey motorun ham tur çıktısı:
 * biçimlenmiş değil, teşhis verisi.
 *
 * Sayılar METNE çevrilir, `Number`a değil: tur sayaçları ve para tutarları
 * 2^53'ü aşabilir ve sessizce yuvarlanmaları teşhis verisini bozar.
 */
export function jsonGuvenli<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((v) => jsonGuvenli(v));
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonGuvenli(v);
    return out;
  }
  return value;
}
