import { describe, expect, test } from 'bun:test';

import { createUntitledNote, folderOf, linkedNotePath, untitledPath } from '@/features/explorer/new-note';
import { HIGHLIGHT_END, HIGHLIGHT_START } from '@/features/search/query';
import { snippetMarkdown } from '@/features/search/coverage';

describe('new notes', () => {
  test('names follow obsidian: Untitled, then Untitled 1, 2, …', () => {
    expect(untitledPath('', 0)).toBe('Untitled.md');
    expect(untitledPath('Projects/Alpha', 2)).toBe('Projects/Alpha/Untitled 2.md');
    expect(folderOf('Projects/Alpha/Plan.md')).toBe('Projects/Alpha');
    expect(folderOf('Welcome.md')).toBe('');
    expect(folderOf(null)).toBe('');
  });

  test('a link to a missing note names it beside the open note, or at its vault path', () => {
    expect(linkedNotePath('Meeting notes', 'Daily/2026-10-08.md')).toBe('Daily/Meeting notes.md');
    expect(linkedNotePath('  Ideas.md ', 'Welcome.md')).toBe('Ideas.md');
    expect(linkedNotePath('Ideas', null)).toBe('Ideas.md');
    expect(linkedNotePath('Projects/Plan', 'Daily/2026-10-08.md')).toBe('Projects/Plan.md');
    expect(linkedNotePath('/Projects/ Plan ', null)).toBe('Projects/Plan.md');
  });

  test('a link whose name cannot be a file creates nothing', () => {
    expect(linkedNotePath('', 'Welcome.md')).toBeNull();
    expect(linkedNotePath('   ', 'Welcome.md')).toBeNull();
    expect(linkedNotePath('What? Why', 'Welcome.md')).toBeNull();
    expect(linkedNotePath('a:b', 'Welcome.md')).toBeNull();
    expect(linkedNotePath('Projects//Plan', null)).toBeNull();
    expect(linkedNotePath('Projects/', null)).toBeNull();
  });

  test('takes the first free name and never replaces a file', async () => {
    const existing = new Set(['Daily/Untitled.md', 'Daily/Untitled 1.md']);
    const calls: string[] = [];
    const created = await createUntitledNote('Daily', async (path) => {
      calls.push(path);
      return existing.has(path) ? 'exists' : 'created';
    });
    expect(created).toBe('Daily/Untitled 2.md');
    expect(calls).toEqual(['Daily/Untitled.md', 'Daily/Untitled 1.md', 'Daily/Untitled 2.md']);
  });

  test('stops at the first failure and after a bounded number of names', async () => {
    expect(await createUntitledNote('', async () => 'failed')).toBeNull();
    let count = 0;
    expect(
      await createUntitledNote('', async () => {
        count++;
        return 'exists';
      }),
    ).toBeNull();
    expect(count).toBe(100);
  });
});

describe('search snippet markdown', () => {
  test('matches are bold and note text cannot become markdown', () => {
    const snippet = `a *star* and ${HIGHLIGHT_START}harbor${HIGHLIGHT_END} [[link]]\n_x_`;
    expect(snippetMarkdown(snippet)).toBe('a \\*star\\* and **harbor** \\[\\[link\\]\\] \\_x\\_');
  });
});
