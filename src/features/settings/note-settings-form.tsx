/** the settings form has ios and android versions; the web shell shows nothing. */
import type { ListedNote } from '@/features/daily-notes/detect';

import type { NoteSettings } from './use-note-settings';

type Props = {
  vaultId: string;
  initial: NoteSettings;
  notes: readonly ListedNote[] | null;
  firstSetup: boolean;
  onSave: (settings: NoteSettings) => void;
  onCancel?: () => void;
};

export function NoteSettingsForm(_props: Props) {
  return null;
}
