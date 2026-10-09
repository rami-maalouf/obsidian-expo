/**
 * user-facing save state. the note title ends with UNSAVED_MARK while edits wait for a save; the
 * mark goes away only after a successful coordinated save (integrity gate), or for a note opened
 * with no edits. a notice says what happened to the edits only when saving went wrong.
 */
import type { EditorStatus, EditorStatusEvent } from '../../../modules/vault/src/VaultEditorView';

/** a plain asterisk after the note title, as in "2026-10-09*". */
export const UNSAVED_MARK = '*';

export type StatusNotice = { text: string; canRetry: boolean };

/** what went wrong with the edits, or null while opening and saving work. */
export function statusNotice(event: EditorStatusEvent): StatusNotice | null {
  switch (event.status) {
    case 'loading':
    case 'opened':
    case 'unsaved':
    case 'saving':
    case 'saved':
      return null;
    case 'read-only':
      return { text: `Read-only: not UTF-8 text${event.detail ? ` (${event.detail})` : ''}`, canRetry: false };
    case 'conflict':
      return { text: 'Changed in another app. Your edits are kept as a draft.', canRetry: false };
    case 'missing':
      return { text: 'The file was moved or deleted. Your edits are kept as a draft.', canRetry: false };
    case 'checkpoint-failed':
      return { text: 'Edits could not be recorded. Do not close the app.', canRetry: true };
    case 'unavailable':
      return { text: 'The note is not available right now.', canRetry: true };
    case 'error':
      return { text: 'Not saved yet. Your edits are kept as a draft.', canRetry: true };
  }
}

/**
 * whether the title shows the unsaved mark after this status. "unavailable" keeps the earlier
 * answer, because it does not say whether edits are waiting.
 */
export function hasUnsavedEdits(status: EditorStatus, before: boolean): boolean {
  switch (status) {
    case 'loading':
    case 'opened':
    case 'saved':
    case 'read-only':
      return false;
    case 'unsaved':
    case 'saving':
    case 'error':
    case 'conflict':
    case 'missing':
    case 'checkpoint-failed':
      return true;
    case 'unavailable':
      return before;
  }
}
