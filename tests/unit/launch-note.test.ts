import { describe, expect, test } from 'bun:test';

import { EMPTY_HISTORY, moveTo, type NavigationHistory, visit } from '@/features/navigation/history';
import { canReopen, DEFAULT_LAUNCH_SETTINGS, launchCandidate, launchTarget, type LaunchSettings } from '@/features/navigation/launch';
import { launchSettingsKey, parseLaunchSettings, serializeLaunchSettings } from '@/features/settings/launch-settings';

const LAST: LaunchSettings = { open: 'last-note' };
const TODAY: LaunchSettings = { open: 'today' };

function history(...paths: string[]): NavigationHistory {
  return paths.reduce(visit, EMPTY_HISTORY);
}

describe('the note a launch opens', () => {
  test('reopens the last open note by default', () => {
    expect(DEFAULT_LAUNCH_SETTINGS).toEqual(LAST);
    expect(launchCandidate(history('Daily/2026-10-09.md', 'Welcome.md'), LAST)).toBe('Welcome.md');
  });

  test('the last open note is the one on screen, even after going back', () => {
    const stored = moveTo(history('A.md', 'B.md', 'C.md'), 0);
    expect(launchCandidate(stored, LAST)).toBe('A.md');
  });

  test("opens today's note with no history, or when the setting asks for it", () => {
    expect(launchCandidate(EMPTY_HISTORY, LAST)).toBeNull();
    expect(launchCandidate(history('Welcome.md'), TODAY)).toBeNull();
  });

  test('waits for the stored history and the file check, then decides', () => {
    const stored = history('Welcome.md');
    expect(launchTarget(LAST, null, null)).toEqual({ kind: 'deciding' });
    expect(launchTarget(LAST, stored, null)).toEqual({ kind: 'deciding' });
    // a check of another path is not this launch's check.
    expect(launchTarget(LAST, stored, { path: 'Other.md', reopen: true })).toEqual({ kind: 'deciding' });
    expect(launchTarget(LAST, stored, { path: 'Welcome.md', reopen: true })).toEqual({ kind: 'note', path: 'Welcome.md' });
    expect(launchTarget(LAST, stored, { path: 'Welcome.md', reopen: false })).toEqual({ kind: 'today' });
  });

  test("today's setting and an empty history decide at once", () => {
    expect(launchTarget(TODAY, null, null)).toEqual({ kind: 'today' });
    expect(launchTarget(LAST, EMPTY_HISTORY, null)).toEqual({ kind: 'today' });
  });

  test('reopens a note on disk or in icloud, never a missing or unchecked one', () => {
    expect(canReopen({ kind: 'readable' })).toBe(true);
    expect(canReopen({ kind: 'placeholder' })).toBe(true);
    expect(canReopen({ kind: 'absent' })).toBe(false);
    expect(canReopen({ kind: 'unknown', reason: 'no access' })).toBe(false);
  });
});

describe('stored launch settings', () => {
  test('are stored per vault', () => {
    expect(launchSettingsKey('v1')).toBe('vault:v1:launch');
  });

  test('round-trip, and missing or invalid values give the default', () => {
    expect(parseLaunchSettings(serializeLaunchSettings(TODAY))).toEqual(TODAY);
    expect(parseLaunchSettings(serializeLaunchSettings(LAST))).toEqual(LAST);
    expect(parseLaunchSettings(null)).toEqual(DEFAULT_LAUNCH_SETTINGS);
    expect(parseLaunchSettings('not json')).toEqual(DEFAULT_LAUNCH_SETTINGS);
    expect(parseLaunchSettings(JSON.stringify({ open: 'yesterday' }))).toEqual(DEFAULT_LAUNCH_SETTINGS);
  });
});
