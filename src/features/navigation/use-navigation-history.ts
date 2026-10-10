/**
 * the open vault's note history, stored as app data outside the vault (ktd7), like bookmarks.
 * the history is a convenience: a value that cannot be read or saved never blocks a note.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { VaultNative } from '../../../modules/vault/src';
import {
  currentEntry,
  EMPTY_HISTORY,
  followHistoryMoves,
  moveTo,
  type NavigationHistory,
  parseHistory,
  renameInHistory,
  serializeHistory,
  stepTarget,
  visit,
} from './history';

export function navigationKey(vaultId: string) {
  return `vault:${vaultId}:navigation`;
}

export function useNavigationHistory(vaultId: string, notes: { path: string; fileId?: string }[] | null = null) {
  /** null until the stored history has been read. */
  const [history, setHistory] = useState<NavigationHistory | null>(VaultNative ? null : EMPTY_HISTORY);
  /** the history as it was stored by the last session, for the launch; null until read. */
  const [stored, setStored] = useState<NavigationHistory | null>(VaultNative ? null : EMPTY_HISTORY);
  const latest = useRef<NavigationHistory>(EMPTY_HISTORY);
  // a change made before the stored value arrives wins over it.
  const changed = useRef(false);

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    const loaded = (json: string | null) => {
      if (cancelled) return;
      const parsed = parseHistory(json);
      if (!changed.current) latest.current = parsed;
      setStored(parsed);
      setHistory(latest.current);
    };
    VaultNative.readAppData(navigationKey(vaultId)).then(loaded, () => loaded(null));
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const update = useCallback(
    (change: (current: NavigationHistory) => NavigationHistory) => {
      const next = change(latest.current);
      if (next === latest.current) return next;
      latest.current = next;
      changed.current = true;
      setHistory(next);
      VaultNative?.writeAppData(navigationKey(vaultId), serializeHistory(next)).catch(() => undefined);
      return next;
    },
    [vaultId],
  );

  // when the listing changes, follow positively observed moves and record identities.
  const loaded = history !== null;
  useEffect(() => {
    if (notes && loaded) update((current) => followHistoryMoves(current, notes));
  }, [notes, loaded, update]);

  const record = useCallback((path: string) => update((current) => visit(current, path)), [update]);
  const rename = useCallback((from: string, to: string) => update((current) => renameInHistory(current, from, to)), [update]);
  /**
   * moves back (-1) or forward (1), skipping notes the listing no longer has, and returns the
   * note to show, or null when there is none.
   */
  const step = useCallback(
    (direction: -1 | 1, known: ReadonlySet<string> | null): string | null => {
      const target = stepTarget(latest.current, direction, known);
      if (target === null) return null;
      return currentEntry(update((current) => moveTo(current, target)))?.path ?? null;
    },
    [update],
  );

  return { history, stored, record, rename, step };
}
