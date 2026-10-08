import { requireOptionalNativeModule } from 'expo';

export type NativeRevision = { sha256: string; size: number };

export type NativeFileState =
  | { kind: 'readable' }
  | { kind: 'placeholder' }
  | { kind: 'absent' }
  | { kind: 'unknown'; reason: string };

export type NativeReadResult =
  | { kind: 'text'; text: string; bom: boolean; revision: NativeRevision }
  /** not valid utf-8: shown read-only and never saved (r2). */
  | { kind: 'read-only'; preview: string; encoding: string; revision: NativeRevision }
  | { kind: 'unavailable'; state: NativeFileState };

export type NativeCreateResult =
  | { kind: 'created'; revision: NativeRevision }
  | { kind: 'exists' }
  | { kind: 'unavailable'; state: NativeFileState };

export type NativeSaveResult =
  | { kind: 'saved'; revision: NativeRevision }
  | { kind: 'conflict'; current: NativeRevision }
  | { kind: 'missing' }
  | { kind: 'unavailable'; state: NativeFileState };

export type NativeNote = { path: string; placeholder: boolean; size?: number; modified?: number };

export type NativeDraft = {
  vaultId: string;
  path: string;
  sequence: number;
  updatedAt: number;
  base?: NativeRevision;
  /** absent when the stored bytes are not valid utf-8. */
  text?: string;
  bom?: boolean;
};

/** the native vault module. it exists only in ios builds; web and expo go return null. */
export type VaultNativeModule = {
  readonly coreVersion: string;
  /** returns null for a valid vault-relative path, or the reason it is refused. */
  checkRelativePath(path: string): string | null;
  /** resolves null when the user cancels; an open vault stays open. */
  pickVault(): Promise<{ id: string; name: string } | null>;
  listVaults(): Promise<{ id: string; name: string }[]>;
  openVault(id: string): Promise<{ id: string; name?: string; status: 'open' }>;
  closeVault(id: string): Promise<void>;
  /** forgets the vault; its folder and notes are not touched. */
  forgetVault(id: string): Promise<void>;
  fileState(vaultId: string, path: string): Promise<NativeFileState>;
  readText(vaultId: string, path: string): Promise<NativeReadResult>;
  createExclusive(vaultId: string, path: string, text: string): Promise<NativeCreateResult>;
  saveText(
    vaultId: string,
    path: string,
    text: string,
    bom: boolean,
    baseSha256: string,
    baseSize: number,
  ): Promise<NativeSaveResult>;
  listNotes(vaultId: string): Promise<{ notes: NativeNote[]; unreadableFolders: string[] }>;
  checkpointDraft(
    vaultId: string,
    path: string,
    text: string,
    bom: boolean,
    baseSha256: string | null,
    baseSize: number | null,
    sequence: number,
  ): Promise<void>;
  listDrafts(): Promise<{ drafts: NativeDraft[]; unreadable: string[] }>;
  discardDraft(vaultId: string, path: string, sequence: number): Promise<boolean>;
};

export const VaultNative = requireOptionalNativeModule<VaultNativeModule>('Vault');
