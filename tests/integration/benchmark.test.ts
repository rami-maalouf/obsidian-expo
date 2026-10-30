import { describe, expect, test } from 'bun:test';

import { compareReports, summarize } from '../../scripts/benchmark-report';
import { runBenchmark } from '../../scripts/benchmark-search';

describe('benchmark evidence', () => {
  test('percentiles use every raw sample without changing its order', () => {
    const samples = [9, 1, 5, 3, 7];
    expect(summarize(samples)).toEqual({ samples: 5, min: 1, p50: 5, p95: 9, max: 9 });
    expect(samples).toEqual([9, 1, 5, 3, 7]);
    expect(() => summarize([])).toThrow();
    expect(() => summarize([Number.NaN])).toThrow();
  });

  test('real search and explorer stress workloads preserve their results across runs', async () => {
    const options = { count: 30, seed: 1, queries: 10, repeats: 2, warmups: 1, stress: true };
    const before = await runBenchmark(options);
    const after = await runBenchmark(options);
    expect(before.fixture.notes).toBe(32);
    expect(before.fixture.bytes).toBeGreaterThan(1_124 * 1024);
    expect(before.correctness).toEqual(after.correctness);
    expect(before.correctness.coverage).toMatchObject({ total: 32, indexed: 32, pending: 0, placeholders: 0 });
    expect(before.samplesMs.discoverFresh).toHaveLength(2);
    expect(before.samplesMs.queryWarm).toHaveLength(20);
    expect(before.samplesMs.reconcileChanges).toHaveLength(40);
    expect(compareReports(before, after).metrics.queryWarm.before.samples).toBe(20);

    const faster = structuredClone(before);
    faster.samplesMs.queryWarm = before.samplesMs.queryWarm.map((sample) => sample / 2);
    expect(compareReports(before, faster).metrics.queryWarm.p50ChangePercent).toBeCloseTo(-50);

    const wrongResults = structuredClone(after);
    wrongResults.correctness.resultDigest = 'changed';
    expect(() => compareReports(before, wrongResults)).toThrow('correctness');

    const otherFixture = structuredClone(after);
    otherFixture.fixture.digest = 'different';
    expect(() => compareReports(before, otherFixture)).toThrow('fixture');

    const otherRuntime = structuredClone(after);
    otherRuntime.environment.bun = 'other';
    expect(() => compareReports(before, otherRuntime)).toThrow('environment');

    const missingSamples = structuredClone(after);
    missingSamples.samplesMs.queryWarm.pop();
    expect(() => compareReports(before, missingSamples)).toThrow('sample count');
  }, 30_000);

  test('invalid run dimensions fail before producing misleading timings', async () => {
    await expect(runBenchmark({ count: 0 })).rejects.toThrow('count');
    await expect(runBenchmark({ queries: 0 })).rejects.toThrow('queries');
    await expect(runBenchmark({ repeats: 1.5 })).rejects.toThrow('repeats');
    await expect(runBenchmark({ warmups: -1 })).rejects.toThrow('warmups');
  });
});
