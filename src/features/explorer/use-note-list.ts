/**
 * the vault's markdown files for the explorer and the search index. the listing is metadata
 * only; no content is read. one scan serves both.
 */
import { useCallback, useEffect, useState } from 'react';

import { type NativeNote, VaultNative } from '../../../modules/vault/src';

export type NoteListing = {
  notes: NativeNote[];
  unreadableFolders: string[];
  /** when the scan started (ms): a note refreshed later is newer than this listing knows. */
  listedAt: number;
};

/** `enabled` false holds the scan back, for example until the first note is on screen. */
export function useNoteList(vaultId: string, enabled = true) {
  const [listing, setListing] = useState<NoteListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!VaultNative || !enabled) return;
    let cancelled = false;
    const listedAt = Date.now();
    VaultNative.listNotes(vaultId).then(
      (next) => !cancelled && setListing({ ...next, listedAt }),
      (reason: unknown) => !cancelled && setError(String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, vaultId, version]);

  return { listing, error, refresh };
}
