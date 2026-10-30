import { isDeepStrictEqual } from 'node:util';

import type { Coverage } from '../src/features/search/search-index';

export const REPORT_FORMAT = 'obsidian-expo-host-benchmark/v1';

export type BenchmarkReport = {
  format: typeof REPORT_FORMAT;
  capturedAt: string;
  measurement: 'host-bun-sqlite';
  revision: { commit: string; dirty: boolean; sourceDigest: string; lockfileDigest: string };
  dependencies: { expo: string; reactNative: string };
  environment: {
    platform: string; arch: string; osRelease: string; cpu: string; cpuCount: number;
    totalMemoryBytes: number; bun: string; sqlite: string; locale: string; timeZone: string;
  };
  workload: { count: number; seed: number; queries: number; repeats: number; warmups: number; stress: boolean; harnessDigest: string };
  fixture: { notes: number; bytes: number; digest: string };
  correctness: { resultDigest: string; coverage: Coverage; unchangedReads: number };
  samplesMs: Record<string, number[]>;
};

export function summarize(samples: number[]) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('timings must contain finite, non-negative samples');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1];
  return { samples: sorted.length, min: sorted[0], p50: percentile(0.5), p95: percentile(0.95), max: sorted[sorted.length - 1] };
}

export function compareReports(before: BenchmarkReport, after: BenchmarkReport) {
  for (const report of [before, after]) {
    if (report.format !== REPORT_FORMAT || report.measurement !== 'host-bun-sqlite') throw new Error('unsupported benchmark report');
  }
  for (const key of ['environment', 'workload', 'fixture', 'correctness'] as const) {
    if (!before[key] || !after[key] || !isDeepStrictEqual(before[key], after[key])) {
      throw new Error(`incompatible ${key}: use the same workload and environment, and investigate changed results`);
    }
  }
  const names = Object.keys(before.samplesMs ?? {}).sort();
  if (names.length === 0 || !isDeepStrictEqual(names, Object.keys(after.samplesMs ?? {}).sort())) throw new Error('incompatible metrics');
  const metrics = Object.fromEntries(names.map((name) => {
    const baseline = summarize(before.samplesMs[name]);
    const candidate = summarize(after.samplesMs[name]);
    if (baseline.samples !== candidate.samples) throw new Error(`incompatible sample count for ${name}`);
    const change = (a: number, b: number) => a === 0 ? null : (b - a) / a * 100;
    return [name, { before: baseline, after: candidate, p50ChangePercent: change(baseline.p50, candidate.p50), p95ChangePercent: change(baseline.p95, candidate.p95) }];
  }));
  return {
    measurement: before.measurement,
    before: before.revision,
    after: after.revision,
    dependencies: { before: before.dependencies, after: after.dependencies },
    interpretation: 'negative percentages mean less elapsed time; descriptive evidence, not statistical significance or device performance',
    metrics,
  };
}
