import { useCallback, useEffect, useState } from 'react';

import type { DailyNoteSettings } from '@/features/daily-notes/settings';
import type { LaunchSettings } from '@/features/navigation/launch';
import type { NewNoteSettings } from '@/features/new-notes/settings';

import { VaultNative } from '../../../modules/vault/src';
import { dailySettingsKey, parseDailySettings, serializeDailySettings } from './daily-settings';
import { launchSettingsKey, parseLaunchSettings, serializeLaunchSettings } from './launch-settings';
import { newNoteSettingsKey, parseNewNoteSettings, serializeNewNoteSettings } from './new-note-settings';

/** the per-vault note settings that the settings form edits together. */
export type NoteSettings = { daily: DailyNoteSettings; newNote: NewNoteSettings; launch: LaunchSettings };

export type NoteSettingsState =
  | { phase: 'loading' }
  /** no daily-note settings stored yet: first setup shows the form (a3). */
  | { phase: 'unset'; newNote: NewNoteSettings; launch: LaunchSettings }
  | { phase: 'ready'; settings: NoteSettings };

export function useNoteSettings(vaultId: string) {
  const [state, setState] = useState<NoteSettingsState>({ phase: 'loading' });

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    const native = VaultNative;
    Promise.all([
      native.readAppData(dailySettingsKey(vaultId)).catch(() => null),
      native.readAppData(newNoteSettingsKey(vaultId)).catch(() => null),
      native.readAppData(launchSettingsKey(vaultId)).catch(() => null),
    ]).then(([dailyJson, newNoteJson, launchJson]) => {
      if (cancelled) return;
      const daily = parseDailySettings(dailyJson);
      const newNote = parseNewNoteSettings(newNoteJson);
      const launch = parseLaunchSettings(launchJson);
      setState(daily ? { phase: 'ready', settings: { daily, newNote, launch } } : { phase: 'unset', newNote, launch });
    });
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const save = useCallback(
    async (settings: NoteSettings) => {
      await Promise.all([
        VaultNative?.writeAppData(newNoteSettingsKey(vaultId), serializeNewNoteSettings(settings.newNote)),
        VaultNative?.writeAppData(launchSettingsKey(vaultId), serializeLaunchSettings(settings.launch)),
        VaultNative?.writeAppData(dailySettingsKey(vaultId), serializeDailySettings(settings.daily)),
      ]);
      setState({ phase: 'ready', settings });
    },
    [vaultId],
  );

  return { state, save };
}
