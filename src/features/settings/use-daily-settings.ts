import { useCallback, useEffect, useState } from 'react';

import type { DailyNoteSettings } from '@/features/daily-notes/settings';

import { VaultNative } from '../../../modules/vault/src';
import { dailySettingsKey, parseDailySettings, serializeDailySettings } from './daily-settings';

export type DailySettingsState =
  | { phase: 'loading' }
  /** nothing stored yet: first setup shows the form with defaults (a3). */
  | { phase: 'unset' }
  | { phase: 'ready'; settings: DailyNoteSettings };

export function useDailySettings(vaultId: string) {
  const [state, setState] = useState<DailySettingsState>({ phase: 'loading' });

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    VaultNative.readAppData(dailySettingsKey(vaultId)).then(
      (json) => {
        if (cancelled) return;
        const settings = parseDailySettings(json);
        setState(settings ? { phase: 'ready', settings } : { phase: 'unset' });
      },
      () => !cancelled && setState({ phase: 'unset' }),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const save = useCallback(
    async (settings: DailyNoteSettings) => {
      await VaultNative?.writeAppData(dailySettingsKey(vaultId), serializeDailySettings(settings));
      setState({ phase: 'ready', settings });
    },
    [vaultId],
  );

  return { state, save };
}
