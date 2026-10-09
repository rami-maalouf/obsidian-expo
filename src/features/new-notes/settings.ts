/**
 * per-vault settings for new notes (r5): where "New note" puts the file and which template fills
 * it. like the daily-note settings, they are stored by the app outside the vault (ktd7).
 */
import { joinVaultPath, normalizeFolderPath, normalizeNotePath } from '@/features/daily-notes/vault-path';
import { folderOf } from '@/features/explorer/new-note';
import type { CivilDateTime } from '@/features/templates/civil-time';
import { expandTemplate, type Result, type TemplateError } from '@/features/templates/template';

/** obsidian's three choices for new files. */
export type NewNoteLocation = 'beside' | 'root' | 'folder';

export const NEW_NOTE_LOCATIONS: readonly { value: NewNoteLocation; label: string }[] = [
  { value: 'beside', label: 'Same folder as the open note' },
  { value: 'root', label: 'Top of the vault' },
  { value: 'folder', label: 'In the folder below' },
];

export type NewNoteSettings = {
  location: NewNoteLocation;
  /** vault-relative folder for the `folder` location; kept when another location is chosen. */
  folder: string;
  /** vault-relative Markdown path, or null for an empty note. */
  templatePath: string | null;
};

/** what the app did before these settings existed: an empty note beside the open note. */
export const DEFAULT_NEW_NOTE_SETTINGS: NewNoteSettings = { location: 'beside', folder: '', templatePath: null };

/** raw values from the settings form. an empty template path means an empty note. */
export type NewNoteSettingsInput = { location: string; folder: string; templatePath: string };

export type NewNoteSettingsErrors = Partial<Record<keyof NewNoteSettingsInput, string>>;

function isLocation(value: string): value is NewNoteLocation {
  return NEW_NOTE_LOCATIONS.some((location) => location.value === value);
}

export function validateNewNoteSettings(input: NewNoteSettingsInput): Result<NewNoteSettings, NewNoteSettingsErrors> {
  const errors: NewNoteSettingsErrors = {};
  if (!isLocation(input.location)) {
    errors.location = 'Choose where new notes go.';
  }
  // the folder is checked only when it is used; otherwise a valid value is kept for later.
  const folder = normalizeFolderPath(input.folder);
  const usesFolder = input.location === 'folder';
  if (usesFolder && !folder.ok) {
    errors.folder = folder.error;
  } else if (usesFolder && folder.ok && folder.value === '') {
    errors.folder = 'Enter a folder, or choose "Top of the vault".';
  }
  const templateInput = input.templatePath.trim();
  const template = templateInput === '' ? null : normalizeNotePath(templateInput);
  if (template && !template.ok) {
    errors.templatePath = template.error;
  }
  if (Object.keys(errors).length > 0 || !isLocation(input.location)) {
    return { ok: false, error: errors };
  }
  return {
    ok: true,
    value: {
      location: input.location,
      folder: folder.ok ? folder.value : '',
      templatePath: template && template.ok ? template.value : null,
    },
  };
}

/** the folder a new note goes in; `openPath` is the note on screen, if any. */
export function newNoteFolder(settings: NewNoteSettings, openPath: string | null): string {
  switch (settings.location) {
    case 'beside':
      return folderOf(openPath);
    case 'root':
      return '';
    case 'folder':
      return settings.folder;
  }
}

/** a description of where new notes go, for the settings preview. */
export function newNoteWhere(settings: NewNoteSettings): string {
  if (settings.location === 'beside') return 'Untitled.md, beside the open note';
  return joinVaultPath(settings.location === 'folder' ? settings.folder : '', 'Untitled.md');
}

/**
 * a new note's text: empty without a template, or the template for the note's title and the
 * creation clock. nothing in the template runs as code (ktd6).
 */
export function newNoteContent(templateSource: string | null, title: string, now: CivilDateTime): Result<string, TemplateError> {
  return templateSource === null ? { ok: true, value: '' } : expandTemplate(templateSource, { title, now });
}
