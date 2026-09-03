/**
 * Gini katsayısı — servet dağılımı.
 *
 * 0 = tam eşitlik, 1 = her şey tek şirkette. Para arzı ve CPI ekonominin
 * "sağlıklı" göründüğü ama aslında tek oyuncuya aktığı durumu göstermez;
 * Gini gösterir.
 *
 * Ortalama mutlak fark formülü:  G = Σ|xi − xj| / (2 n² μ)
 * Sıralı diziyle O(n) hesaplanır.
 */
export function giniCoefficient(values: readonly bigint[]): number {
  const positive = values.filter((v) => v > 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = positive.length;
  if (n < 2) return 0;

  let total = 0n;
  let weighted = 0n;
  for (let i = 0; i < n; i++) {
    total += positive[i]!;
    // (2i − n + 1) × xi — sıralı dizide ortalama mutlak farkın kapalı formu
    weighted += BigInt(2 * i - n + 1) * positive[i]!;
  }
  if (total === 0n) return 0;

  // Kesir bigint alanında kurulur, tek bölmede sayıya iner (ADR-0001).
  const numerator = Number(weighted);
  const denominator = Number(total) * n;
  const gini = numerator / denominator;
  return Math.max(0, Math.min(1, gini));
}
