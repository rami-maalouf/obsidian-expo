/**
 * stored daily-note settings per vault (r12, ktd7). nothing stored means first setup.
 */
import { type DailyNoteSettings, validateDailyNoteSettings } from '@/features/daily-notes/settings';

export function dailySettingsKey(vaultId: string) {
  return `vault:${vaultId}:daily-notes`;
}

/** returns null for missing or invalid stored settings, so setup is shown again. */
export function parseDailySettings(json: string | null): DailyNoteSettings | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    const result = validateDailyNoteSettings({
      folder: typeof value.folder === 'string' ? value.folder : '',
      filenameFormat: typeof value.filenameFormat === 'string' ? value.filenameFormat : '',
      templatePath: typeof value.templatePath === 'string' ? value.templatePath : '',
    });
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export function serializeDailySettings(settings: DailyNoteSettings): string {
  return JSON.stringify({ ...settings, templatePath: settings.templatePath ?? '' });
}
