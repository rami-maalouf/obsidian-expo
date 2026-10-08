import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DAILY_NOTE_COUNT,
  generateVault,
  manifestForVault,
  MAX_NOTE_BYTES,
  MIN_NOTE_BYTES,
  writeVault,
} from '../../scripts/generate-vault';
import { buildManifest } from '../../scripts/vault-manifest';

/** recorded in README.md. change both together, and only with a GENERATOR_VERSION bump. */
const DOCUMENTED_10K = {
  fileCount: 10_000,
  totalBytes: 44_317_263,
  digest: 'f9d3c347c7910e5a561272cd7a2fbf30bde630e7d12e3df6fe20618732dd80e0',
};

const utf8 = new TextDecoder('utf-8', { fatal: true });
const scratch = mkdtempSync(join(tmpdir(), 'obsidian-expo-generator-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('generateVault', () => {
  test('same seed produces identical bytes; another seed differs', () => {
    expect(manifestForVault({ seed: 7, count: 300 })).toEqual(manifestForVault({ seed: 7, count: 300 }));
    expect(manifestForVault({ seed: 8, count: 300 }).digest).not.toBe(manifestForVault({ seed: 7, count: 300 }).digest);
  });

  test('notes are valid UTF-8 within the 2-8 KiB range with unique paths', () => {
    const paths = new Set<string>();
    for (const file of generateVault({ count: 2_000 })) {
      expect(file.data.byteLength).toBeGreaterThanOrEqual(MIN_NOTE_BYTES);
      expect(file.data.byteLength).toBeLessThanOrEqual(MAX_NOTE_BYTES);
      expect(() => utf8.decode(file.data)).not.toThrow();
      expect(paths.has(file.path)).toBe(false);
      paths.add(file.path);
    }
  });

  test('includes daily notes, deep folders, repeated basenames, links, and non-ASCII text', () => {
    const files = [...generateVault({ count: 10_000 })];
    const daily = files.filter((file) => file.path.startsWith('Daily/'));
    expect(daily).toHaveLength(DAILY_NOTE_COUNT);
    expect(daily[0].path).toBe('Daily/2026-10-08.md');
    expect(daily.at(-1)?.path).toBe('Daily/2024-10-09.md');
    expect(files.some((file) => file.path.includes('/Deep/Deeper/Deepest/'))).toBe(true);

    const basenames = new Map<string, number>();
    for (const file of files) {
      const name = file.path.slice(file.path.lastIndexOf('/') + 1);
      basenames.set(name, (basenames.get(name) ?? 0) + 1);
    }
    expect([...basenames.values()].filter((n) => n > 1).length).toBeGreaterThan(100);

    const sample = files.slice(1_000, 1_100).map((file) => utf8.decode(file.data)).join('\n');
    expect(sample).toMatch(/\[\[[^\]]+\]\]/);
    expect(sample).toMatch(/[^\x00-\x7f]/);
  });

  test('stress notes are at least 100 KiB and 1 MiB', () => {
    const stress = [...generateVault({ count: 1, stress: true })].slice(1);
    expect(stress.map((file) => file.path)).toEqual(['Stress/Long 100 KiB.md', 'Stress/Long 1 MiB.md']);
    expect(stress[0].data.byteLength).toBeGreaterThanOrEqual(100 * 1024);
    expect(stress[1].data.byteLength).toBeGreaterThanOrEqual(1024 * 1024);
  });

  test('the default 10,000-note vault matches the documented manifest', () => {
    const manifest = manifestForVault();
    expect({ fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, digest: manifest.digest }).toEqual(
      DOCUMENTED_10K,
    );
  });
});

describe('writeVault', () => {
  test('writes the same bytes the manifest describes', () => {
    const out = join(scratch, 'small');
    const manifest = writeVault(out, { count: 50 });
    expect(buildManifest(out)).toEqual(manifest);
  });

  test('refuses a non-empty directory and paths inside the repository', () => {
    const occupied = join(scratch, 'occupied');
    mkdirSync(occupied);
    writeFileSync(join(occupied, 'keep.md'), 'keep');
    expect(() => writeVault(occupied, { count: 1 })).toThrow('non-empty');
    expect(() => writeVault(join(import.meta.dir, 'generated'), { count: 1 })).toThrow('inside the repository');
  });
});
