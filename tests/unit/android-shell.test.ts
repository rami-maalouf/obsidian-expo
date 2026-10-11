import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { EDITOR_ICONS, EDITOR_OUTPUT, generate, ICONS, OUTPUT } from '../../scripts/generate-android-icons';

const root = join(import.meta.dir, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'obsidian-expo-android-icons-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// the app bar's icons, and the editing toolbar's drawables in the vault module.
const sets = [
  { name: 'app bar', icons: ICONS, output: OUTPUT },
  { name: 'editing toolbar', icons: EDITOR_ICONS, output: EDITOR_OUTPUT },
];

describe.each(sets)('android $name icons', ({ name, icons, output }) => {
  test('the committed vector drawables match the generator byte for byte', () => {
    const folder = join(scratch, name);
    const written = generate(folder, icons);
    expect(written).toHaveLength(Object.keys(icons).length);
    for (const file of written) {
      const written_name = relative(folder, file);
      expect(readFileSync(file, 'utf8')).toBe(readFileSync(join(output, written_name), 'utf8'));
    }
    expect(readdirSync(output).sort()).toEqual(Object.keys(icons).map((icon) => `${icon}.xml`).sort());
  });

  test('each icon is a single filled path on the 960-unit material symbols grid', () => {
    for (const icon of Object.keys(icons)) {
      const xml = readFileSync(join(output, `${icon}.xml`), 'utf8');
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
