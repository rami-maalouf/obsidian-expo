import { describe, expect, test } from 'bun:test';

import { DEFAULT_DAILY_NOTE_SETTINGS } from '@/features/daily-notes/settings';
import { parseDailySettings, serializeDailySettings } from '@/features/settings/daily-settings';
import { msUntilNextDay } from '@/features/today/day-boundary';

describe('stored daily settings', () => {
  test('round trip, including the built-in template', () => {
    expect(parseDailySettings(serializeDailySettings(DEFAULT_DAILY_NOTE_SETTINGS))).toEqual(DEFAULT_DAILY_NOTE_SETTINGS);
    const custom = { folder: 'Journal/Daily', filenameFormat: 'YYYYMMDD' as const, templatePath: 'Templates/Daily.md' };
    expect(parseDailySettings(serializeDailySettings(custom))).toEqual(custom);
  });

  test('missing or invalid settings mean first setup', () => {
    expect(parseDailySettings(null)).toBeNull();
    expect(parseDailySettings('nope')).toBeNull();
    expect(parseDailySettings('{"folder":"../x","filenameFormat":"YYYY-MM-DD","templatePath":""}')).toBeNull();
    expect(parseDailySettings('{"folder":"Daily","filenameFormat":"DD-MM-YYYY"}')).toBeNull();
  });
});

describe('date rollover timer', () => {
  test('fires just after the next local midnight', () => {
    expect(msUntilNextDay(new Date(2026, 9, 8, 23, 59, 59))).toBe(2_000);
    expect(msUntilNextDay(new Date(2026, 9, 8, 0, 0, 0))).toBe(24 * 3_600_000 + 1_000);
  });
});
