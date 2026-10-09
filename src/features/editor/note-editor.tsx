/**
 * the native editor with its save status. the status line is a live region so voiceover
 * announces saves and problems (r17).
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Accent, SystemColors } from '@/constants/theme';

import {
  type EditorLoadEvent,
  type EditorStatusEvent,
  type VaultEditorHandle,
  VaultEditorView,
} from '../../../modules/vault/src/VaultEditorView';
import { statusLabel } from './status';

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
};

export function noteTitle(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

/** the note title is the navigation title; the editor shows the save status under it. */
export function NoteEditor({ vaultId, path, onRecoveryNeeded, onSaved, onShown, onOpenLink }: NoteEditorProps) {
  const editor = useRef<VaultEditorHandle>(null);
  const [status, setStatus] = useState<EditorStatusEvent>({ status: 'loading' });
  const [load, setLoad] = useState<EditorLoadEvent | null>(null);
  const label = statusLabel(status);

  if (!VaultEditorView) {
    return null;
  }
  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: label.tone === 'warning' ? SystemColors.warning : SystemColors.secondaryLabel }]}>
          {label.text}
        </Text>
        {label.canRetry && (
          <Pressable accessibilityRole="button" onPress={() => editor.current?.flush()} hitSlop={8}>
            <Text style={[styles.status, styles.retry]}>Retry</Text>
          </Pressable>
        )}
      </View>
      {load?.kind === 'unavailable' && (
        <Text style={[styles.notice, { color: SystemColors.warning }]}>This note cannot be opened right now ({load.reason}).</Text>
      )}
      <VaultEditorView
        ref={editor}
        style={styles.editor}
        vaultId={vaultId}
        path={path}
        onStatus={(event) => {
          setStatus(event.nativeEvent);
          if (event.nativeEvent.status === 'saved') {
            onSaved?.(path);
          }
        }}
        onLoad={(event) => {
          setLoad(event.nativeEvent);
          onShown?.();
          if (event.nativeEvent.kind === 'loaded') {
            // the note was chosen on purpose (or is today's): start writing right away.
            editor.current?.focus().catch(() => undefined);
          } else if (event.nativeEvent.kind === 'recovery-needed') {
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
    backgroundColor: SystemColors.background,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  status: {
    fontSize: 13,
  },
  retry: {
    color: Accent,
    fontWeight: '600',
  },
  notice: {
    fontSize: 13,
    paddingHorizontal: 16,
  },
  editor: {
    flex: 1,
  },
});
