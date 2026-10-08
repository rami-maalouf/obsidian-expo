import { describe, expect, test } from 'bun:test';

import {
  addBookmark,
  EMPTY_BOOKMARKS,
  followMoves,
  moveBookmark,
  parseBookmarks,
  removeBookmark,
  viewBookmarks,
} from '@/features/bookmarks/bookmarks';
import { ancestorFolders, buildTree, flattenTree } from '@/features/explorer/tree';

import { generateVault } from '../../scripts/generate-vault';

const NOTES = [
  { path: 'Welcome.md' },
  { path: 'Projects/Beta/Index.md' },
  { path: 'Projects/Alpha/Index.md' },
  { path: 'Projects/Alpha/Note 10.md' },
  { path: 'Projects/Alpha/Note 9.md' },
  { path: 'Archive/Index.md' },
  { path: 'Daily/2026-10-08.md', placeholder: true },
  { path: 'apple.md' },
];

describe('explorer tree', () => {
  test('collapsed folders come first, then notes, in natural order', () => {
    const rows = flattenTree(buildTree(NOTES), new Set());
    expect(rows.map((row) => `${row.kind}:${row.path}`)).toEqual([
      'folder:Archive',
      'folder:Daily',
      'folder:Projects',
      'note:apple.md',
      'note:Welcome.md',
    ]);
    expect(rows[2]).toMatchObject({ kind: 'folder', count: 4, expanded: false, depth: 0 });
  });

  test('expanded folders show children with depth; numbers sort naturally', () => {
    const rows = flattenTree(buildTree(NOTES), new Set(['Projects', 'Projects/Alpha', 'Daily']));
    expect(rows.map((row) => `${'  '.repeat(row.depth)}${row.name}`)).toEqual([
      'Archive',
      'Daily',
      '  2026-10-08',
      'Projects',
      '  Alpha',
      '    Index',
      '    Note 9',
      '    Note 10',
      '  Beta',
      'apple',
      'Welcome',
    ]);
    expect(rows.find((row) => row.path === 'Daily/2026-10-08.md')).toMatchObject({ placeholder: true });
  });

  test('an expanded folder that is itself inside a collapsed folder stays hidden', () => {
    const rows = flattenTree(buildTree(NOTES), new Set(['Projects/Alpha']));
    expect(rows.some((row) => row.path.startsWith('Projects/Alpha/'))).toBe(false);
  });

  test('ancestor folders reveal a note', () => {
    expect(ancestorFolders('Projects/Alpha/Index.md')).toEqual(['Projects', 'Projects/Alpha']);
    expect(ancestorFolders('Welcome.md')).toEqual([]);
  });

  test('a 10,000-note tree flattens quickly', () => {
    const notes = [...generateVault({ count: 10_000 })].map((file) => ({ path: file.path }));
    const start = performance.now();
    const tree = buildTree(notes);
    const all = new Set<string>();
    for (const note of notes) for (const folder of ancestorFolders(note.path)) all.add(folder);
    const rows = flattenTree(tree, all);
    const elapsed = performance.now() - start;
    expect(rows.filter((row) => row.kind === 'note')).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('bookmarks', () => {
  test('add, dedupe, and remove without touching notes', () => {
    let list = addBookmark(EMPTY_BOOKMARKS, 'Projects/Alpha/Index.md', 1);
    list = addBookmark(list, 'Projects/Alpha/Index.md', 2);
    list = addBookmark(list, 'Projects/Beta/Index.md', 3);
    expect(list.items.map((item) => item.path)).toEqual(['Projects/Alpha/Index.md', 'Projects/Beta/Index.md']);
    expect(removeBookmark(list, 'Projects/Alpha/Index.md').items.map((item) => item.path)).toEqual(['Projects/Beta/Index.md']);
  });

  test('duplicate basenames in different folders are separate bookmarks', () => {
    const list = addBookmark(addBookmark(EMPTY_BOOKMARKS, 'Archive/Index.md', 1), 'Projects/Beta/Index.md', 2);
    expect(viewBookmarks(list, null).map((item) => [item.title, item.path])).toEqual([
      ['Index', 'Archive/Index.md'],
      ['Index', 'Projects/Beta/Index.md'],
    ]);
  });

  test('a missing file stays visible as missing until located or removed', () => {
    let list = addBookmark(EMPTY_BOOKMARKS, 'Old/Name.md', 1);
    expect(viewBookmarks(list, new Set(['Other.md']))[0]).toMatchObject({ path: 'Old/Name.md', missing: true });
    expect(viewBookmarks(list, null)[0].missing).toBe(false);
    list = moveBookmark(list, 'Old/Name.md', 'New/Name.md');
    expect(viewBookmarks(list, new Set(['New/Name.md']))[0]).toMatchObject({ path: 'New/Name.md', missing: false, addedAt: 1 });
  });

  test('moving onto an existing bookmark keeps one entry', () => {
    const list = addBookmark(addBookmark(EMPTY_BOOKMARKS, 'A.md', 1), 'B.md', 2);
    expect(moveBookmark(list, 'A.md', 'B.md').items).toEqual([{ path: 'B.md', addedAt: 2 }]);
  });

  test('a positively observed move is followed; anything else stays missing', () => {
    let list = addBookmark(EMPTY_BOOKMARKS, 'Old.md', 1, 'dev:1');
    list = addBookmark(list, 'NoId.md', 2);
    list = addBookmark(list, 'Twice.md', 3, 'dev:3');
    const notes = [
      { path: 'Folder/Renamed.md', fileId: 'dev:1' },
      { path: 'Copy A.md', fileId: 'dev:3' },
      { path: 'Copy B.md', fileId: 'dev:3' },
      { path: 'Unrelated.md', fileId: 'dev:9' },
    ];
    const next = followMoves(list, notes);
    expect(next.items.map((item) => item.path)).toEqual(['Folder/Renamed.md', 'NoId.md', 'Twice.md']);
    expect(viewBookmarks(next, new Set(notes.map((note) => note.path))).map((item) => item.missing)).toEqual([false, true, true]);
  });

  test('present bookmarks learn their file identity; unchanged lists are returned as is', () => {
    const list = addBookmark(EMPTY_BOOKMARKS, 'A.md', 1);
    const learned = followMoves(list, [{ path: 'A.md', fileId: 'dev:5' }]);
    expect(learned.items).toEqual([{ path: 'A.md', addedAt: 1, fileId: 'dev:5' }]);
    expect(followMoves(learned, [{ path: 'A.md', fileId: 'dev:5' }])).toBe(learned);
  });

  test('stored json is validated', () => {
    expect(parseBookmarks(null)).toEqual(EMPTY_BOOKMARKS);
    expect(parseBookmarks('not json')).toEqual(EMPTY_BOOKMARKS);
    expect(parseBookmarks('{"version":2,"items":[]}')).toEqual(EMPTY_BOOKMARKS);
    expect(parseBookmarks('{"version":1,"items":[{"path":"A.md","addedAt":1},{"path":5}]}').items).toEqual([
      { path: 'A.md', addedAt: 1 },
    ]);
  });
});
