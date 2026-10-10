import { requireNativeView } from 'expo';
import type { Ref } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';

import type { NativeFileState } from './index';

export type EditorStatus =
  | 'loading'
  /** opened with no edits yet; nothing has been saved by this editor. */
  | 'opened'
  | 'unsaved'
  | 'saving'
  | 'saved'
  | 'read-only'
  | 'error'
  | 'conflict'
  | 'missing'
  | 'checkpoint-failed'
  | 'unavailable';

export type EditorStatusEvent = { status: EditorStatus; detail?: string };

export type EditorLoadEvent =
  | { kind: 'loaded'; restoredDraft: boolean }
  | { kind: 'read-only'; encoding: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'recovery-needed'; draftSequence: number; diskChanged: boolean };

/** a tap on a wikilink to another note: the target as written, and the matching note's path. */
export type EditorOpenLinkEvent = { target: string; path?: string };

/** the text left its top (`scrolled`) or returned to it. android only. */
export type EditorScrolledEvent = { scrolled: boolean };

/** the bottom toolbar should slide away (`hidden`) or come back, from the user's scrolling. android only. */
export type EditorToolbarHiddenEvent = { hidden: boolean };

export type NativeRenameResult =
  | { kind: 'moved' }
  /** another file already has the new path; nothing moved. */
  | { kind: 'exists' }
  /** the note's file is gone. */
  | { kind: 'missing' }
  /** edits could not be saved first, so the file was not moved. */
  | { kind: 'unsaved' }
  | { kind: 'unavailable'; state: NativeFileState };

export type VaultEditorHandle = {
  /** starts writing pending edits; status events report the result. */
  flush(): Promise<void>;
  focus(): Promise<void>;
  /** saves the open note, then renames its file to a vault path; the caller opens that path. */
  rename(newPath: string): Promise<NativeRenameResult>;
};

export type VaultEditorViewProps = ViewProps & {
  vaultId: string | null;
  path: string | null;
  onStatus?: (event: NativeSyntheticEvent<EditorStatusEvent>) => void;
  onLoad?: (event: NativeSyntheticEvent<EditorLoadEvent>) => void;
  onOpenLink?: (event: NativeSyntheticEvent<EditorOpenLinkEvent>) => void;
  onScrolledChange?: (event: NativeSyntheticEvent<EditorScrolledEvent>) => void;
  onToolbarHiddenChange?: (event: NativeSyntheticEvent<EditorToolbarHiddenEvent>) => void;
  /**
   * ios only: the editor hides its screen's bottom toolbar while the user scrolls toward the end
   * of the note and shows it again when they scroll back or reach the top.
   */
  hidesToolbarOnScroll?: boolean;
  /** android only: the height in dp of a bar over the bottom of the editor; the end of the text scrolls above it. */
  bottomInset?: number;
  ref?: Ref<VaultEditorHandle>;
};

/** the native source editor. it exists in ios and android builds. */
export const VaultEditorView =
  Platform.OS === 'ios' || Platform.OS === 'android' ? requireNativeView<VaultEditorViewProps>('Vault', 'VaultEditorView') : null;
