/**
 * file bookmarks per vault (r9, ktd7). bookmarks are app data outside the vault; removing one
 * never touches its note. a bookmark whose file disappears stays visible as missing until the
 * user locates or removes it; a move is followed only when it was positively observed.
 */

export type Bookmark = { path: string; addedAt: number };

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
    const items = value.items.filter(
      (item): item is Bookmark => typeof item?.path === 'string' && typeof item?.addedAt === 'number',
    );
    return { version: 1, items };
  } catch {
    return EMPTY_BOOKMARKS;
  }
}

export function isBookmarked(list: BookmarkList, path: string) {
  return list.items.some((item) => item.path === path);
}

export function addBookmark(list: BookmarkList, path: string, now: number): BookmarkList {
  if (isBookmarked(list, path)) return list;
  return { version: 1, items: [...list.items, { path, addedAt: now }] };
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
