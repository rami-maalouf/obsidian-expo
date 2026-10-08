import { describe, expect, test } from 'bun:test';

import {
  dailyNoteTarget,
  DEFAULT_DAILY_NOTE_SETTINGS,
  previewDailyNote,
  validateDailyNoteSettings,
} from '@/features/daily-notes/settings';
import { normalizeFolderPath, normalizeNotePath } from '@/features/daily-notes/vault-path';

const OCT_8 = { year: 2026, month: 10, day: 8 };
const NOW = { ...OCT_8, hour: 9, minute: 5, second: 0 };

describe('dailyNoteTarget', () => {
  test('default settings use Daily/YYYY-MM-DD.md', () => {
    expect(dailyNoteTarget(OCT_8, DEFAULT_DAILY_NOTE_SETTINGS)).toEqual({
      path: 'Daily/2026-10-08.md',
      title: '2026-10-08',
    });
  });

  test('YYYYMMDD, vault root, and nested folders', () => {
    expect(dailyNoteTarget(OCT_8, { folder: '', filenameFormat: 'YYYYMMDD', templatePath: null })).toEqual({
      path: '20261008.md',
      title: '20261008',
    });
    expect(
      dailyNoteTarget({ year: 2028, month: 2, day: 29 }, { ...DEFAULT_DAILY_NOTE_SETTINGS, folder: 'Journal/Daily' }),
    ).toEqual({ path: 'Journal/Daily/2028-02-29.md', title: '2028-02-29' });
  });
});

describe('validateDailyNoteSettings', () => {
  const valid = { folder: 'Daily', filenameFormat: 'YYYY-MM-DD', templatePath: '' };

  test('normalizes folders and template paths', () => {
    expect(validateDailyNoteSettings({ folder: ' Journal/Daily/ ', filenameFormat: 'YYYYMMDD', templatePath: 'Templates/Daily' }))
      .toEqual({ ok: true, value: { folder: 'Journal/Daily', filenameFormat: 'YYYYMMDD', templatePath: 'Templates/Daily.md' } });
    expect(validateDailyNoteSettings({ ...valid, folder: '', templatePath: '  ' })).toEqual({
      ok: true,
      value: { folder: '', filenameFormat: 'YYYY-MM-DD', templatePath: null },
    });
    expect(validateDailyNoteSettings({ ...valid, folder: '/' })).toMatchObject({ ok: true, value: { folder: '' } });
    expect(validateDailyNoteSettings({ ...valid, templatePath: 'T/Daily.MD' })).toMatchObject({
      ok: true,
      value: { templatePath: 'T/Daily.MD' },
    });
  });

  test('reports every invalid field at once', () => {
    const result = validateDailyNoteSettings({ folder: '../Daily', filenameFormat: 'DD-MM-YYYY', templatePath: '.obsidian/t' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.error).sort()).toEqual(['filenameFormat', 'folder', 'templatePath']);
    }
  });

  test('rejects paths that leave the vault, hide files, or use unsafe names', () => {
    const rejected = [
      '/Daily',
      '../Daily',
      'Daily/../..',
      './Daily',
      '.obsidian',
      'Notes/.trash',
      'a//b',
      'a\\b',
      'C:Daily',
      'Daily?',
      'tab\there',
      'Daily/ x',
      'Daily /x',
      'x'.repeat(256),
    ];
    for (const folder of rejected) {
      expect({ folder, ok: normalizeFolderPath(folder).ok }).toEqual({ folder, ok: false });
    }
    expect(normalizeFolderPath('é'.repeat(127)).ok).toBe(true);
    expect(normalizeFolderPath('é'.repeat(128)).ok).toBe(false);
  });

  test('template paths must name a file', () => {
    expect(normalizeNotePath('')).toEqual({ ok: false, error: 'Enter a path.' });
    expect(normalizeNotePath('Templates/').ok).toBe(false);
    expect(normalizeNotePath('Templates/Daily.v2')).toEqual({ ok: true, value: 'Templates/Daily.v2.md' });
  });
});

describe('previewDailyNote', () => {
  test('shows the path and rendered built-in template without touching the vault', () => {
    expect(previewDailyNote(DEFAULT_DAILY_NOTE_SETTINGS, { year: 2026, month: 10, day: 7 }, NOW, null)).toEqual({
      path: 'Daily/2026-10-07.md',
      title: '2026-10-07',
      content: { ok: true, value: '# 2026-10-07\n\nCreated 2026-10-08 09:05\n\n' },
    });
  });

  test('shows template errors', () => {
    const preview = previewDailyNote(DEFAULT_DAILY_NOTE_SETTINGS, OCT_8, NOW, '<%* x %>');
    expect(preview.path).toBe('Daily/2026-10-08.md');
    expect(preview.content).toMatchObject({ ok: false, error: { code: 'execution-tag', line: 1 } });
  });
});
