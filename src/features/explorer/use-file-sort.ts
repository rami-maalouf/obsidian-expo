/**
 * the file explorer's sort order per vault, stored as app data outside the vault (r8, r16).
 * without the native module (web) the choice lives in memory only.
 */
import { useCallback, useEffect, useState } from 'react';

import { VaultNative } from '../../../modules/vault/src';
import { DEFAULT_FILE_SORT, type FileSort, fileSortKey, parseFileSort } from './file-sort';

export function useFileSort(vaultId: string): { sort: FileSort; setSort(next: FileSort): void } {
  // tagged with its vault, so another vault's order never shows while this one is read.
  const [state, setState] = useState<{ vaultId: string; sort: FileSort } | null>(null);

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    VaultNative.readAppData(fileSortKey(vaultId)).then(
      (json) => {
        if (cancelled) return;
        // a choice made while the stored value was read wins.
        setState((current) => (current?.vaultId === vaultId ? current : { vaultId, sort: parseFileSort(json) }));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const setSort = useCallback(
    (next: FileSort) => {
      setState({ vaultId, sort: next });
      VaultNative?.writeAppData(fileSortKey(vaultId), JSON.stringify(next)).catch(() => undefined);
    },
    [vaultId],
  );

  return { sort: state?.vaultId === vaultId ? state.sort : DEFAULT_FILE_SORT, setSort };
}
