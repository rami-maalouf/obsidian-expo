import { describe, expect, test } from 'bun:test';

import { DailyNoteResolver } from '@/features/daily-notes/resolver';
import { DEFAULT_DAILY_NOTE_SETTINGS } from '@/features/daily-notes/settings';
import { dailyNoteVault } from '@/features/vault/daily-note-vault';

import type { NativeCreateResult, NativeFileState, NativeReadResult } from '../../modules/vault/src';

const NOW = { year: 2026, month: 10, day: 8, hour: 7, minute: 5, second: 0 };
const REVISION = { sha256: 'abc', size: 3 };

function fakeNative(overrides: {
  fileState?: NativeFileState;
  readText?: NativeReadResult;
  createExclusive?: NativeCreateResult;
}) {
  const calls: string[] = [];
  return {
    calls,
    native: {
      async fileState(vaultId: string, path: string) {
        calls.push(`fileState ${vaultId} ${path}`);
        return overrides.fileState ?? { kind: 'absent' as const };
      },
      async readText(vaultId: string, path: string) {
        calls.push(`readText ${vaultId} ${path}`);
        return overrides.readText ?? { kind: 'unavailable' as const, state: { kind: 'absent' as const } };
      },
      async createExclusive(vaultId: string, path: string, text: string) {
        calls.push(`createExclusive ${vaultId} ${path} ${JSON.stringify(text)}`);
        return overrides.createExclusive ?? { kind: 'created' as const, revision: REVISION };
      },
    },
  };
}

describe('dailyNoteVault', () => {
  test('passes the vault id and maps states', async () => {
    const { native, calls } = fakeNative({ fileState: { kind: 'unknown', reason: 'revoked' } });
    const vault = dailyNoteVault(native, 'v1');
    expect(await vault.fileState('Daily/x.md')).toEqual({ kind: 'unknown', reason: 'revoked' });
    expect(calls).toEqual(['fileState v1 Daily/x.md']);
  });

  test('read-only encodings are unsupported and never treated as text', async () => {
    const { native } = fakeNative({
      readText: { kind: 'read-only', preview: 'Caf�', encoding: 'unknown', revision: REVISION },
    });
    expect(await dailyNoteVault(native, 'v1').readText('T.md')).toEqual({ kind: 'unsupported-encoding' });
  });

  test('creation outcomes map to the resolver protocol', async () => {
    expect(await dailyNoteVault(fakeNative({}).native, 'v1').createExclusive('a.md', 'x')).toEqual({ kind: 'created' });
    expect(
      await dailyNoteVault(fakeNative({ createExclusive: { kind: 'exists' } }).native, 'v1').createExclusive('a.md', 'x'),
    ).toEqual({ kind: 'exists' });
    expect(
      await dailyNoteVault(
        fakeNative({ createExclusive: { kind: 'unavailable', state: { kind: 'unknown', reason: 'locked' } } }).native,
        'v1',
      ).createExclusive('a.md', 'x'),
    ).toEqual({ kind: 'failed', reason: 'locked' });
  });

  test('the resolver creates today through the adapter with the rendered built-in template', async () => {
    const { native, calls } = fakeNative({});
    const result = await new DailyNoteResolver(() => NOW).open(
      dailyNoteVault(native, 'v1'),
      { year: 2026, month: 10, day: 8 },
      DEFAULT_DAILY_NOTE_SETTINGS,
    );
    expect(result).toEqual({ outcome: { kind: 'open', path: 'Daily/2026-10-08.md', created: true }, current: true });
    expect(calls).toEqual([
      'fileState v1 Daily/2026-10-08.md',
      `createExclusive v1 Daily/2026-10-08.md ${JSON.stringify('# 2026-10-08\n\nCreated 2026-10-08 07:05\n\n')}`,
    ]);
  });
});

describe('launchVault', () => {
  test('prefers the last used vault, else the newest', async () => {
    const { launchVault } = await import('@/features/vault/launch');
    const vaults = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    expect(launchVault(vaults, 'a')?.id).toBe('a');
    expect(launchVault(vaults, 'gone')?.id).toBe('b');
    expect(launchVault(vaults, null)?.id).toBe('b');
    expect(launchVault([], 'a')).toBeUndefined();
  });
});
