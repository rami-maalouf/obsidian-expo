/**
 * the native editor with its save status. the status line is a live region so voiceover
 * announces saves and problems (r17).
 */
import { type ReactNode, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
  /** extra header controls, such as a search button. */
  accessory?: ReactNode;
};

export function noteTitle(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

export function NoteEditor({ vaultId, path, onRecoveryNeeded, onSaved, accessory }: NoteEditorProps) {
  const theme = useTheme();
  const editor = useRef<VaultEditorHandle>(null);
  const [status, setStatus] = useState<EditorStatusEvent>({ status: 'loading' });
  const [load, setLoad] = useState<EditorLoadEvent | null>(null);
  const label = statusLabel(status);

  if (!VaultEditorView) {
    return null;
  }
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.title} accessibilityRole="header">
          {noteTitle(path)}
        </ThemedText>
        <ThemedText
          type="small"
          themeColor={label.tone === 'quiet' ? 'textSecondary' : 'text'}
          accessibilityLiveRegion="polite"
          numberOfLines={2}
          style={styles.status}>
          {label.text}
        </ThemedText>
        {label.canRetry && <Button kind="plain" title="Retry" onPress={() => editor.current?.flush()} />}
        {accessory}
      </View>
      {load?.kind === 'unavailable' && (
        <ThemedText type="small" style={styles.notice}>
          This note cannot be opened right now ({load.reason}).
        </ThemedText>
      )}
      <VaultEditorView
        ref={editor}
        style={[styles.editor, { backgroundColor: theme.background }]}
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
          if (event.nativeEvent.kind === 'recovery-needed') {
            onRecoveryNeeded(path);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  title: {
    flexShrink: 1,
  },
  status: {
    flex: 1,
    textAlign: 'right',
  },
  notice: {
    paddingHorizontal: Spacing.three,
  },
  editor: {
    flex: 1,
  },
});
