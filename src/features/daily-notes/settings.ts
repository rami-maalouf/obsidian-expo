/**
 * per-vault daily-note settings (KTD7), stored by the app outside the vault.
 */
import {
  type CivilDate,
  type CivilDateTime,
  formatCivilDate,
  isReferenceFormat,
  type ReferenceFormat,
} from '@/features/templates/civil-time';
import { BUILT_IN_TEMPLATE, expandTemplate, type Result, type TemplateError } from '@/features/templates/template';

import { joinVaultPath, normalizeFolderPath, normalizeNotePath } from './vault-path';

export type FilenameFormat = ReferenceFormat;
export const FILENAME_FORMATS: readonly FilenameFormat[] = ['YYYY-MM-DD', 'YYYYMMDD'];

export type DailyNoteSettings = {
  /** vault-relative folder; empty means the vault root. */
  folder: string;
  filenameFormat: FilenameFormat;
  /** vault-relative Markdown path, or null for the built-in template. */
  templatePath: string | null;
};

/** A3: `Daily/YYYY-MM-DD.md` with the built-in template. */
export const DEFAULT_DAILY_NOTE_SETTINGS: DailyNoteSettings = {
  folder: 'Daily',
  filenameFormat: 'YYYY-MM-DD',
  templatePath: null,
};

/** raw values from the settings form. an empty template path selects the built-in template. */
export type DailyNoteSettingsInput = { folder: string; filenameFormat: string; templatePath: string };

export type DailyNoteSettingsErrors = Partial<Record<keyof DailyNoteSettingsInput, string>>;

export function validateDailyNoteSettings(
  input: DailyNoteSettingsInput,
): Result<DailyNoteSettings, DailyNoteSettingsErrors> {
  const errors: DailyNoteSettingsErrors = {};
  const folder = normalizeFolderPath(input.folder);
  if (!folder.ok) {
    errors.folder = folder.error;
  }
  if (!isReferenceFormat(input.filenameFormat)) {
    errors.filenameFormat = `Use ${FILENAME_FORMATS.map((format) => `"${format}"`).join(' or ')}.`;
  }
  const templateInput = input.templatePath.trim();
  const template = templateInput === '' ? null : normalizeNotePath(templateInput);
  if (template && !template.ok) {
    errors.templatePath = template.error;
  }
  if (!folder.ok || !isReferenceFormat(input.filenameFormat) || (template && !template.ok)) {
    return { ok: false, error: errors };
  }
  return {
    ok: true,
    value: { folder: folder.value, filenameFormat: input.filenameFormat, templatePath: template ? template.value : null },
  };
}

export type DailyNoteTarget = {
  /** vault-relative path of the note, such as `Daily/2026-10-08.md`. */
  path: string;
  /** basename without `.md`; this is `tp.file.title`. */
  title: string;
};

/** R14: the selected day, not the clock, decides the path and title. */
export function dailyNoteTarget(date: CivilDate, settings: DailyNoteSettings): DailyNoteTarget {
  const title = formatCivilDate(date, settings.filenameFormat);
  return { path: joinVaultPath(settings.folder, `${title}.md`), title };
}

export type DailyNotePreview = DailyNoteTarget & { content: Result<string, TemplateError> };

/**
 * R12: shows where a day's note would go and what a new note would contain, without touching
 * the vault. `templateSource` is the template file's text, or null for the built-in template.
 */
export function previewDailyNote(
  settings: DailyNoteSettings,
  date: CivilDate,
  now: CivilDateTime,
  templateSource: string | null,
): DailyNotePreview {
  const target = dailyNoteTarget(date, settings);
  const content = expandTemplate(templateSource ?? BUILT_IN_TEMPLATE, { title: target.title, now });
  return { ...target, content };
}
