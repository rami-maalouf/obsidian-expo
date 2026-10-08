/**
 * per-vault bookmarks, stored as app data outside the vault (r9, r16).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { VaultNative } from '../../../modules/vault/src';
import {
  addBookmark,
  type BookmarkList,
  EMPTY_BOOKMARKS,
  moveBookmark,
  parseBookmarks,
  removeBookmark,
} from './bookmarks';

export function bookmarksKey(vaultId: string) {
  return `vault:${vaultId}:bookmarks`;
}

export function useBookmarks(vaultId: string) {
  const [list, setList] = useState<BookmarkList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<BookmarkList>(EMPTY_BOOKMARKS);

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    VaultNative.readAppData(bookmarksKey(vaultId)).then(
      (json) => {
        if (cancelled) return;
        latest.current = parseBookmarks(json);
        setList(latest.current);
      },
      (reason: unknown) => !cancelled && setError(String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const update = useCallback(
    (change: (current: BookmarkList) => BookmarkList) => {
      const next = change(latest.current);
      latest.current = next;
      setList(next);
      VaultNative?.writeAppData(bookmarksKey(vaultId), JSON.stringify(next)).catch((reason: unknown) =>
        setError(`Bookmarks could not be saved: ${String(reason)}`),
      );
    },
    [vaultId],
  );

  return {
    list,
    error,
    add: (path: string) => update((current) => addBookmark(current, path, Date.now())),
    remove: (path: string) => update((current) => removeBookmark(current, path)),
    move: (from: string, to: string) => update((current) => moveBookmark(current, from, to)),
  };
}
