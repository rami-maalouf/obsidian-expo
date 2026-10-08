/**
 * keeps the open vault's search index current: names first, then content in the background.
 */
import { useEffect, useState } from 'react';

import { VaultNative } from '../../../modules/vault/src';
import { openIndexDatabase } from './open-index';
import { type Coverage, SearchIndex, SearchSession } from './search-index';

export type IndexState =
  | { phase: 'unavailable' }
  | { phase: 'opening' }
  | { phase: 'ready'; session: SearchSession; index: SearchIndex; indexing: boolean; coverage: Coverage | null };

/** `enabled` false holds indexing back, for example until the first note is on screen. */
export function useSearchIndex(vaultId: string, enabled = true) {
  const [state, setState] = useState<IndexState>(VaultNative ? { phase: 'opening' } : { phase: 'unavailable' });

  useEffect(() => {
    const native = VaultNative;
    if (!native || !enabled) return;
    let cancelled = false;
    (async () => {
      const db = await openIndexDatabase(vaultId);
      if (!db || cancelled) return;
      const index = await SearchIndex.open(db, {
        listNotes: () => native.listNotes(vaultId),
        readText: (path) => native.readText(vaultId, path),
      });
      const session = new SearchSession(index);
      const publish = async (indexing: boolean) => {
        const coverage = await index.coverage();
        if (!cancelled) setState({ phase: 'ready', session, index, indexing, coverage });
      };
      await publish(true);
      await index.discover();
      await publish(true);
      await index.indexContents(() => cancelled);
      await publish(false);
    })().catch(() => {
      if (!cancelled) setState({ phase: 'unavailable' });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, vaultId]);

  return state;
}
