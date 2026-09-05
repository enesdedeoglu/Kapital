/**
 * Kapı raporunun basımı — tek kaynak.
 *
 * İki yerden çağrılır: tüm tohumları sırayla koşan `gate.ts` ve CI'da
 * paralel koşan tohumların ham çıktılarını birleştiren `aggregate.ts`.
 * Ayrı yazılsalardı iki ortam farklı rapor üretir ve karşılaştırılamazdı.
 */
import type { GateReport } from './gate.js';

const line = (char = '─') => char.repeat(96);

export interface ReportMeta {
  readonly seedCount: number;
  readonly playerCount: number;
  readonly ticks: number;
  readonly minutes: number;
}

export function printGateReport(report: GateReport, meta: ReportMeta): void {
  console.log(`\n${line('═')}`);
  console.log(`BİRLEŞİK SONUÇ — ${meta.seedCount} tohum · ${meta.minutes.toFixed(1)} dk\n`);
  console.log(`  ${'Metrik'.padEnd(44)}${'Medyan'.padEnd(22)}${'Yayılma'.padEnd(18)}` +
    `${'Tutan'.padEnd(8)}Hedef`);
  console.log(`  ${line()}`);

  for (const m of report.metrics) {
    const mark = m.pass === null ? '—' : m.pass ? '✓' : '✗';
    // Aralık ORANLA gösterilir: metriklerin birimi farklı (yüzde, ₺, ms) ve
    // medyanın kendi biçimlendirmesi zaten birimi taşıyor.
    const range = m.min === null || m.median === null || m.median === 0
      ? '—'
      : `${(m.min / m.median).toFixed(2)}× – ${(m.max! / m.median).toFixed(2)}×`;
    const unstable = report.unstableKeys.includes(m.key) ? ' ⚠' : '';
    console.log(
      `${mark} ${m.label.padEnd(44)}${m.medianFormatted.padEnd(22)}${range.padEnd(18)}` +
      `${`${m.passCount}/${m.measuredCount}`.padEnd(8)}${m.target}${unstable}`,
    );
  }

  if (report.unstableKeys.length > 0) {
    console.log(`\n  ⚠ KARARSIZ — tohumlar kararda anlaşmıyor: ${report.unstableKeys.join(', ')}`);
    console.log('    Bu metrikler bir dünyada tutup diğerinde kalıyor. Çoğunluk eşiği');
    console.log('    geçmelerine izin verse bile, kapıyı bunlara dayandırmak risklidir.');
  }

  console.log(`\n${line('═')}`);
  if (report.passed) {
    console.log('★ KAPI GEÇİLDİ — tüm eşikler tohumların çoğunluğunda ve medyanda tutuyor');
  } else {
    console.log('✗ KAPI GEÇİLMEDİ');
    if (report.failedKeys.length > 0) console.log(`  tutmayan: ${report.failedKeys.join(', ')}`);
    if (report.unmeasuredKeys.length > 0) {
      console.log(`  ölçülemeyen: ${report.unmeasuredKeys.join(', ')}`);
    }
  }
  console.log(line('═'));
}
