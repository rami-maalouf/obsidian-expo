/**
 * the notes opened in a vault, in order, with a position that back and forward move, as in a
 * browser or obsidian. it is app data outside the vault (ktd7), stored per vault, so the next
 * launch can reopen the last note. the stored shape already holds several tabs; the app shows one.
 */

export type HistoryEntry = {
  path: string;
  /** the file's identity when it was last listed, used only to follow a positively observed move. */
  fileId?: string;
};

/** one tab's notes, oldest first; `index` is the note on screen, or -1 when the list is empty. */
export type TabHistory = { entries: HistoryEntry[]; index: number };

export type NavigationHistory = { version: 1; tabs: TabHistory[]; active: number };

/** older entries are dropped beyond this many notes per tab. */
export const MAX_HISTORY_ENTRIES = 100;

export const EMPTY_TAB: TabHistory = { entries: [], index: -1 };

export const EMPTY_HISTORY: NavigationHistory = { version: 1, tabs: [EMPTY_TAB], active: 0 };

function parseEntry(value: unknown): HistoryEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const { path, fileId } = value as Record<string, unknown>;
  if (typeof path !== 'string' || path === '') return null;
  return typeof fileId === 'string' ? { path, fileId } : { path };
}

function parseTab(value: unknown): TabHistory | null {
  if (typeof value !== 'object' || value === null) return null;
  const { entries, index } = value as Record<string, unknown>;
  if (!Array.isArray(entries) || typeof index !== 'number' || !Number.isInteger(index)) return null;
  const parsed: HistoryEntry[] = [];
  for (const entry of entries) {
    const next = parseEntry(entry);
    if (!next) return null;
    parsed.push(next);
  }
  if (parsed.length === 0) return EMPTY_TAB;
  if (index < 0 || index >= parsed.length) return null;
  return trim({ entries: parsed, index });
}

/** missing or invalid stored history gives an empty history; it is only a convenience. */
export function parseHistory(json: string | null): NavigationHistory {
  if (!json) return EMPTY_HISTORY;
  try {
    const value = JSON.parse(json) as Partial<NavigationHistory>;
    if (value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length === 0) return EMPTY_HISTORY;
    const tabs: TabHistory[] = [];
    for (const tab of value.tabs) {
      const parsed = parseTab(tab);
      if (!parsed) return EMPTY_HISTORY;
      tabs.push(parsed);
    }
    const active = typeof value.active === 'number' && Number.isInteger(value.active) ? value.active : -1;
    if (active < 0 || active >= tabs.length) return EMPTY_HISTORY;
    return { version: 1, tabs, active };
  } catch {
    return EMPTY_HISTORY;
  }
}

export function serializeHistory(history: NavigationHistory): string {
  return JSON.stringify(history);
}

export function activeTab(history: NavigationHistory): TabHistory {
  return history.tabs[history.active] ?? EMPTY_TAB;
}

/** the note on screen in the active tab, if any. */
export function currentEntry(history: NavigationHistory): HistoryEntry | null {
  const tab = activeTab(history);
  return tab.entries[tab.index] ?? null;
}

function withActiveTab(history: NavigationHistory, change: (tab: TabHistory) => TabHistory): NavigationHistory {
  const tab = activeTab(history);
  const next = change(tab);
  if (next === tab) return history;
  return { ...history, tabs: history.tabs.map((item, index) => (index === history.active ? next : item)) };
}

/** keeps at most MAX_HISTORY_ENTRIES, dropping the oldest. */
function trim(tab: TabHistory): TabHistory {
  const extra = tab.entries.length - MAX_HISTORY_ENTRIES;
  if (extra <= 0) return tab;
  return { entries: tab.entries.slice(extra), index: Math.max(0, tab.index - extra) };
}

/** merges neighbors that name the same note, keeping the index on the same note. */
function collapse(tab: TabHistory): TabHistory {
  const entries: HistoryEntry[] = [];
  let index = -1;
  tab.entries.forEach((entry, position) => {
    const previous = entries.at(-1);
    if (previous && previous.path === entry.path) {
      if (position === tab.index) index = entries.length - 1;
      return;
    }
    entries.push(entry);
    if (position === tab.index) index = entries.length - 1;
  });
  return entries.length === tab.entries.length ? tab : { entries, index };
}

/**
 * records a note opened by the user, a link, the calendar, or the launch. the notes after the
 * current one are dropped, as in a browser. opening the note already on screen changes nothing.
 */
export function visit(history: NavigationHistory, path: string): NavigationHistory {
  return withActiveTab(history, (tab) => {
    if (tab.entries[tab.index]?.path === path) return tab;
    const entries = [...tab.entries.slice(0, tab.index + 1), { path }];
    return trim({ entries, index: entries.length - 1 });
  });
}

/**
 * the position `step` notes away (-1 is back, 1 is forward), skipping notes that are known to be
 * missing. `known` is null while the vault listing is not loaded; then nothing is skipped.
 * returns null when there is no such note.
 */
export function stepTarget(history: NavigationHistory, step: -1 | 1, known: ReadonlySet<string> | null): number | null {
  const tab = activeTab(history);
  for (let index = tab.index + step; index >= 0 && index < tab.entries.length; index += step) {
    const entry = tab.entries[index];
    if (!known || known.has(entry.path)) return index;
  }
  return null;
}

/** moves to a position that stepTarget returned. */
export function moveTo(history: NavigationHistory, index: number): NavigationHistory {
  return withActiveTab(history, (tab) => (index === tab.index || !tab.entries[index] ? tab : { ...tab, index }));
}

/** a note renamed in the app: every entry for it follows, in every tab. */
export function renameInHistory(history: NavigationHistory, from: string, to: string): NavigationHistory {
  if (from === to) return history;
  let changed = false;
  const tabs = history.tabs.map((tab) => {
    if (!tab.entries.some((entry) => entry.path === from)) return tab;
    changed = true;
    return collapse({ ...tab, entries: tab.entries.map((entry) => (entry.path === from ? { ...entry, path: to } : entry)) });
  });
  return changed ? { ...history, tabs } : history;
}

/**
 * follows moves that were positively observed, with the same rule as bookmarks: an entry whose
 * path is gone moves to the one listed note with the same file identity. no identity, or several
 * matches, leaves it in place, and back and forward skip it. entries that are still present
 * learn their identity for later. the note on screen never moves here; it is left to the editor,
 * so the history and the screen agree.
 */
export function followHistoryMoves(history: NavigationHistory, notes: { path: string; fileId?: string }[]): NavigationHistory {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const byId = new Map<string, string[]>();
  for (const note of notes) {
    if (note.fileId) byId.set(note.fileId, [...(byId.get(note.fileId) ?? []), note.path]);
  }
  let changed = false;
  const tabs = history.tabs.map((tab, tabIndex) => {
    let tabChanged = false;
    const entries = tab.entries.map((entry, index) => {
      const present = byPath.get(entry.path);
      if (present) {
        if (!present.fileId || present.fileId === entry.fileId) return entry;
        tabChanged = true;
        return { ...entry, fileId: present.fileId };
      }
      if (tabIndex === history.active && index === tab.index) return entry;
      const candidates = entry.fileId ? (byId.get(entry.fileId) ?? []) : [];
      if (candidates.length !== 1) return entry;
      tabChanged = true;
      return { ...entry, path: candidates[0] };
    });
    if (!tabChanged) return tab;
    changed = true;
    return collapse({ ...tab, entries });
  });
  return changed ? { ...history, tabs } : history;
}
