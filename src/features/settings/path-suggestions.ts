/**
 * suggestions for the folder and template fields in daily-note settings, ranked like the [[ link
 * popup (ios/Core/WikiLinkTargets.swift): the typed text is matched against folder and file
 * names, or against vault paths when it contains "/", ignoring case and accents.
 */
import { normalizeFolderPath, normalizeNotePath } from '@/features/daily-notes/vault-path';
import { compareNames } from '@/features/explorer/tree';

/** rows shown under a field; a phone keeps them above the keyboard. */
export const SUGGESTION_LIMIT = 5;

export type PathSuggestion = {
  /** the value the field takes: a vault-relative folder, or a note path ending in `.md`. */
  path: string;
  /** the last name in the path, without `.md`. */
  name: string;
  /** the containing folder; empty at the vault root. */
  parent: string;
  /** folders only: notes in the folder and its subfolders. */
  count?: number;
};

type Entry = PathSuggestion & {
  /** folded name, and folded path without `.md`. */
  nameKey: string;
  pathKey: string;
  /** files only: inside a folder whose name says it holds templates. */
  inTemplates: boolean;
  modified: number;
};

export type PathCatalog = { folders: Entry[]; files: Entry[] };

export type CatalogNote = { path: string; modified?: number };

const TEMPLATE_FOLDER = /templat/i;
const COMBINING_MARKS = /[̀-ͯ]/g;
const ASCII = /^[\u0000-\u007f]*$/;

/** case and accent folding; without `normalize`, only case is folded. */
export function foldKey(text: string): string {
  // most vault paths are ascii, which has no accents to remove.
  if (ASCII.test(text) || typeof text.normalize !== 'function') return text.toLowerCase();
  return text.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC').toLowerCase();
}

function parentOf(path: string) {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function lastName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * folders and markdown files from a vault listing, folded once so each keystroke only compares.
 * paths the settings would refuse, such as names with ":", are left out.
 */
export function buildPathCatalog(notes: readonly CatalogNote[]): PathCatalog {
  const counts = new Map<string, number>();
  const files: Entry[] = [];
  for (const note of notes) {
    if (!/\.md$/i.test(note.path)) continue;
    let folder = parentOf(note.path);
    while (folder !== '') {
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
      folder = parentOf(folder);
    }
    if (!normalizeNotePath(note.path).ok) continue;
    const parent = parentOf(note.path);
    const name = lastName(note.path).slice(0, -3);
    files.push({
      path: note.path,
      name,
      parent,
      nameKey: foldKey(name),
      pathKey: foldKey(note.path.slice(0, -3)),
      inTemplates: parent.split('/').some((segment) => TEMPLATE_FOLDER.test(segment)),
      modified: typeof note.modified === 'number' && Number.isFinite(note.modified) ? note.modified : -Infinity,
    });
  }
  const folders: Entry[] = [];
  for (const [path, count] of counts) {
    if (!normalizeFolderPath(path).ok) continue;
    const name = lastName(path);
    folders.push({ path, name, parent: parentOf(path), count, nameKey: foldKey(name), pathKey: foldKey(path), inTemplates: false, modified: -Infinity });
  }
  return { folders, files };
}

function isSeparator(code: number) {
  // space, "-", "_", ".", "/", "(", and "["
  return code === 0x20 || code === 0x2d || code === 0x5f || code === 0x2e || code === 0x2f || code === 0x28 || code === 0x5b;
}

/**
 * how well `query` matches `candidate` (both folded); higher is better, null is no match. an
 * exact match, then a prefix, then a word start, then any substring, then the query's
 * characters in order. an empty query matches everything equally.
 */
export function matchScore(query: string, candidate: string): number | null {
  if (query === '') return 0;
  if (candidate === query) return 4000;
  if (candidate.startsWith(query)) return 3000 - Math.min(candidate.length - query.length, 999);
  const at = candidate.indexOf(query);
  if (at > 0) return (isSeparator(candidate.charCodeAt(at - 1)) ? 2000 : 1000) - Math.min(at, 999);
  let next = 0;
  let first = -1;
  let last = -1;
  let gaps = 0;
  for (let index = 0; index < candidate.length && next < query.length; index++) {
    if (candidate.charCodeAt(index) !== query.charCodeAt(next)) continue;
    if (last >= 0) gaps += index - last - 1;
    else first = index;
    last = index;
    next++;
  }
  return next === query.length ? Math.max(1, 500 - gaps * 10 - first) : null;
}

type Scored = { entry: Entry; score: number };

/**
 * the best `limit` matches, kept sorted as they are found, so a long listing is never sorted
 * whole on a keystroke.
 */
function best(entries: readonly Entry[], query: string, limit: number, compare: (a: Scored, b: Scored) => number) {
  const needle = foldKey(query.trim().replace(/^\/+/, ''));
  const byPath = needle.includes('/');
  const top: Scored[] = [];
  for (const entry of entries) {
    const score = matchScore(needle, byPath ? entry.pathKey : entry.nameKey);
    if (score === null) continue;
    const item = { entry, score };
    if (top.length === limit && compare(item, top[top.length - 1]) >= 0) continue;
    let index = top.length;
    while (index > 0 && compare(item, top[index - 1]) < 0) index--;
    top.splice(index, 0, item);
    if (top.length > limit) top.pop();
  }
  return top.map(({ entry }): PathSuggestion => {
    const { path, name, parent, count } = entry;
    return count === undefined ? { path, name, parent } : { path, name, parent, count };
  });
}

/** folders for the typed text: best match first, then fuller folders, then shorter names. */
export function suggestFolders(catalog: PathCatalog, query: string, limit = SUGGESTION_LIMIT): PathSuggestion[] {
  return best(catalog.folders, query, limit, (a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.entry.count !== b.entry.count) return (b.entry.count ?? 0) - (a.entry.count ?? 0);
    if (a.entry.name.length !== b.entry.name.length) return a.entry.name.length - b.entry.name.length;
    return compareNames(a.entry.path, b.entry.path);
  });
}

/**
 * markdown files for the typed text: best match first, then files in a templates folder, then
 * the most recently changed, then shorter names. with nothing typed, templates come first.
 */
export function suggestTemplates(catalog: PathCatalog, query: string, limit = SUGGESTION_LIMIT): PathSuggestion[] {
  // a typed ".md" is part of the path, not of the name being matched.
  return best(catalog.files, query.trim().replace(/\.md$/i, ''), limit, (a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.entry.inTemplates !== b.entry.inTemplates) return a.entry.inTemplates ? -1 : 1;
    if (a.entry.modified !== b.entry.modified) return a.entry.modified > b.entry.modified ? -1 : 1;
    if (a.entry.name.length !== b.entry.name.length) return a.entry.name.length - b.entry.name.length;
    return compareNames(a.entry.path, b.entry.path);
  });
}
