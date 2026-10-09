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
  ref?: Ref<VaultEditorHandle>;
};

/** the native source editor. it exists only in ios builds. */
export const VaultEditorView =
  Platform.OS === 'ios' ? requireNativeView<VaultEditorViewProps>('Vault', 'VaultEditorView') : null;
