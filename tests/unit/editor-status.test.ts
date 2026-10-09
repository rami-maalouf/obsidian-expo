import { describe, expect, test } from 'bun:test';

import { hasUnsavedEdits, statusNotice } from '@/features/editor/status';
import { recoveredNotePath } from '@/features/recovery/recovered-path';

import type { EditorStatus } from '../../modules/vault/src/VaultEditorView';

const NOW = { year: 2026, month: 10, day: 8, hour: 7, minute: 5, second: 0 };

const STATUSES: EditorStatus[] = [
  'loading',
  'opened',
  'unsaved',
  'saving',
  'saved',
  'read-only',
  'error',
  'conflict',
  'missing',
  'checkpoint-failed',
  'unavailable',
];

describe('hasUnsavedEdits', () => {
  test('after edits, only a completed save clears the unsaved mark', () => {
    // "opened" and "loading" come only from opening a note, and read-only notes take no edits.
    const cleared = STATUSES.filter((status) => !hasUnsavedEdits(status, true));
    expect(cleared).toEqual(['loading', 'opened', 'saved', 'read-only']);
  });

  test('typing sets the mark, and a failed save keeps it until a save completes', () => {
    const sequence: EditorStatus[] = ['loading', 'opened', 'unsaved', 'saving', 'error', 'unavailable', 'saving', 'saved'];
    const marks: boolean[] = [];
    sequence.reduce((before, status) => {
      const after = hasUnsavedEdits(status, before);
      marks.push(after);
      return after;
    }, false);
    expect(marks).toEqual([false, false, true, true, true, true, true, false]);
  });

  test('"unavailable" keeps the earlier answer', () => {
    expect(hasUnsavedEdits('unavailable', false)).toBe(false);
    expect(hasUnsavedEdits('unavailable', true)).toBe(true);
  });
});

describe('statusNotice', () => {
  test('opening and saving show no notice', () => {
    const quiet = STATUSES.filter((status) => statusNotice({ status }) === null);
    expect(quiet).toEqual(['loading', 'opened', 'unsaved', 'saving', 'saved']);
  });

  test('failures that keep a draft say so and offer retry where it can help', () => {
    expect(statusNotice({ status: 'error' })).toEqual({
      text: 'Not saved yet. Your edits are kept as a draft.',
      canRetry: true,
    });
    expect(statusNotice({ status: 'conflict' })?.canRetry).toBe(false);
    expect(statusNotice({ status: 'read-only', detail: 'utf-16' })?.text).toBe('Read-only: not UTF-8 text (utf-16)');
  });
});

describe('recoveredNotePath', () => {
  test('writes beside the original with a timestamp', () => {
    expect(recoveredNotePath('Daily/2026-10-08.md', NOW)).toBe('Daily/2026-10-08 (recovered 2026-10-08 0705).md');
    expect(recoveredNotePath('Note.md', NOW, 2)).toBe('Note (recovered 2026-10-08 0705 2).md');
    expect(recoveredNotePath('Folder/Upper.MD', NOW)).toBe('Folder/Upper (recovered 2026-10-08 0705).md');
  });
});
