/**
 * stored new-note settings per vault (r5, ktd7). nothing stored means the default: an empty note
 * beside the open note, as before these settings existed.
 */
import { DEFAULT_NEW_NOTE_SETTINGS, type NewNoteSettings, validateNewNoteSettings } from '@/features/new-notes/settings';

export function newNoteSettingsKey(vaultId: string) {
  return `vault:${vaultId}:new-notes`;
}

/** missing or invalid stored settings give the defaults. */
export function parseNewNoteSettings(json: string | null): NewNoteSettings {
  if (!json) return DEFAULT_NEW_NOTE_SETTINGS;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    const result = validateNewNoteSettings({
      location: typeof value.location === 'string' ? value.location : '',
      folder: typeof value.folder === 'string' ? value.folder : '',
      templatePath: typeof value.templatePath === 'string' ? value.templatePath : '',
    });
    return result.ok ? result.value : DEFAULT_NEW_NOTE_SETTINGS;
  } catch {
    return DEFAULT_NEW_NOTE_SETTINGS;
  }
}

export function serializeNewNoteSettings(settings: NewNoteSettings): string {
  return JSON.stringify({ ...settings, templatePath: settings.templatePath ?? '' });
}
