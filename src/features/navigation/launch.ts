/**
 * which note a launch opens (r11, flow f2, amended october 10, 2026): the note that was open last,
 * as obsidian restores its workspace, or today's note when the vault's settings ask for it.
 * unsaved edits to recover always come first, and a note that is gone opens today's note instead.
 */
import type { NativeFileState } from '../../../modules/vault/src';
import { currentEntry, type NavigationHistory } from './history';

export type LaunchNote = 'last-note' | 'today';

export const LAUNCH_NOTES: readonly { value: LaunchNote; label: string }[] = [
  { value: 'last-note', label: 'The last open note' },
  { value: 'today', label: "Today's note" },
];

export type LaunchSettings = { open: LaunchNote };

export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = { open: 'last-note' };

export function isLaunchNote(value: unknown): value is LaunchNote {
  return LAUNCH_NOTES.some((option) => option.value === value);
}

/** the note to reopen, or null when the launch opens today's note. */
export function launchCandidate(history: NavigationHistory, settings: LaunchSettings): string | null {
  if (settings.open === 'today') return null;
  return currentEntry(history)?.path ?? null;
}

/**
 * a stored note is reopened only when it is still there: on disk, or in icloud and not yet
 * downloaded, as when it is opened from the files panel. otherwise today's note opens.
 */
export function canReopen(state: NativeFileState): boolean {
  return state.kind === 'readable' || state.kind === 'placeholder';
}

/** the first note of a launch: still being chosen, today's note, or the note that was open last. */
export type LaunchTarget = { kind: 'deciding' } | { kind: 'today' } | { kind: 'note'; path: string };

/** whether the stored note at `path` was found still there. */
export type LaunchCheck = { path: string; reopen: boolean };

/**
 * `stored` is the history the last session stored, or null until it is read; `checked` is the
 * result of checking the candidate's file, or null until that check finishes.
 */
export function launchTarget(settings: LaunchSettings, stored: NavigationHistory | null, checked: LaunchCheck | null): LaunchTarget {
  if (settings.open === 'today') return { kind: 'today' };
  if (!stored) return { kind: 'deciding' };
  const candidate = launchCandidate(stored, settings);
  if (!candidate) return { kind: 'today' };
  if (checked?.path !== candidate) return { kind: 'deciding' };
  return checked.reopen ? { kind: 'note', path: candidate } : { kind: 'today' };
}
