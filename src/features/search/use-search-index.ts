/**
 * keeps the open vault's search index current: names first, then content in the background.
 * it uses the explorer's listing, so a launch scans the vault once, and each new listing (for
 * example after a note is created) brings the index up to date with it.
 */
import { useEffect, useState } from 'react';

import type { NoteListing } from '@/features/explorer/use-note-list';

import { VaultNative } from '../../../modules/vault/src';
import { openIndexDatabase } from './open-index';
import { type Coverage, SearchIndex, SearchSession } from './search-index';

export type IndexState =
  | { phase: 'unavailable' }
  | { phase: 'opening' }
  | { phase: 'ready'; session: SearchSession; index: SearchIndex; indexing: boolean; coverage: Coverage | null };

/** the index opens with the first listing; until then, nothing is read or written. */
export function useSearchIndex(vaultId: string, listing: NoteListing | null) {
  const [state, setState] = useState<IndexState>(VaultNative ? { phase: 'opening' } : { phase: 'unavailable' });
  const [opened, setOpened] = useState<{ index: SearchIndex; session: SearchSession } | null>(null);
  const listed = listing !== null;

  useEffect(() => {
    const native = VaultNative;
    if (!native || !listed) return;
    let cancelled = false;
    (async () => {
      const db = await openIndexDatabase(vaultId);
      if (!db || cancelled) return;
      const index = await SearchIndex.open(db, {
        listNotes: () => native.listNotes(vaultId),
        readText: (path) => native.readText(vaultId, path),
      });
      if (!cancelled) setOpened({ index, session: new SearchSession(index) });
    })().catch(() => {
      if (!cancelled) setState({ phase: 'unavailable' });
    });
    return () => {
      cancelled = true;
    };
  }, [listed, vaultId]);

  useEffect(() => {
    if (!opened || !listing) return;
    let cancelled = false;
    const { index, session } = opened;
    const publish = async (indexing: boolean) => {
      const coverage = await index.coverage();
      if (!cancelled) setState({ phase: 'ready', session, index, indexing, coverage });
    };
    (async () => {
      await publish(true);
      await index.discover({ listing, listedAt: listing.listedAt });
      await publish(true);
      await index.indexContents(() => cancelled);
      await publish(false);
    })().catch(() => {
      if (!cancelled) setState({ phase: 'unavailable' });
    });
    return () => {
      cancelled = true;
    };
  }, [opened, listing]);

  return state;
}
