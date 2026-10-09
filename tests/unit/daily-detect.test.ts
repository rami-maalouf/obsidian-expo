import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  detectDailyFolder,
  detectDailyNotes,
  detectDailyTemplate,
  detectedSettings,
  type ListedNote,
} from '@/features/daily-notes/detect';
import { DEFAULT_DAILY_NOTE_SETTINGS } from '@/features/daily-notes/settings';

const notes = (...paths: string[]): ListedNote[] => paths.map((path) => ({ path }));

/** the markdown files a vault listing reports: hidden files and folders are left out. */
function listVault(root: string): ListedNote[] {
  const found: ListedNote[] = [];
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.md')) found.push({ path });
    }
  };
  visit('');
  return found;
}

describe('daily-note folder', () => {
  test('the folder with the most notes named by date wins, with its newest date', () => {
    const guess = detectDailyFolder(
      notes('Journal/2026-10-07.md', 'Journal/2026-10-08.md', 'Journal/2026-09-30.md', 'Meetings/2026-03-02.md', 'Meetings/2026-03-09.md', 'Welcome.md'),
    );
    expect(guess).toEqual({ folder: 'Journal', format: 'YYYY-MM-DD', count: 3, latest: '2026-10-08' });
  });

  test('YYYYMMDD names are found, and only real calendar days count', () => {
    expect(detectDailyFolder(notes('Days/20261006.md', 'Days/20261007.md', 'Days/20261399.md'))).toEqual({
      folder: 'Days',
      format: 'YYYYMMDD',
      count: 2,
      latest: '20261007',
    });
    expect(detectDailyFolder(notes('Notes/2026-02-30.md', 'Notes/2026-13-01.md'))).toBeNull();
  });

  test('a folder with mixed formats uses the format most notes use', () => {
    expect(detectDailyFolder(notes('Daily/2026-10-01.md', 'Daily/2026-10-02.md', 'Daily/20261003.md'))?.format).toBe('YYYY-MM-DD');
    // a tie goes to the format of the newest note.
    expect(detectDailyFolder(notes('Daily/2026-10-01.md', 'Daily/20261003.md'))).toEqual({
      folder: 'Daily',
      format: 'YYYYMMDD',
      count: 1,
      latest: '20261003',
    });
  });

  test('the vault root is a candidate, as in obsidian\'s default', () => {
    expect(detectDailyFolder(notes('2026-10-08.md', 'Ideas.md'))).toEqual({ folder: '', format: 'YYYY-MM-DD', count: 1, latest: '2026-10-08' });
  });

  test('one dated note is enough only in a daily folder or the root', () => {
    expect(detectDailyFolder(notes('Meetings/2026-03-02.md'))).toBeNull();
    expect(detectDailyFolder(notes('Daily Notes/2026-03-02.md'))?.folder).toBe('Daily Notes');
    expect(detectDailyFolder(notes('Life/Journal/2026-03-02.md'))?.folder).toBe('Life/Journal');
  });

  test('on equal counts a daily folder name wins, then the newer notes', () => {
    expect(detectDailyFolder(notes('Meetings/2026-10-01.md', 'Meetings/2026-10-02.md', 'Journal/2026-01-01.md', 'Journal/2026-01-02.md'))?.folder).toBe(
      'Journal',
    );
    expect(detectDailyFolder(notes('A/2026-10-01.md', 'A/2026-10-02.md', 'B/2026-01-01.md', 'B/2026-01-02.md'))?.folder).toBe('A');
  });

  test('year and month folders are never suggested, since notes filed by month need nested paths', () => {
    expect(
      detectDailyFolder(
        notes('Daily/2026/2026-10-01.md', 'Daily/2026/2026-10-02.md', 'Daily/2026-10/2026-10-03.md', 'Daily/10/2026-10-04.md', 'Daily/10-October/2026-10-05.md'),
      ),
    ).toBeNull();
    // folders that only start like a month name are ordinary folders.
    expect(detectDailyFolder(notes('Marketing/2026-10-01.md', 'Marketing/2026-10-02.md'))?.folder).toBe('Marketing');
  });

  test('a folder name the settings would refuse is not suggested', () => {
    expect(detectDailyFolder(notes('Daily: old/2026-10-01.md', 'Daily: old/2026-10-02.md'))).toBeNull();
  });

  test('no dated notes means no guess', () => {
    expect(detectDailyFolder([])).toBeNull();
    expect(detectDailyFolder(notes('Welcome.md', 'Daily/Plan.md', 'Daily/2026-10-08.txt'))).toBeNull();
  });
});

describe('daily template', () => {
  test('a daily template in a templates folder wins', () => {
    expect(detectDailyTemplate(notes('Templates/Meeting.md', 'Templates/Daily.md', 'Daily/2026-10-08.md'))).toBe('Templates/Daily.md');
    expect(detectDailyTemplate(notes('_templates/daily-note.md'))).toBe('_templates/daily-note.md');
    expect(detectDailyTemplate(notes('Meta/Templater/Journal.md'))).toBe('Meta/Templater/Journal.md');
  });

  test('outside a templates folder the file name must say template', () => {
    expect(detectDailyTemplate(notes('Daily.md', 'Notes/Daily review.md'))).toBeNull();
    expect(detectDailyTemplate(notes('Meta/Daily Template.md'))).toBe('Meta/Daily Template.md');
  });

  test('"daily" beats journal and day names; other periods and unrelated templates are skipped', () => {
    expect(detectDailyTemplate(notes('Templates/Journal.md', 'Templates/Daily Note.md'))).toBe('Templates/Daily Note.md');
    expect(detectDailyTemplate(notes('Templates/Day Planner.md'))).toBe('Templates/Day Planner.md');
    expect(detectDailyTemplate(notes('Templates/Weekly.md', 'Templates/Monthly Review.md', 'Templates/Meeting.md', 'Templates/Monday.md'))).toBeNull();
  });

  test('among equals the most recently changed wins, then the shortest path', () => {
    expect(
      detectDailyTemplate([
        { path: 'Templates/Daily Basic.md', modified: 1 },
        { path: 'Templates/Daily Template.md', modified: 2 },
      ]),
    ).toBe('Templates/Daily Template.md');
    expect(detectDailyTemplate(notes('Templates/Old/Daily.md', 'Templates/Daily.md'))).toBe('Templates/Daily.md');
  });
});

describe('suggested settings', () => {
  test('nothing found keeps the defaults', () => {
    const detection = detectDailyNotes(notes('Welcome.md'));
    expect(detection).toEqual({ daily: null, template: null });
    expect(detectedSettings(detection)).toEqual(DEFAULT_DAILY_NOTE_SETTINGS);
  });

  test('the fixture vault suggests its daily folder and template', () => {
    const detection = detectDailyNotes(listVault(join(import.meta.dir, '../fixtures/vault-basic')));
    expect(detection).toEqual({
      daily: { folder: 'Daily', format: 'YYYY-MM-DD', count: 1, latest: '2026-10-07' },
      template: 'Templates/Daily.md',
    });
    expect(detectedSettings(detection)).toEqual({ folder: 'Daily', filenameFormat: 'YYYY-MM-DD', templatePath: 'Templates/Daily.md' });
  });

  test('the sanitized reference vault matches its profile\'s folder and format', () => {
    const detection = detectDailyNotes(listVault(join(import.meta.dir, '../../docs/references/obsidian/vault')));
    expect(detection.daily).toEqual({ folder: 'Daily', format: 'YYYY-MM-DD', count: 2, latest: '2000-01-03' });
    // without modified times, the shorter of the two daily templates wins.
    expect(detection.template).toBe('Templates/Daily Basic.md');
  });
});
