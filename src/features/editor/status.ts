/**
 * user-facing save state. routine saving shows nothing; a notice says what happened to the edits
 * only when saving went wrong (the unsaved mark after the title was removed on october 10, 2026,
 * at the user's request).
 */
import type { EditorStatusEvent } from '../../../modules/vault/src/VaultEditorView';

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
