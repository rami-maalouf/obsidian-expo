/**
 * resolves today's daily note through the daily-note protocol (r10, r11, flow f2).
 */
import { useEffect, useState } from 'react';

import { DailyNoteResolver, type DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { DEFAULT_DAILY_NOTE_SETTINGS, type DailyNoteSettings } from '@/features/daily-notes/settings';
import { captureClock } from '@/features/templates/civil-time';
import { dailyNoteVault } from '@/features/vault/daily-note-vault';

import { VaultNative } from '../../../modules/vault/src';

/** one resolver for the app, so repeated requests for the same note are deduplicated (r15). */
export const dailyNotes = new DailyNoteResolver();

export type TodayState = { phase: 'idle' } | { phase: 'resolving' } | { phase: 'done'; outcome: DailyNoteOutcome };

export function useTodayNote(
  vaultId: string,
  enabled: boolean,
  settings: DailyNoteSettings = DEFAULT_DAILY_NOTE_SETTINGS,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; outcome: DailyNoteOutcome } | null>(null);
  const key = `${vaultId}\u0000${attempt}\u0000${JSON.stringify(settings)}`;

  useEffect(() => {
    if (!VaultNative || !enabled) return;
    let cancelled = false;
    dailyNotes.open(dailyNoteVault(VaultNative, vaultId), captureClock(), settings).then(
      ({ outcome, current }) => {
        if (!cancelled && current) setResult({ key, outcome });
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        if (!cancelled) setResult({ key, outcome: { kind: 'failed', path: '', reason } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, key, settings, vaultId]);

  const state: TodayState = !enabled
    ? { phase: 'idle' }
    : result?.key === key
      ? { phase: 'done', outcome: result.outcome }
      : { phase: 'resolving' };
  return { state, retry: () => setAttempt((value) => value + 1) };
}
