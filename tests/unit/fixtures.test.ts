import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildManifest, manifestPathFor, type VaultManifest } from '../../scripts/vault-manifest';

const VAULT = join(import.meta.dir, '../fixtures/vault-basic');
const read = (path: string) => readFileSync(join(VAULT, path));
const utf8 = new TextDecoder('utf-8', { fatal: true });

describe('vault-basic fixture', () => {
  test('bytes match the committed manifest', () => {
    const recorded = JSON.parse(readFileSync(manifestPathFor(VAULT), 'utf8')) as VaultManifest;
    const actual = buildManifest(VAULT);
    // compare entries first so a failure names the changed file.
    expect(actual.files).toEqual(recorded.files);
    expect(actual.digest).toBe(recorded.digest);
  });

  test('line-ending fixtures keep their exact newline bytes', () => {
    const crlf = read('Encodings/CRLF line endings.md').toString('latin1');
    expect(crlf).toContain('\r\n');
    expect(crlf.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);

    const mixed = read('Encodings/Mixed line endings.md').toString('latin1');
    expect(mixed).toContain('LF line\r\nCRLF line\rCR-only line\n');
    expect(mixed.endsWith('newline')).toBe(true);
    expect(read('Encodings/No trailing newline.md').at(-1)).toBe('.'.charCodeAt(0));
    expect(read('Encodings/Empty.md').byteLength).toBe(0);
  });

  test('encoding fixtures cover BOM, invalid UTF-8, and UTF-16', () => {
    expect([...read('Encodings/UTF-8 BOM.md').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(() => utf8.decode(read('Encodings/Latin-1.md'))).toThrow();
    expect([...read('Encodings/UTF-16LE.md').subarray(0, 2)]).toEqual([0xff, 0xfe]);
  });

  test('Unicode fixture keeps NFC and NFD forms distinct', () => {
    const text = utf8.decode(read('Unicode.md'));
    const nfc = text.match(/precomposed NFC\): (.*)/)?.[1];
    const nfd = text.match(/decomposed NFD\): (.*)/)?.[1];
    expect(nfc).toBe('café, naïve, Zürich'.normalize('NFC'));
    expect(nfd).toBe('café, naïve, Zürich'.normalize('NFD'));
    expect(nfc).not.toBe(nfd);
    expect(text).toContain('a b');
    expect(text).toContain('a‍b');
  });

  test('every Markdown file except the encoding cases is valid UTF-8', () => {
    const manifest = buildManifest(VAULT);
    const nonUtf8 = new Set(['Encodings/Latin-1.md', 'Encodings/UTF-16LE.md']);
    for (const file of manifest.files) {
      if (file.path.endsWith('.md') && !nonUtf8.has(file.path)) {
        expect(() => utf8.decode(read(file.path))).not.toThrow();
      }
    }
  });

  test('covers duplicate basenames, nested folders, and NFC filenames', () => {
    const paths = buildManifest(VAULT).files.map((file) => file.path);
    expect(paths.filter((path) => path.endsWith('/Index.md'))).toEqual([
      'Archive/Index.md',
      'Projects/Alpha/Index.md',
      'Projects/Beta/Index.md',
    ]);
    for (const path of paths) {
      expect(path).toBe(path.normalize('NFC'));
    }
    expect(paths).toContain('Résumé.md');
  });

  test('daily fixture filename date differs from its creation clock', () => {
    const text = utf8.decode(read('Daily/2026-10-07.md'));
    expect(text).toContain('created: 2026-10-08 00:15');
    expect(text).toContain('# 2026-10-07');
  });

  test('unsupported template fixtures exist for each rejected construct', () => {
    expect(readdirSync(join(VAULT, 'Templates/Unsupported')).sort()).toEqual([
      'Date format.md',
      'Duration offset.md',
      'Dynamic tag.md',
      'Execution tag.md',
      'Reference without format.md',
      'Unclosed tag.md',
      'Unknown command.md',
      'Variable expression.md',
      'Whitespace control.md',
    ]);
  });
});
