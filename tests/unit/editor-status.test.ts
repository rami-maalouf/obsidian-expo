import { describe, expect, test } from 'bun:test';

import { statusLabel } from '@/features/editor/status';
import { recoveredNotePath } from '@/features/recovery/recovered-path';

import type { EditorStatus } from '../../modules/vault/src/VaultEditorView';

const NOW = { year: 2026, month: 10, day: 8, hour: 7, minute: 5, second: 0 };

describe('statusLabel', () => {
  test('only a completed save reads "Saved locally"', () => {
    const statuses: EditorStatus[] = [
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
    const saved = statuses.filter((status) => statusLabel({ status }).text === 'Saved locally');
    expect(saved).toEqual(['saved']);
  });

  test('failures that keep a draft say so and offer retry where it can help', () => {
    expect(statusLabel({ status: 'error' })).toEqual({
      text: 'Not saved yet. Your edits are kept as a draft.',
      tone: 'warning',
      canRetry: true,
    });
    expect(statusLabel({ status: 'conflict' }).canRetry).toBe(false);
    expect(statusLabel({ status: 'read-only', detail: 'utf-16' }).text).toBe('Read-only: not UTF-8 text (utf-16)');
  });
});

describe('recoveredNotePath', () => {
  test('writes beside the original with a timestamp', () => {
    expect(recoveredNotePath('Daily/2026-10-08.md', NOW)).toBe('Daily/2026-10-08 (recovered 2026-10-08 0705).md');
    expect(recoveredNotePath('Note.md', NOW, 2)).toBe('Note (recovered 2026-10-08 0705 2).md');
    expect(recoveredNotePath('Folder/Upper.MD', NOW)).toBe('Folder/Upper (recovered 2026-10-08 0705).md');
  });
});
