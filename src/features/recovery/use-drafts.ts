/**
 * unsaved drafts from the journal. recovery comes before today (r11): every draft is kept
 * until a verified save or an explicit discard.
 */
import { useCallback, useEffect, useState } from 'react';

import { captureClock } from '@/features/templates/civil-time';

import { type NativeDraft, VaultNative } from '../../../modules/vault/src';
import { recoveredNotePath } from './recovered-path';

const MAX_NAME_ATTEMPTS = 5;

export function useDrafts(vaultId: string) {
  const [drafts, setDrafts] = useState<NativeDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    VaultNative.listDrafts().then(
      (listing) => !cancelled && setDrafts(listing.drafts.filter((draft) => draft.vaultId === vaultId)),
      (reason: unknown) => !cancelled && setError(String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, version]);

  /** writes the draft to a new note beside the original, then removes the draft. */
  const keepBoth = useCallback(
    async (draft: NativeDraft) => {
      if (!VaultNative) return;
      if (draft.text === undefined) {
        setError('This draft is not UTF-8 text and cannot be written as a note.');
        return;
      }
      const now = captureClock();
      for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
        const result = await VaultNative.createExclusive(vaultId, recoveredNotePath(draft.path, now, attempt), draft.text);
        if (result.kind === 'created') {
          await VaultNative.discardDraft(vaultId, draft.path, draft.sequence);
          refresh();
          return;
        }
        if (result.kind === 'unavailable') {
          setError('The recovered copy could not be written. The draft is kept.');
          return;
        }
      }
      setError('No free name was found for the recovered copy. The draft is kept.');
    },
    [refresh, vaultId],
  );

  const discard = useCallback(
    async (draft: NativeDraft) => {
      if (!VaultNative) return;
      await VaultNative.discardDraft(vaultId, draft.path, draft.sequence);
      refresh();
    },
    [refresh, vaultId],
  );

  return { drafts, error, refresh, keepBoth, discard };
}
