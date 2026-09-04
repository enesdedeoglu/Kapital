/**
 * Çok tohumlu geçiş kapısı — R39.
 *
 * Dünya olayları eklendikten sonra aynı yapılandırmanın iki koşusu belirgin
 * biçimde farklı sonuç veriyor (NPC payı %52,7'ye karşı %68,1; kur %22,0'a
 * karşı %35,9). Bu bir kusur DEĞİL, olayların amaçlanan etkisi: dünya artık
 * her koşuda farklı. Ama tek koşuya bakan bir kapı gürültüyü sinyal sanar.
 *
 * Bu modül N tohumun sonucunu birleştirir. Saf fonksiyondur: koşuyu kim
 * yaptıysa yapsın, karar burada verilir ve test edilebilir.
 */
import type { MetricResult } from './metrics.js';

export interface SeedRun {
  readonly seed: number;
  readonly metrics: readonly MetricResult[];
}

export interface AggregatedMetric {
  readonly key: string;
  readonly label: string;
  readonly target: string;
  /** Tohumlar arası medyan değer — temsilî dünya. */
  readonly median: number | null;
  /** Medyana en yakın koşunun kendi biçimlendirmesi — birim `metrics.ts`te yaşar. */
  readonly medianFormatted: string;
  readonly min: number | null;
  readonly max: number | null;
  /** Kaç tohumda eşiği tuttu. */
  readonly passCount: number;
  readonly measuredCount: number;
  readonly total: number;
  readonly pass: boolean | null;
  /**
   * Tohumlar KARAR konusunda anlaşmıyor mu — bazısında geçti, bazısında kaldı.
   *
   * ★ Sayısal yayılmaya (max−min ÷ medyan) bakmak yanıltıcıdır: medyan sıfıra
   * yakınken oran patlar ve kararlı bir metrik kararsız görünür. Ölçüldü: para
   * arzı medyanı %0,1, aralığı %−1,3…%1,4 — mutlak olarak minicik, orana göre
   * 27 kat. Asıl kararsızlık, aynı yapılandırmanın bir tohumda geçip
   * diğerinde kalmasıdır.
   */
  readonly unstable: boolean;
  /** Bilgi amaçlı sayısal yayılma; kararsızlık ölçütü DEĞİL. */
  readonly spread: number | null;
}

export interface GateReport {
  readonly metrics: readonly AggregatedMetric[];
  readonly passed: boolean;
  readonly failedKeys: readonly string[];
  readonly unstableKeys: readonly string[];
  readonly unmeasuredKeys: readonly string[];
  readonly seeds: readonly number[];
}

export interface GateOptions {
  /** Bir metriğin geçmesi için tohumların en az bu oranında geçmesi gerekir. */
  readonly majority?: number;
}

/**
 * Bir metrik iki koşulu birden sağlarsa geçer:
 *
 *   1. Tohumların ÇOĞUNLUĞUNDA eşiği tutmuş olmalı.
 *   2. Tohumlar arası MEDYAN değer bandın içinde olmalı.
 *
 * ★ Yalnız çoğunluğa bakmak yetmez: bir metrik 3/5 tohumda kıl payı geçip
 * 2/5'inde uçurumla kalabilir; o dünya sağlıklı değildir. Yalnız medyana
 * bakmak da yetmez: medyan tutarken koşuların yarısı çökebilir.
 *
 * ★ ÖLÇÜLEMEYEN metrik geçmiş sayılmaz — tek koşuluk kapıdaki kuralın aynısı.
 */
export function aggregateGate(
  runs: readonly SeedRun[], options: GateOptions = {},
): GateReport {
  const majority = options.majority ?? 0.6;

  if (runs.length === 0) {
    return {
      metrics: [], passed: false, failedKeys: [], unstableKeys: [],
      unmeasuredKeys: [], seeds: [],
    };
  }

  // Metrik sırası ilk koşudan alınır; her koşu aynı metrikleri üretir.
  const keys = runs[0]!.metrics.map((m) => m.key);
  const metrics: AggregatedMetric[] = [];

  for (const key of keys) {
    const samples = runs
      .map((run) => run.metrics.find((m) => m.key === key))
      .filter((m): m is MetricResult => m !== undefined);

    const measured = samples.filter((m) => m.pass !== null);
    const values = measured
      .map((m) => m.value)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    const passCount = measured.filter((m) => m.pass).length;
    const median = values.length > 0 ? medianOf(values) : null;
    const min = values.length > 0 ? values[0]! : null;
    const max = values.length > 0 ? values[values.length - 1]! : null;
    const spread = median !== null && median !== 0 && min !== null && max !== null
      ? (max - min) / Math.abs(median) : null;

    // Medyanın bandı tutup tutmadığını, o değere en yakın örneğin kararından
    // türetiriz: eşik mantığı `metrics.ts`te yaşar, burada kopyalanmaz.
    const medianPasses = median === null ? null : nearest(measured, median)?.pass ?? null;

    const pass = measured.length === 0 || medianPasses === null
      ? null
      : medianPasses && passCount / measured.length >= majority;

    const representative = median === null ? undefined : nearest(measured, median);

    metrics.push({
      key,
      label: samples[0]?.label ?? key,
      target: samples[0]?.target ?? '',
      median,
      medianFormatted: representative?.formatted ?? '—',
      min, max, spread,
      // Tohumlar kararda anlaşmıyorsa metrik güvenilir değildir.
      unstable: measured.length > 1 && passCount > 0 && passCount < measured.length,
      passCount, measuredCount: measured.length, total: samples.length,
      pass,
    });
  }

  return {
    metrics,
    passed: metrics.every((m) => m.pass === true),
    failedKeys: metrics.filter((m) => m.pass === false).map((m) => m.key),
    unstableKeys: metrics.filter((m) => m.unstable).map((m) => m.key),
    unmeasuredKeys: metrics.filter((m) => m.pass === null).map((m) => m.key),
    seeds: runs.map((r) => r.seed),
  };
}

function medianOf(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Medyana en yakın örnek — eşik kararını ondan okuruz. */
function nearest(samples: readonly MetricResult[], target: number): MetricResult | undefined {
  let best: MetricResult | undefined;
  let bestDistance = Infinity;
  for (const sample of samples) {
    if (sample.value === null) continue;
    const distance = Math.abs(sample.value - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = sample;
    }
  }
  return best;
}
