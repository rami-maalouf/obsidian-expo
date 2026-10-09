/**
 * the native editor. the note title shows whether edits wait for a save (status.ts); a notice
 * above the text appears only when a save went wrong or the note is read-only or unavailable.
 * the notice is a live region so voiceover announces problems (r17).
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Accent, useSystemColors } from '@/constants/theme';

import {
  type EditorLoadEvent,
  type EditorStatusEvent,
  type VaultEditorHandle,
  VaultEditorView,
} from '../../../modules/vault/src/VaultEditorView';
import { hasUnsavedEdits, statusNotice } from './status';

type NoteEditorProps = {
  vaultId: string;
  path: string;
  /** called when a journaled draft no longer matches the file and needs a decision. */
  onRecoveryNeeded: (path: string) => void;
  /** called after each completed save, for example to refresh the search index. */
  onSaved?: (path: string) => void;
  /** called once the note's load outcome is on screen, whatever it is. */
  onShown?: () => void;
  /** called when a wikilink to another note is tapped; `path` is the matching note, if any. */
  onOpenLink?: (target: string, path: string | null) => void;
  /** called when edits start or stop waiting for a save, for the unsaved mark in the title. */
  onUnsavedChange?: (unsaved: boolean) => void;
};

export function noteTitle(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

/** the note title is the navigation title; the editor reports its save state to it. */
export function NoteEditor({ vaultId, path, onRecoveryNeeded, onSaved, onShown, onOpenLink, onUnsavedChange }: NoteEditorProps) {
  const editor = useRef<VaultEditorHandle>(null);
  const [status, setStatus] = useState<EditorStatusEvent>({ status: 'loading' });
  const [unsaved, setUnsaved] = useState(false);
  const [load, setLoad] = useState<EditorLoadEvent | null>(null);
  const colors = useSystemColors();
  const notice = statusNotice(status);
  useEffect(() => {
    onUnsavedChange?.(unsaved);
    // a closed editor leaves no mark on the title of the next note.
    return () => onUnsavedChange?.(false);
  }, [onUnsavedChange, unsaved]);

  if (!VaultEditorView) {
    return null;
  }
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {notice && (
        <View style={styles.problemRow}>
          <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colors.warning }]}>
            {notice.text}
          </Text>
          {notice.canRetry && (
            <Pressable accessibilityRole="button" onPress={() => editor.current?.flush()} hitSlop={8}>
              <Text style={[styles.notice, styles.retry]}>Retry</Text>
            </Pressable>
          )}
        </View>
      )}
      {load?.kind === 'unavailable' && (
        <Text style={[styles.notice, styles.loadNotice, { color: colors.warning }]}>
          This note cannot be opened right now ({load.reason}).
        </Text>
      )}
      <VaultEditorView
        ref={editor}
        style={styles.editor}
        vaultId={vaultId}
        path={path}
        onStatus={(event) => {
          const next = event.nativeEvent;
          setStatus(next);
          setUnsaved((before) => hasUnsavedEdits(next.status, before));
          if (next.status === 'saved') {
            onSaved?.(path);
          }
        }}
        onLoad={(event) => {
          setLoad(event.nativeEvent);
          onShown?.();
          // a note opens at its top without the keyboard; a tap in the text places the caret.
          if (event.nativeEvent.kind === 'recovery-needed') {
            onRecoveryNeeded(path);
          }
        }}
        onOpenLink={(event) => onOpenLink?.(event.nativeEvent.target, event.nativeEvent.path ?? null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  problemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  notice: {
    flexShrink: 1,
    fontSize: 13,
  },
  loadNotice: {
    paddingHorizontal: 16,
  },
  retry: {
    color: Accent,
    fontWeight: '600',
  },
  editor: {
    flex: 1,
  },
});
