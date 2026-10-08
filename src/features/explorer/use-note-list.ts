/**
 * the vault's markdown files for the explorer. the listing is metadata only; no content is read.
 */
import { useCallback, useEffect, useState } from 'react';

import { type NativeNote, VaultNative } from '../../../modules/vault/src';

export type NoteListing = { notes: NativeNote[]; unreadableFolders: string[] };

export function useNoteList(vaultId: string) {
  const [listing, setListing] = useState<NoteListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    VaultNative.listNotes(vaultId).then(
      (next) => !cancelled && setListing(next),
      (reason: unknown) => !cancelled && setError(String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, version]);

  return { listing, error, refresh };
}
