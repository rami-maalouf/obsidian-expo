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
import type { FileSort } from '@/features/explorer/file-sort';
import { ancestorFolders, buildTree, type ExplorerRow, flattenTree } from '@/features/explorer/tree';

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

// times are ms since 1970; each sort puts the root notes in a different order.
const TIMED_NOTES = [
  { path: 'Alpha.md', modified: 100, created: 200 },
  { path: 'beta.md', modified: 300, created: 300 },
  { path: 'Gamma.md', modified: 200, created: 100 },
  { path: 'Undated.md' },
  { path: 'Zoo/Old.md', modified: 1, created: 1 },
  { path: 'Zoo/New.md', modified: 9, created: 9 },
  { path: 'Zoo/Sub/Deep.md', modified: 5, created: 5 },
  { path: 'archive/Index.md', modified: 999, created: 999 },
  { path: 'Middle/Index.md' },
];

const outline = (rows: ExplorerRow[]) => rows.map((row) => `${'  '.repeat(row.depth)}${row.name}`);

describe('explorer sort', () => {
  const tree = buildTree(TIMED_NOTES);
  const expanded = new Set(['Zoo']);
  const sorted = (sort: FileSort) => outline(flattenTree(tree, expanded, sort));

  test('file name a to z is the default; folders come first', () => {
    const expected = ['archive', 'Middle', 'Zoo', '  Sub', '  New', '  Old', 'Alpha', 'beta', 'Gamma', 'Undated'];
    expect(sorted('name-asc')).toEqual(expected);
    expect(outline(flattenTree(tree, expanded))).toEqual(expected);
  });

  test('file name z to a reverses folders and notes; folders still come first', () => {
    expect(sorted('name-desc')).toEqual(['Zoo', '  Sub', '  Old', '  New', 'Middle', 'archive', 'Undated', 'Gamma', 'beta', 'Alpha']);
  });

  test('modified time new to old; folders stay a to z and first', () => {
    expect(sorted('modified-desc')).toEqual(['archive', 'Middle', 'Zoo', '  Sub', '  New', '  Old', 'beta', 'Gamma', 'Alpha', 'Undated']);
  });

  test('modified time old to new; a note without the time goes last', () => {
    expect(sorted('modified-asc')).toEqual(['archive', 'Middle', 'Zoo', '  Sub', '  Old', '  New', 'Alpha', 'Gamma', 'beta', 'Undated']);
  });

  test('created time new to old', () => {
    expect(sorted('created-desc')).toEqual(['archive', 'Middle', 'Zoo', '  Sub', '  New', '  Old', 'beta', 'Alpha', 'Gamma', 'Undated']);
  });

  test('created time old to new', () => {
    expect(sorted('created-asc')).toEqual(['archive', 'Middle', 'Zoo', '  Sub', '  Old', '  New', 'Gamma', 'Alpha', 'beta', 'Undated']);
  });

  test('missing times go last in both directions; equal times sort by name a to z', () => {
    const ties = buildTree([
      { path: 'Gamma.md', modified: 200, created: 200 },
      { path: 'Delta.md', modified: 200, created: 200 },
      { path: 'Undated.md' },
      { path: 'Also undated.md' },
      { path: 'Early.md', modified: 100, created: 100 },
      { path: 'Created only.md', created: 50 },
      { path: 'Bad time.md', modified: Number.NaN, created: Number.POSITIVE_INFINITY },
    ]);
    const names = (sort: FileSort) => flattenTree(ties, new Set(), sort).map((row) => row.name);
    expect(names('modified-desc')).toEqual(['Delta', 'Gamma', 'Early', 'Also undated', 'Bad time', 'Created only', 'Undated']);
    expect(names('modified-asc')).toEqual(['Early', 'Delta', 'Gamma', 'Also undated', 'Bad time', 'Created only', 'Undated']);
    expect(names('created-desc')).toEqual(['Delta', 'Gamma', 'Early', 'Created only', 'Also undated', 'Bad time', 'Undated']);
    expect(names('created-asc')).toEqual(['Created only', 'Early', 'Delta', 'Gamma', 'Also undated', 'Bad time', 'Undated']);
  });

  test('a 10,000-note tree flattens quickly in every sort', () => {
    // every seventh note has no times, so the missing-time path is exercised too.
    const notes = [...generateVault({ count: 10_000 })].map((file, index) =>
      index % 7 === 0 ? { path: file.path } : { path: file.path, modified: (index * 7_919) % 10_007, created: (index * 104_729) % 10_007 },
    );
    const tree = buildTree(notes);
    const all = new Set<string>();
    for (const note of notes) for (const folder of ancestorFolders(note.path)) all.add(folder);
    for (const sort of ['name-asc', 'name-desc', 'modified-desc', 'modified-asc', 'created-desc', 'created-asc'] as const) {
      const start = performance.now();
      const rows = flattenTree(tree, all, sort);
      const elapsed = performance.now() - start;
      expect(rows.filter((row) => row.kind === 'note')).toHaveLength(10_000);
      expect(elapsed).toBeLessThan(2_000);
    }
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
