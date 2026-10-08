/**
 * adapts the native vault module to the daily-note resolver's interface.
 */
import type { DailyNoteVault, FileState, ReadTextResult } from '@/features/daily-notes/resolver';

import type { NativeFileState, VaultNativeModule } from '../../../modules/vault/src';

type NativeVaultFiles = Pick<VaultNativeModule, 'fileState' | 'readText' | 'createExclusive'>;

function toFileState(state: NativeFileState): FileState {
  return state.kind === 'unknown' ? { kind: 'unknown', reason: state.reason } : { kind: state.kind };
}

export function dailyNoteVault(native: NativeVaultFiles, vaultId: string): DailyNoteVault {
  return {
    vaultId,
    async fileState(path) {
      return toFileState(await native.fileState(vaultId, path));
    },
    async readText(path): Promise<ReadTextResult> {
      const result = await native.readText(vaultId, path);
      if (result.kind === 'text') {
        return { kind: 'text', text: result.text };
      }
      if (result.kind === 'read-only') {
        return { kind: 'unsupported-encoding' };
      }
      const state = toFileState(result.state);
      // a readable state cannot accompany an unavailable result; treat it as unknown.
      return {
        kind: 'unavailable',
        state: state.kind === 'readable' ? { kind: 'unknown', reason: 'the file could not be read' } : state,
      };
    },
    async createExclusive(path, text) {
      const result = await native.createExclusive(vaultId, path, text);
      if (result.kind === 'created') {
        return { kind: 'created' };
      }
      if (result.kind === 'exists') {
        return { kind: 'exists' };
      }
      const state = toFileState(result.state);
      return { kind: 'failed', reason: state.kind === 'unknown' ? state.reason : `the file is ${state.kind}` };
    },
  };
}
