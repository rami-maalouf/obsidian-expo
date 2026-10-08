/**
 * user-facing save status. "saved locally" appears only after a successful coordinated save
 * (integrity gate); every other state says what happened to the edits.
 */
import type { EditorStatusEvent } from '../../../modules/vault/src/VaultEditorView';

export type StatusTone = 'quiet' | 'busy' | 'warning';

export type StatusLabel = { text: string; tone: StatusTone; canRetry: boolean };

export function statusLabel(event: EditorStatusEvent): StatusLabel {
  switch (event.status) {
    case 'loading':
      return { text: 'Opening…', tone: 'busy', canRetry: false };
    case 'unsaved':
      return { text: 'Unsaved', tone: 'busy', canRetry: false };
    case 'saving':
      return { text: 'Saving…', tone: 'busy', canRetry: false };
    case 'saved':
      return { text: 'Saved locally', tone: 'quiet', canRetry: false };
    case 'read-only':
      return { text: `Read-only: not UTF-8 text${event.detail ? ` (${event.detail})` : ''}`, tone: 'warning', canRetry: false };
    case 'conflict':
      return { text: 'Changed in another app. Your edits are kept as a draft.', tone: 'warning', canRetry: false };
    case 'missing':
      return { text: 'The file was moved or deleted. Your edits are kept as a draft.', tone: 'warning', canRetry: false };
    case 'checkpoint-failed':
      return { text: 'Edits could not be recorded. Do not close the app.', tone: 'warning', canRetry: true };
    case 'unavailable':
      return { text: 'The note is not available right now.', tone: 'warning', canRetry: true };
    case 'error':
      return { text: 'Not saved yet. Your edits are kept as a draft.', tone: 'warning', canRetry: true };
  }
}
