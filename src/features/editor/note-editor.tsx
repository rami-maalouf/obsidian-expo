/**
 * the native editor, with the note's name above its text in the same scroll view. a notice above
 * the editor appears only when a save went wrong or the note is read-only or unavailable
 * (status.ts). the notice is a live region so voiceover announces problems (r17).
 */
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Accent, useSystemColors } from '@/constants/theme';

import {
  type EditorLoadEvent,
  type EditorStatusEvent,
  type NativeRenameResult,
  type VaultEditorHandle,
  VaultEditorView,
} from '../../../modules/vault/src/VaultEditorView';
import { statusNotice } from './status';

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
  /** called when editing the name above the text ended with a changed name, as typed. */
  onTitleSubmit?: (typed: string) => void;
  /** puts the caret in the name, with the name selected, once the note is open (a new note). */
  selectTitleOnLoad?: boolean;
  /** called after `selectTitleOnLoad` selected the name. */
  onTitleSelected?: () => void;
  /** called when the text leaves its top or returns to it, for the app bar's color. android only. */
  onScrolledChange?: (scrolled: boolean) => void;
  /**
   * the screen's bottom toolbar follows the user's scrolling: it slides away while they scroll
   * toward the end of the note and comes back when they scroll back or reach the top. on ios the
   * editor moves the native toolbar itself; on android it calls `onToolbarHiddenChange`, and the
   * text can scroll `bottomInset` dp above the toolbar.
   */
  hidesToolbarOnScroll?: boolean;
  onToolbarHiddenChange?: (hidden: boolean) => void;
  bottomInset?: number;
  /**
   * the height of a see-through navigation bar over the editor. the text scrolls under the bar
   * and insets itself; a notice above the text starts below the bar.
   */
  headerInset?: number;
  ref?: Ref<NoteEditorHandle>;
};

export type NoteEditorHandle = {
  /**
   * saves the open note, then renames its file; null when no editor is on screen. the editor
   * follows the file and keeps its text, caret, and keyboard.
   */
  rename(newPath: string): Promise<NativeRenameResult | null>;
  /** puts the caret in the name above the text, with the name selected. */
  focusTitle(): void;
  /** shows the open note's name above the text again, for example after a refused rename. */
  resetTitle(): void;
};

export function noteTitle(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

export function NoteEditor({
  vaultId,
  path,
  onRecoveryNeeded,
  onSaved,
  onShown,
  onOpenLink,
  onScrolledChange,
  hidesToolbarOnScroll,
  onToolbarHiddenChange,
  bottomInset,
  onTitleSubmit,
  selectTitleOnLoad = false,
  onTitleSelected,
  headerInset = 0,
  ref,
}: NoteEditorProps) {
  const editor = useRef<VaultEditorHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      rename: async (newPath) => (editor.current ? editor.current.rename(newPath) : null),
      focusTitle: () => void editor.current?.focusTitle(),
      resetTitle: () => void editor.current?.resetTitle(),
    }),
    [],
  );
  const [status, setStatus] = useState<EditorStatusEvent>({ status: 'loading' });
  const [scrolled, setScrolled] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [load, setLoad] = useState<EditorLoadEvent | null>(null);
  const colors = useSystemColors();
  const notice = statusNotice(status);
  const topInset = notice || load?.kind === 'unavailable' ? headerInset : 0;
  useEffect(() => {
    onScrolledChange?.(scrolled);
    // the next note opens at its top.
    return () => onScrolledChange?.(false);
  }, [onScrolledChange, scrolled]);
  useEffect(() => {
    onToolbarHiddenChange?.(toolbarHidden);
    // the next note, or the screen that replaces the editor, starts with the toolbar.
    return () => onToolbarHiddenChange?.(false);
  }, [onToolbarHiddenChange, toolbarHidden]);

  if (!VaultEditorView) {
    return null;
  }
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topInset }]}>
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
          if (next.status === 'saved') {
            onSaved?.(path);
          }
        }}
        onLoad={(event) => {
          const loaded = event.nativeEvent;
          setLoad(loaded);
          onShown?.();
          // a note opens at its top without the keyboard; a tap in the text places the caret. a
          // new note opens with its name selected instead.
          if (selectTitleOnLoad && (loaded.kind === 'loaded' || loaded.kind === 'read-only')) {
            editor.current?.focusTitle();
            onTitleSelected?.();
          }
          if (loaded.kind === 'recovery-needed') {
            onRecoveryNeeded(path);
          }
        }}
        onOpenLink={(event) => onOpenLink?.(event.nativeEvent.target, event.nativeEvent.path ?? null)}
        onScrolledChange={(event) => setScrolled(event.nativeEvent.scrolled)}
        hidesToolbarOnScroll={hidesToolbarOnScroll}
        onToolbarHiddenChange={(event) => setToolbarHidden(event.nativeEvent.hidden)}
        bottomInset={bottomInset}
        onTitleSubmit={(event) => onTitleSubmit?.(event.nativeEvent.title)}
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
