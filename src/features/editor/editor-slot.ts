/**
 * which editor shows the open note. the native editor follows a note that it renamed and keeps
 * its text, caret, and keyboard (VaultEditorView), so a rename keeps the editor's react key; any
 * other change of note gets a new key, and so a new editor.
 */
export type EditorSlot = { path: string | null; key: number };

/** the slot for the note at `path`; `renamedTo` is the path the editor's last rename moved to. */
export function nextEditorSlot(slot: EditorSlot, path: string | null, renamedTo: string | null): EditorSlot {
  if (slot.path === path) return slot;
  return { path, key: path !== null && path === renamedTo ? slot.key : slot.key + 1 };
}
