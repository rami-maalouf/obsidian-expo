/**
 * renames the open note to the name typed above its text (r5, ktd7). a refused name, or a rename
 * that did not happen, shows an alert with the reason, and the note's own name comes back. one
 * rename runs at a time.
 */
import { type RefObject, useCallback, useRef } from 'react';
import { Alert } from 'react-native';

import { renamedPath, renameProblem } from '@/features/explorer/rename';

import type { NoteEditorHandle } from './note-editor';

export function useTitleRename(
  editor: RefObject<NoteEditorHandle | null>,
  alertTitle: string,
  onRenamed: (from: string, to: string) => void,
) {
  const running = useRef(false);
  return useCallback(
    async (from: string, typed: string) => {
      const next = renamedPath(from, typed);
      if (running.current || !next.ok || next.value === null) {
        editor.current?.resetTitle();
        if (!running.current && !next.ok) Alert.alert(alertTitle, next.error);
        return;
      }
      const to = next.value;
      running.current = true;
      let problem: string | null;
      try {
        const outcome = editor.current ? await editor.current.rename(to) : null;
        problem = renameProblem(outcome, to);
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      } finally {
        running.current = false;
      }
      if (problem) {
        editor.current?.resetTitle();
        Alert.alert(alertTitle, problem);
      } else {
        onRenamed(from, to);
      }
    },
    [alertTitle, editor, onRenamed],
  );
}
