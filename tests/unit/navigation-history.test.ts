import { describe, expect, test } from 'bun:test';

import {
  activeTab,
  currentEntry,
  EMPTY_HISTORY,
  followHistoryMoves,
  MAX_HISTORY_ENTRIES,
  moveTo,
  type NavigationHistory,
  parseHistory,
  renameInHistory,
  serializeHistory,
  stepTarget,
  visit,
} from '@/features/navigation/history';

function visitAll(paths: string[], history: NavigationHistory = EMPTY_HISTORY) {
  return paths.reduce(visit, history);
}

function paths(history: NavigationHistory) {
  return activeTab(history).entries.map((entry) => entry.path);
}

function back(history: NavigationHistory, known: ReadonlySet<string> | null = null) {
  const target = stepTarget(history, -1, known);
  return target === null ? null : moveTo(history, target);
}

function forward(history: NavigationHistory, known: ReadonlySet<string> | null = null) {
  const target = stepTarget(history, 1, known);
  return target === null ? null : moveTo(history, target);
}

describe('note history', () => {
  test('starts empty, with nothing to go back or forward to', () => {
    expect(currentEntry(EMPTY_HISTORY)).toBeNull();
    expect(stepTarget(EMPTY_HISTORY, -1, null)).toBeNull();
    expect(stepTarget(EMPTY_HISTORY, 1, null)).toBeNull();
  });

  test('records opened notes in order and keeps the last one current', () => {
    const history = visitAll(['Daily/2026-10-10.md', 'Welcome.md', 'Projects/Plan.md']);
    expect(paths(history)).toEqual(['Daily/2026-10-10.md', 'Welcome.md', 'Projects/Plan.md']);
    expect(currentEntry(history)?.path).toBe('Projects/Plan.md');
  });

  test('opening the note already on screen changes nothing', () => {
    const history = visitAll(['A.md', 'B.md']);
    expect(visit(history, 'B.md')).toBe(history);
  });

  test('goes back and forward, and stops at either end', () => {
    const history = visitAll(['A.md', 'B.md', 'C.md']);
    const once = back(history)!;
    expect(currentEntry(once)?.path).toBe('B.md');
    const twice = back(once)!;
    expect(currentEntry(twice)?.path).toBe('A.md');
    expect(back(twice)).toBeNull();
    expect(currentEntry(forward(twice)!)?.path).toBe('B.md');
    expect(forward(history)).toBeNull();
    // moving keeps every entry, so forward returns to the same notes.
    expect(paths(twice)).toEqual(['A.md', 'B.md', 'C.md']);
  });

  test('opening a note after going back drops the notes ahead, as in a browser', () => {
    const history = visit(back(back(visitAll(['A.md', 'B.md', 'C.md']))!)!, 'D.md');
    expect(paths(history)).toEqual(['A.md', 'D.md']);
    expect(currentEntry(history)?.path).toBe('D.md');
    expect(forward(history)).toBeNull();
  });

  test('back and forward skip notes that the listing no longer has', () => {
    const history = visitAll(['A.md', 'Gone.md', 'C.md']);
    const known = new Set(['A.md', 'C.md']);
    const previous = back(history, known)!;
    expect(currentEntry(previous)?.path).toBe('A.md');
    expect(currentEntry(forward(previous, known)!)?.path).toBe('C.md');
    // with no listing yet, nothing is skipped.
    expect(currentEntry(back(history)!)?.path).toBe('Gone.md');
    // only missing notes behind: there is nothing to go back to.
    expect(stepTarget(visitAll(['Gone.md', 'C.md']), -1, known)).toBeNull();
  });

  test(`keeps the newest ${MAX_HISTORY_ENTRIES} notes`, () => {
    const many = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) => `Note ${index}.md`);
    const history = visitAll(many);
    expect(paths(history)).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(paths(history)[0]).toBe('Note 5.md');
    expect(currentEntry(history)?.path).toBe(`Note ${MAX_HISTORY_ENTRIES + 4}.md`);
  });
});

describe('renamed and moved notes', () => {
  test('a rename in the app updates every entry for the note', () => {
    const history = renameInHistory(visitAll(['A.md', 'B.md', 'A.md']), 'A.md', 'Renamed.md');
    expect(paths(history)).toEqual(['Renamed.md', 'B.md', 'Renamed.md']);
    expect(currentEntry(history)?.path).toBe('Renamed.md');
  });

  test('a rename that makes neighbors equal merges them and keeps the position', () => {
    const history = renameInHistory(visitAll(['A.md', 'B.md']), 'B.md', 'A.md');
    expect(paths(history)).toEqual(['A.md']);
    expect(currentEntry(history)?.path).toBe('A.md');
  });

  test('a rename of a note not in the history changes nothing', () => {
    const history = visitAll(['A.md']);
    expect(renameInHistory(history, 'B.md', 'C.md')).toBe(history);
  });

  test('entries learn their file identity and follow a positively observed move', () => {
    const history = visitAll(['A.md', 'B.md']);
    const learned = followHistoryMoves(history, [
      { path: 'A.md', fileId: '1:10' },
      { path: 'B.md', fileId: '1:20' },
    ]);
    expect(activeTab(learned).entries).toEqual([
      { path: 'A.md', fileId: '1:10' },
      { path: 'B.md', fileId: '1:20' },
    ]);
    const moved = followHistoryMoves(learned, [
      { path: 'Archive/A.md', fileId: '1:10' },
      { path: 'B.md', fileId: '1:20' },
    ]);
    expect(paths(moved)).toEqual(['Archive/A.md', 'B.md']);
    expect(followHistoryMoves(moved, [{ path: 'Archive/A.md', fileId: '1:10' }, { path: 'B.md', fileId: '1:20' }])).toBe(moved);
  });

  test('a move is not guessed without one matching identity', () => {
    const history = followHistoryMoves(visitAll(['A.md', 'B.md']), [
      { path: 'A.md', fileId: '1:10' },
      { path: 'B.md' },
    ]);
    const unknown = followHistoryMoves(history, [{ path: 'B.md' }]);
    expect(paths(unknown)).toEqual(['A.md', 'B.md']);
    const twice = followHistoryMoves(history, [
      { path: 'X.md', fileId: '1:10' },
      { path: 'Y.md', fileId: '1:10' },
      { path: 'B.md' },
    ]);
    expect(paths(twice)).toEqual(['A.md', 'B.md']);
  });

  test('the note on screen never moves, so the history matches the editor', () => {
    const history = followHistoryMoves(visitAll(['A.md']), [{ path: 'A.md', fileId: '1:10' }]);
    const moved = followHistoryMoves(history, [{ path: 'Archive/A.md', fileId: '1:10' }]);
    expect(currentEntry(moved)).toEqual({ path: 'A.md', fileId: '1:10' });
  });
});

describe('stored history', () => {
  test('round-trips through its stored form', () => {
    const history = back(followHistoryMoves(visitAll(['A.md', 'B.md']), [{ path: 'A.md', fileId: '1:10' }]))!;
    expect(parseHistory(serializeHistory(history))).toEqual(history);
  });

  test('missing or invalid stored history is empty', () => {
    expect(parseHistory(null)).toEqual(EMPTY_HISTORY);
    expect(parseHistory('not json')).toEqual(EMPTY_HISTORY);
    expect(parseHistory(JSON.stringify({ version: 2, tabs: [], active: 0 }))).toEqual(EMPTY_HISTORY);
    expect(parseHistory(JSON.stringify({ version: 1, tabs: [{ entries: [{ path: 'A.md' }], index: 3 }], active: 0 }))).toEqual(
      EMPTY_HISTORY,
    );
    expect(parseHistory(JSON.stringify({ version: 1, tabs: [{ entries: [{ path: 7 }], index: 0 }], active: 0 }))).toEqual(
      EMPTY_HISTORY,
    );
    expect(parseHistory(JSON.stringify({ version: 1, tabs: [{ entries: [], index: -1 }], active: 1 }))).toEqual(EMPTY_HISTORY);
  });

  test('keeps several tabs and acts on the active one', () => {
    const stored = JSON.stringify({
      version: 1,
      tabs: [
        { entries: [{ path: 'A.md' }], index: 0 },
        { entries: [{ path: 'B.md' }, { path: 'C.md' }], index: 1 },
      ],
      active: 1,
    });
    const history = parseHistory(stored);
    expect(currentEntry(history)?.path).toBe('C.md');
    const next = visit(history, 'D.md');
    expect(next.tabs[0]).toEqual(history.tabs[0]);
    expect(paths(next)).toEqual(['B.md', 'C.md', 'D.md']);
  });
});
