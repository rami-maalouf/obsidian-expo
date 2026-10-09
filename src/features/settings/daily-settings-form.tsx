/** the settings form is native ios ui; other platforms show the app shell only. */
import type { ListedNote } from '@/features/daily-notes/detect';
import type { DailyNoteSettings } from '@/features/daily-notes/settings';

type Props = {
  vaultId: string;
  initial: DailyNoteSettings;
  notes: readonly ListedNote[] | null;
  firstSetup: boolean;
  onSave: (settings: DailyNoteSettings) => void;
  onCancel?: () => void;
};

export function DailySettingsForm(_props: Props) {
  return null;
}
