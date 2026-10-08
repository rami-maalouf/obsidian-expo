/**
 * file bookmarks per vault (r9, ktd7). bookmarks are app data outside the vault; removing one
 * never touches its note. a bookmark whose file disappears stays visible as missing until the
 * user locates or removes it; a move is followed only when it was positively observed.
 */

export type Bookmark = {
  path: string;
  addedAt: number;
  /** the file's identity when bookmarked, used only to follow a positively observed move. */
  fileId?: string;
};

export type BookmarkList = { version: 1; items: Bookmark[] };

export type BookmarkView = Bookmark & { title: string; missing: boolean };

export const EMPTY_BOOKMARKS: BookmarkList = { version: 1, items: [] };

function title(path: string) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.toLowerCase().endsWith('.md') ? file.slice(0, -3) : file;
}

export function parseBookmarks(json: string | null): BookmarkList {
  if (!json) return EMPTY_BOOKMARKS;
  try {
    const value = JSON.parse(json) as Partial<BookmarkList>;
    if (value.version !== 1 || !Array.isArray(value.items)) return EMPTY_BOOKMARKS;
    const items = value.items
      .filter((item): item is Bookmark => typeof item?.path === 'string' && typeof item?.addedAt === 'number')
      .map((item) => (typeof item.fileId === 'string' ? item : { path: item.path, addedAt: item.addedAt }));
    return { version: 1, items };
  } catch {
    return EMPTY_BOOKMARKS;
  }
}

export function isBookmarked(list: BookmarkList, path: string) {
  return list.items.some((item) => item.path === path);
}

export function addBookmark(list: BookmarkList, path: string, now: number, fileId?: string): BookmarkList {
  if (isBookmarked(list, path)) return list;
  return { version: 1, items: [...list.items, fileId ? { path, addedAt: now, fileId } : { path, addedAt: now }] };
}

/** removes the bookmark only; the note itself is never deleted. */
export function removeBookmark(list: BookmarkList, path: string): BookmarkList {
  return { version: 1, items: list.items.filter((item) => item.path !== path) };
}

/** points a bookmark at a new path: a positively observed move, or the user locating the file. */
export function moveBookmark(list: BookmarkList, from: string, to: string): BookmarkList {
  if (isBookmarked(list, to)) return removeBookmark(list, from);
  return { version: 1, items: list.items.map((item) => (item.path === from ? { ...item, path: to } : item)) };
}

/** bookmarks with their current state. `known` is null while the vault listing is not loaded. */
export function viewBookmarks(list: BookmarkList, known: ReadonlySet<string> | null): BookmarkView[] {
  return list.items.map((item) => ({ ...item, title: title(item.path), missing: known !== null && !known.has(item.path) }));
}

/**
 * follows moves that were positively observed: a bookmark whose path is gone moves to the one
 * listed note with the same file identity. no identity, or several matches, leaves it missing.
 * bookmarks that are still present learn their identity for later.
 */
export function followMoves(list: BookmarkList, notes: { path: string; fileId?: string }[]): BookmarkList {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const byId = new Map<string, string[]>();
  for (const note of notes) {
    if (note.fileId) byId.set(note.fileId, [...(byId.get(note.fileId) ?? []), note.path]);
  }
  let changed = false;
  const items: Bookmark[] = [];
  for (const item of list.items) {
    const present = byPath.get(item.path);
    if (present) {
      if (present.fileId && present.fileId !== item.fileId) {
        changed = true;
        items.push({ ...item, fileId: present.fileId });
      } else {
        items.push(item);
      }
      continue;
    }
    const candidates = item.fileId ? (byId.get(item.fileId) ?? []) : [];
    const target = candidates.length === 1 ? candidates[0] : null;
    if (target && !list.items.some((other) => other.path === target)) {
      changed = true;
      items.push({ ...item, path: target });
    } else {
      items.push(item);
    }
  }
  return changed ? { version: 1, items } : list;
}
