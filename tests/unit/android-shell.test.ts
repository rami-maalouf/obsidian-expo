import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { generate, ICONS, OUTPUT } from '../../scripts/generate-android-icons';

const root = join(import.meta.dir, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'obsidian-expo-android-icons-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('android toolbar icons', () => {
  test('the committed vector drawables match the generator byte for byte', () => {
    const written = generate(scratch);
    expect(written).toHaveLength(Object.keys(ICONS).length);
    for (const file of written) {
      const name = relative(scratch, file);
      expect(readFileSync(file, 'utf8')).toBe(readFileSync(join(OUTPUT, name), 'utf8'));
    }
    expect(readdirSync(OUTPUT).sort()).toEqual(Object.keys(ICONS).map((name) => `${name}.xml`).sort());
  });

  test('each icon is a single filled path on the 960-unit material symbols grid', () => {
    for (const name of Object.keys(ICONS)) {
      const xml = readFileSync(join(OUTPUT, `${name}.xml`), 'utf8');
      expect(xml).toContain('android:viewportWidth="960"');
      const path = /android:pathData="([^"]+)"/.exec(xml)?.[1] ?? '';
      expect(path).toMatch(/^M[\d.,\-MLQZ ]+Z$/);
      // every coordinate stays inside the em square.
      for (const value of path.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Number(value)).toBeGreaterThanOrEqual(0);
        expect(Number(value)).toBeLessThanOrEqual(960);
      }
    }
  });
});

describe('platform screens', () => {
  /** every app file, relative to src/. */
  function files(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(folder, entry.name)) : [relative(join(root, 'src'), join(folder, entry.name))],
    );
  }

  test('every ios-only file has an android version', () => {
    const all = new Set(files(join(root, 'src')));
    const missing = [...all]
      .filter((file) => file.includes('.ios.'))
      .filter((file) => !all.has(file.replace('.ios.', '.android.')));
    expect(missing).toEqual([]);
  });
});
