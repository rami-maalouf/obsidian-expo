/** the recovery list is native ios ui; other platforms show the app shell only. */
import type { NativeDraft } from '../../../modules/vault/src';

export type RecoveryListProps = {
  drafts: NativeDraft[];
  error: string | null;
  conflicted: ReadonlySet<string>;
  onOpen: (draft: NativeDraft) => void;
  onKeepBoth: (draft: NativeDraft) => void;
  onDiscard: (draft: NativeDraft) => void;
  onContinue: () => void;
};

export function RecoveryList(_props: RecoveryListProps) {
  return null;
}
