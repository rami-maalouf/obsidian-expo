/**
 * finds where a vault keeps its daily notes and its daily template, from the file listing
 * alone. no note is read and `.obsidian` is not read (ktd7): the result is a suggestion that
 * the settings form shows with its preview, never a setting that takes effect by itself.
 */
import { type CivilDate, compareCivilDates, parseCivilDate } from '@/features/templates/civil-time';

import { type DailyNoteSettings, DEFAULT_DAILY_NOTE_SETTINGS, FILENAME_FORMATS, type FilenameFormat } from './settings';
import { normalizeFolderPath, normalizeNotePath } from './vault-path';

/** a listed note: its vault-relative path and, when known, its modified time in ms. */
export type ListedNote = { path: string; modified?: number };

export type DailyFolderGuess = {
  /** vault-relative folder; empty means the vault root. */
  folder: string;
  format: FilenameFormat;
  /** notes directly in the folder whose names are dates in `format`. */
  count: number;
  /** the newest of those dates, as its file name, such as `2026-10-08`. */
  latest: string;
};

export type DailyNoteDetection = {
  daily: DailyFolderGuess | null;
  /** vault-relative path of the most likely daily template, or null for none found. */
  template: string | null;
};

/** folder names that say they hold daily notes; the vault root is obsidian's default. */
const DAILY_FOLDER = /daily|journal|diary|\bdays?\b/i;
/**
 * year and month folders, such as `2026`, `2026-10`, `10`, or `10-October`. notes filed by month
 * need a nested path the settings cannot express, so such a folder is never suggested.
 */
const DATE_PART_FOLDER =
  /^(\d{4}|\d{4}-\d{2}|\d{2}|(\d{2}[-_ ]+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec))$/i;
const TEMPLATE_WORD = /templat/i;
const DAILY_TEMPLATE_NAME = /daily/i;
const DAY_TEMPLATE_NAME = /journal|diary|\b(day|today)\b/i;
const OTHER_PERIOD_NAME = /week|month|quarter|year/i;

function splitPath(path: string) {
  const slash = path.lastIndexOf('/');
  const file = path.slice(slash + 1);
  return {
    folder: slash < 0 ? '' : path.slice(0, slash),
    name: /\.md$/i.test(file) ? file.slice(0, -3) : file,
    isMarkdown: /\.md$/i.test(file),
  };
}

function lastSegment(folder: string) {
  return folder.slice(folder.lastIndexOf('/') + 1);
}

function depth(path: string) {
  return path === '' ? 0 : path.split('/').length;
}

type FormatTally = { count: number; latest: CivilDate; latestName: string };

/**
 * the folder with the most notes named by date, in the format most of them use. a folder needs
 * two such notes, or one when its name says it is for daily notes or it is the vault root.
 */
export function detectDailyFolder(notes: readonly ListedNote[]): DailyFolderGuess | null {
  const folders = new Map<string, Map<FilenameFormat, FormatTally>>();
  for (const note of notes) {
    const { folder, name, isMarkdown } = splitPath(note.path);
    if (!isMarkdown || DATE_PART_FOLDER.test(lastSegment(folder))) continue;
    for (const format of FILENAME_FORMATS) {
      const date = parseCivilDate(name, format);
      if (!date) continue;
      let tallies = folders.get(folder);
      if (!tallies) {
        tallies = new Map();
        folders.set(folder, tallies);
      }
      const tally = tallies.get(format);
      if (!tally) {
        tallies.set(format, { count: 1, latest: date, latestName: name });
      } else {
        tally.count++;
        if (compareCivilDates(date, tally.latest) > 0) {
          tally.latest = date;
          tally.latestName = name;
        }
      }
      break;
    }
  }

  let best: (DailyFolderGuess & { total: number; latestDate: CivilDate; named: boolean }) | null = null;
  for (const [folder, tallies] of folders) {
    if (!normalizeFolderPath(folder).ok) continue;
    let format: FilenameFormat | null = null;
    let chosen: FormatTally | null = null;
    let total = 0;
    for (const [candidate, tally] of tallies) {
      total += tally.count;
      // the format most notes use; on a tie, the one the newest note uses.
      if (!chosen || tally.count > chosen.count || (tally.count === chosen.count && compareCivilDates(tally.latest, chosen.latest) > 0)) {
        format = candidate;
        chosen = tally;
      }
    }
    if (!format || !chosen) continue;
    const named = folder === '' || DAILY_FOLDER.test(lastSegment(folder));
    if (total < 2 && !named) continue;
    const better =
      !best ||
      total > best.total ||
      (total === best.total &&
        (named !== best.named
          ? named
          : compareCivilDates(chosen.latest, best.latestDate) > 0 ||
            (compareCivilDates(chosen.latest, best.latestDate) === 0 && depth(folder) < depth(best.folder))));
    if (better) {
      best = { folder, format, count: chosen.count, latest: chosen.latestName, total, latestDate: chosen.latest, named };
    }
  }
  return best && { folder: best.folder, format: best.format, count: best.count, latest: best.latest };
}

/**
 * the Markdown file most likely to be the daily template: named for daily notes ("Daily",
 * "Journal", "Day") and kept in a templates folder or named as a template. among equals, the one
 * changed most recently, then the shortest path.
 */
export function detectDailyTemplate(notes: readonly ListedNote[]): string | null {
  let best: { path: string; score: number; modified: number } | null = null;
  for (const note of notes) {
    const { folder, name, isMarkdown } = splitPath(note.path);
    if (!isMarkdown) continue;
    const inTemplates = folder.split('/').some((segment) => TEMPLATE_WORD.test(segment));
    if (!inTemplates && !TEMPLATE_WORD.test(name)) continue;
    if (OTHER_PERIOD_NAME.test(name)) continue;
    const nameScore = DAILY_TEMPLATE_NAME.test(name) ? 2 : DAY_TEMPLATE_NAME.test(name) ? 1 : 0;
    if (nameScore === 0 || !normalizeNotePath(note.path).ok) continue;
    const score = nameScore * 2 + (inTemplates ? 1 : 0);
    const modified = typeof note.modified === 'number' && Number.isFinite(note.modified) ? note.modified : -Infinity;
    const better =
      !best ||
      score > best.score ||
      (score === best.score &&
        (modified !== best.modified
          ? modified > best.modified
          : note.path.length !== best.path.length
            ? note.path.length < best.path.length
            : note.path < best.path));
    if (better) best = { path: note.path, score, modified };
  }
  return best?.path ?? null;
}

export function detectDailyNotes(notes: readonly ListedNote[]): DailyNoteDetection {
  return { daily: detectDailyFolder(notes), template: detectDailyTemplate(notes) };
}

/** the settings the detection suggests; what it did not find keeps the default. */
export function detectedSettings(detection: DailyNoteDetection): DailyNoteSettings {
  return {
    folder: detection.daily?.folder ?? DEFAULT_DAILY_NOTE_SETTINGS.folder,
    filenameFormat: detection.daily?.format ?? DEFAULT_DAILY_NOTE_SETTINGS.filenameFormat,
    templatePath: detection.template ?? DEFAULT_DAILY_NOTE_SETTINGS.templatePath,
  };
}
