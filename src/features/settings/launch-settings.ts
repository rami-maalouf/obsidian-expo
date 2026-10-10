/**
 * stored launch settings per vault (r11, ktd7). nothing stored means the default: reopen the note
 * that was open last.
 */
import { DEFAULT_LAUNCH_SETTINGS, isLaunchNote, type LaunchSettings } from '@/features/navigation/launch';

export function launchSettingsKey(vaultId: string) {
  return `vault:${vaultId}:launch`;
}

/** missing or invalid stored settings give the default. */
export function parseLaunchSettings(json: string | null): LaunchSettings {
  if (!json) return DEFAULT_LAUNCH_SETTINGS;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    return isLaunchNote(value.open) ? { open: value.open } : DEFAULT_LAUNCH_SETTINGS;
  } catch {
    return DEFAULT_LAUNCH_SETTINGS;
  }
}

export function serializeLaunchSettings(settings: LaunchSettings): string {
  return JSON.stringify(settings);
}
