import { describe, expect, test } from 'bun:test';

import { type EditorSlot, nextEditorSlot } from '@/features/editor/editor-slot';

describe('editor slot', () => {
  const start: EditorSlot = { path: 'Daily/2026-10-10.md', key: 1 };

  test('the same note keeps its editor', () => {
    expect(nextEditorSlot(start, 'Daily/2026-10-10.md', null)).toBe(start);
  });

  test('another note gets a new editor', () => {
    expect(nextEditorSlot(start, 'Welcome.md', null)).toEqual({ path: 'Welcome.md', key: 2 });
    expect(nextEditorSlot(start, null, null)).toEqual({ path: null, key: 2 });
  });

  test('a note the editor renamed keeps the editor, which follows the file', () => {
    expect(nextEditorSlot(start, 'Daily/Plan.md', 'Daily/Plan.md')).toEqual({ path: 'Daily/Plan.md', key: 1 });
  });

  test('a rename to another path than the one shown does not keep the editor', () => {
    expect(nextEditorSlot(start, 'Welcome.md', 'Daily/Plan.md')).toEqual({ path: 'Welcome.md', key: 2 });
  });
});
