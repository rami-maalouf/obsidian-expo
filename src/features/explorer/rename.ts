/**
 * renaming a note from the name above its text: the user edits the name without `.md`, and the
 * note stays in its folder. the native rename saves pending edits first and never replaces
 * another file.
 */
import { joinVaultPath, normalizeNotePath } from '@/features/daily-notes/vault-path';
import type { Result } from '@/features/templates/template';

import { folderOf } from './new-note';

/** the name shown in the rename field: the file name without its folder or `.md`. */
export function editableName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return /\.md$/i.test(file) ? file.slice(0, -3) : file;
}

/**
 * the note's new path for a typed name, or null when the name did not change. a typed `.md` is
 * not doubled. a change of case alone is a rename.
 */
export function renamedPath(path: string, typed: string): Result<string | null, string> {
  const name = typed.trim().replace(/\.md$/i, '').trim();
  if (name === '') {
    return { ok: false, error: 'Enter a name.' };
  }
  if (name.includes('/')) {
    return { ok: false, error: 'A note name can\'t contain "/".' };
  }
  const next = normalizeNotePath(joinVaultPath(folderOf(path), `${name}.md`));
  if (!next.ok) {
    return next;
  }
  return { ok: true, value: next.value === path ? null : next.value };
}

/** what the native rename reported; null when no editor was on screen to save the note. */
export type RenameOutcome =
  | { kind: 'moved' }
  | { kind: 'exists' }
  | { kind: 'missing' }
  | { kind: 'unsaved' }
  | { kind: 'unavailable' }
  | null;

/** the message for a rename that did not happen, or null when the note was renamed. */
export function renameProblem(outcome: RenameOutcome, newPath: string): string | null {
  switch (outcome?.kind) {
    case 'moved':
      return null;
    case 'exists':
      return `A note named "${editableName(newPath)}" already exists in this folder.`;
    case 'missing':
      return 'The note was moved or deleted outside the app.';
    case 'unsaved':
      return 'The note has edits that could not be saved yet, so it was not renamed. Try again after they are saved.';
    case 'unavailable':
      return 'The note is not available right now.';
    default:
      return 'Open the note to rename it.';
  }
}
