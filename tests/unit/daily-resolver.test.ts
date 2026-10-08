import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type CreateResult,
  DailyNoteResolver,
  type DailyNoteVault,
  type FileState,
  type ReadTextResult,
} from '@/features/daily-notes/resolver';
import { DEFAULT_DAILY_NOTE_SETTINGS, type DailyNoteSettings } from '@/features/daily-notes/settings';
import type { CivilDateTime } from '@/features/templates/civil-time';

const TEMPLATES = join(import.meta.dir, '../fixtures/vault-basic/Templates');
const NOW: CivilDateTime = { year: 2026, month: 10, day: 8, hour: 0, minute: 15, second: 42 };
const TODAY = { year: 2026, month: 10, day: 8 };
const YESTERDAY = { year: 2026, month: 10, day: 7 };
const WITH_TEMPLATE: DailyNoteSettings = { ...DEFAULT_DAILY_NOTE_SETTINGS, templatePath: 'Templates/Daily.md' };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** in-memory stand-in for the native vault service, recording every mutation attempt. */
class FakeVault implements DailyNoteVault {
  readonly files = new Map<string, string>();
  readonly states = new Map<string, FileState>();
  readonly createCalls: string[] = [];
  readonly stateCalls: string[] = [];
  /** runs before a state lookup completes, to interleave other requests. */
  beforeState?: (path: string) => Promise<void> | void;
  /** runs after a create commits but before it reports back. */
  afterCreate?: (path: string) => Promise<void> | void;
  /** simulates another writer creating the file between the state check and the create. */
  racingWriter?: (path: string) => void;

  constructor(readonly vaultId = 'vault-a') {}

  async fileState(path: string): Promise<FileState> {
    this.stateCalls.push(path);
    await this.beforeState?.(path);
    return this.states.get(path) ?? (this.files.has(path) ? { kind: 'readable' } : { kind: 'absent' });
  }

  async readText(path: string): Promise<ReadTextResult> {
    const state = await this.fileState(path);
    if (state.kind !== 'readable') {
      return { kind: 'unavailable', state };
    }
    const text = this.files.get(path);
    return text === undefined ? { kind: 'unavailable', state: { kind: 'absent' } } : { kind: 'text', text };
  }

  async createExclusive(path: string, text: string): Promise<CreateResult> {
    this.createCalls.push(path);
    this.racingWriter?.(path);
    if (this.files.has(path) || this.states.has(path)) {
      return { kind: 'exists' };
    }
    this.files.set(path, text);
    await this.afterCreate?.(path);
    return { kind: 'created' };
  }
}

function setup(settings: DailyNoteSettings = DEFAULT_DAILY_NOTE_SETTINGS) {
  const vault = new FakeVault();
  const resolver = new DailyNoteResolver(() => NOW);
  return { vault, resolver, open: (date = TODAY, s = settings) => resolver.open(vault, date, s) };
}

describe('existing and unavailable notes', () => {
  test('an existing note opens unchanged even when the template is now invalid', async () => {
    const { vault, open } = setup(WITH_TEMPLATE);
    vault.files.set('Daily/2026-10-08.md', 'original');
    vault.files.set('Templates/Daily.md', '<%* broken %>');
    expect(await open()).toEqual({ outcome: { kind: 'open', path: 'Daily/2026-10-08.md', created: false }, current: true });
    expect(vault.files.get('Daily/2026-10-08.md')).toBe('original');
    expect(vault.createCalls).toEqual([]);
    expect(vault.stateCalls).toEqual(['Daily/2026-10-08.md']);
  });

  test('a cloud placeholder or unknown state shows unavailable and creates nothing', async () => {
    const { vault, open } = setup();
    vault.states.set('Daily/2026-10-08.md', { kind: 'placeholder' });
    expect((await open()).outcome).toEqual({ kind: 'unavailable', path: 'Daily/2026-10-08.md', state: 'placeholder' });
    vault.states.set('Daily/2026-10-08.md', { kind: 'unknown', reason: 'Permission expired' });
    expect((await open()).outcome).toEqual({
      kind: 'unavailable',
      path: 'Daily/2026-10-08.md',
      state: 'unknown',
      reason: 'Permission expired',
    });
    expect(vault.createCalls).toEqual([]);
  });
});

describe('creating a missing note', () => {
  test('yesterday uses its own title while tp.date.now uses the captured clock', async () => {
    const { vault, open } = setup();
    expect((await open(YESTERDAY)).outcome).toEqual({ kind: 'open', path: 'Daily/2026-10-07.md', created: true });
    expect(vault.files.get('Daily/2026-10-07.md')).toBe('# 2026-10-07\n\nCreated 2026-10-08 00:15\n\n');
  });

  test('the supported fixture template creates successfully', async () => {
    const { vault, open } = setup(WITH_TEMPLATE);
    vault.files.set('Templates/Daily.md', readFileSync(join(TEMPLATES, 'Daily.md'), 'utf8'));
    expect((await open(YESTERDAY)).outcome).toMatchObject({ kind: 'open', created: true });
    const text = vault.files.get('Daily/2026-10-07.md') ?? '';
    expect(text).toStartWith('---\ncreated: 2026-10-08 00:15\n---\n\n# 2026-10-07\n\n<< [[2026-10-06]] | [[2026-10-08]] >>');
  });

  test('every unsupported fixture template produces an error and zero mutations', async () => {
    for (const file of readdirSync(join(TEMPLATES, 'Unsupported'))) {
      const { vault, open } = setup({ ...WITH_TEMPLATE, templatePath: `Templates/Unsupported/${file}` });
      vault.files.set(`Templates/Unsupported/${file}`, readFileSync(join(TEMPLATES, 'Unsupported', file), 'utf8'));
      const before = new Map(vault.files);
      const { outcome } = await open();
      expect({ file, kind: outcome.kind }).toEqual({ file, kind: 'template-error' });
      expect(vault.createCalls).toEqual([]);
      expect(vault.files).toEqual(before);
    }
  });

  test('a missing, offline, or non-UTF-8 template blocks creation', async () => {
    const cases: [FileState, RegExp][] = [
      [{ kind: 'absent' }, /No template exists/],
      [{ kind: 'placeholder' }, /has not downloaded/],
      [{ kind: 'unknown', reason: 'denied' }, /could not be read: denied/],
    ];
    for (const [state, reason] of cases) {
      const { vault, open } = setup(WITH_TEMPLATE);
      if (state.kind !== 'absent') {
        vault.states.set('Templates/Daily.md', state);
      }
      const { outcome } = await open();
      expect(outcome).toMatchObject({ kind: 'template-unavailable', templatePath: 'Templates/Daily.md' });
      expect(outcome.kind === 'template-unavailable' ? outcome.reason : '').toMatch(reason);
      expect(vault.createCalls).toEqual([]);
    }

    const vault = new FakeVault();
    vault.readText = async () => ({ kind: 'unsupported-encoding' });
    const { outcome } = await new DailyNoteResolver(() => NOW).open(vault, TODAY, WITH_TEMPLATE);
    expect(outcome).toMatchObject({ kind: 'template-unavailable', reason: 'The template Templates/Daily.md is not UTF-8 text.' });
  });

  test('a create collision reopens the existing file instead of overwriting it', async () => {
    const { vault, open } = setup();
    vault.racingWriter = (path) => vault.files.set(path, 'written elsewhere');
    expect((await open()).outcome).toEqual({ kind: 'open', path: 'Daily/2026-10-08.md', created: false });
    expect(vault.files.get('Daily/2026-10-08.md')).toBe('written elsewhere');
    expect(vault.createCalls).toEqual(['Daily/2026-10-08.md']);
  });

  test('a native create failure is reported', async () => {
    const { vault, open } = setup();
    vault.createExclusive = async () => ({ kind: 'failed', reason: 'Disk full' });
    expect((await open()).outcome).toEqual({ kind: 'failed', path: 'Daily/2026-10-08.md', reason: 'Disk full' });
  });

  test('gives up when the file keeps appearing and disappearing', async () => {
    const { vault, open } = setup();
    vault.createExclusive = async () => ({ kind: 'exists' });
    expect((await open()).outcome).toMatchObject({ kind: 'failed' });
  });
});

describe('sanitized references', () => {
  const VAULT = join(import.meta.dir, '../../docs/references/obsidian/vault');
  const profile = JSON.parse(
    readFileSync(join(import.meta.dir, '../../docs/references/obsidian/daily-note-profile.json'), 'utf8'),
  ) as { dailyNotesFolder: string; filenameFormat: 'YYYY-MM-DD'; supportedTemplate: string; unsupportedTemplate: string; exampleNote: string };
  const JAN_3 = { year: 2000, month: 1, day: 3 };

  function referenceVault() {
    const vault = new FakeVault();
    for (const path of [profile.exampleNote, profile.supportedTemplate, profile.unsupportedTemplate]) {
      vault.files.set(path, readFileSync(join(VAULT, path), 'utf8'));
    }
    return vault;
  }

  test('the example note opens unchanged while the unsupported template is configured', async () => {
    const vault = referenceVault();
    const before = vault.files.get(profile.exampleNote);
    const settings = { folder: profile.dailyNotesFolder, filenameFormat: profile.filenameFormat, templatePath: profile.unsupportedTemplate };
    const { outcome } = await new DailyNoteResolver(() => NOW).open(vault, JAN_3, settings);
    expect(outcome).toEqual({ kind: 'open', path: profile.exampleNote, created: false });
    expect(vault.files.get(profile.exampleNote)).toBe(before);
    expect(vault.createCalls).toEqual([]);
  });

  test('a missing day with the unsupported template creates nothing', async () => {
    const vault = referenceVault();
    const settings = { folder: profile.dailyNotesFolder, filenameFormat: profile.filenameFormat, templatePath: profile.unsupportedTemplate };
    const { outcome } = await new DailyNoteResolver(() => NOW).open(vault, { year: 2000, month: 1, day: 5 }, settings);
    expect(outcome).toMatchObject({ kind: 'template-error', error: { code: 'execution-tag' } });
    expect(vault.createCalls).toEqual([]);
  });

  test('a missing day with the supported template is created from the documented example', async () => {
    const vault = referenceVault();
    const settings = { folder: profile.dailyNotesFolder, filenameFormat: profile.filenameFormat, templatePath: profile.supportedTemplate };
    const clock = () => ({ year: 2000, month: 1, day: 5, hour: 9, minute: 30, second: 0 });
    const { outcome } = await new DailyNoteResolver(clock).open(vault, { year: 2000, month: 1, day: 4 }, settings);
    expect(outcome).toEqual({ kind: 'open', path: 'Daily/2000-01-04.md', created: true });
    expect(vault.files.get('Daily/2000-01-04.md')).toStartWith('# 2000-01-04\n\nCreated: 2000-01-05 09:30\n');
  });
});

describe('repeated and superseded requests', () => {
  test('two rapid taps on the same day create one file; only the latest is current', async () => {
    const { vault, open } = setup();
    const gate = deferred();
    vault.beforeState = () => gate.promise;
    const first = open();
    const second = open();
    gate.release();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.current)).toEqual([false, true]);
    expect(results.map((result) => result.outcome)).toEqual([
      { kind: 'open', path: 'Daily/2026-10-08.md', created: true },
      { kind: 'open', path: 'Daily/2026-10-08.md', created: true },
    ]);
    expect(vault.createCalls).toEqual(['Daily/2026-10-08.md']);
    expect(vault.stateCalls).toEqual(['Daily/2026-10-08.md']);
  });

  test('selecting another day before creation cancels the first without creating it', async () => {
    const { vault, open } = setup();
    const gate = deferred();
    vault.beforeState = (path) => (path === 'Daily/2026-10-07.md' ? gate.promise : undefined);
    const first = open(YESTERDAY);
    const second = open(TODAY);
    expect(await second).toEqual({ outcome: { kind: 'open', path: 'Daily/2026-10-08.md', created: true }, current: true });
    gate.release();
    expect(await first).toEqual({ outcome: { kind: 'cancelled', path: 'Daily/2026-10-07.md' }, current: false });
    expect(vault.createCalls).toEqual(['Daily/2026-10-08.md']);
  });

  test('returning to the first day before creation joins its request and creates it once', async () => {
    const { vault, open } = setup();
    const gate = deferred();
    vault.beforeState = (path) => (path === 'Daily/2026-10-07.md' ? gate.promise : undefined);
    const first = open(YESTERDAY);
    const second = open(TODAY);
    const third = open(YESTERDAY);
    expect(await second).toEqual({ outcome: { kind: 'cancelled', path: 'Daily/2026-10-08.md' }, current: false });
    gate.release();
    const [a, c] = await Promise.all([first, third]);
    expect([a.current, c.current]).toEqual([false, true]);
    expect(c.outcome).toEqual({ kind: 'open', path: 'Daily/2026-10-07.md', created: true });
    expect(vault.createCalls).toEqual(['Daily/2026-10-07.md']);
    expect(vault.stateCalls).toEqual(['Daily/2026-10-07.md', 'Daily/2026-10-08.md']);
  });

  test('navigating away after the create commits keeps the note but does not take focus', async () => {
    const { vault, resolver, open } = setup();
    const committed = deferred();
    const gate = deferred();
    vault.afterCreate = () => {
      committed.release();
      return gate.promise;
    };
    const request = open();
    await committed.promise;
    resolver.navigateAway();
    gate.release();
    expect(await request).toEqual({ outcome: { kind: 'open', path: 'Daily/2026-10-08.md', created: true }, current: false });
    expect(vault.files.has('Daily/2026-10-08.md')).toBe(true);
  });

  test('navigating away before creation creates nothing', async () => {
    const { vault, resolver, open } = setup();
    const gate = deferred();
    vault.beforeState = () => gate.promise;
    const request = open();
    resolver.navigateAway();
    gate.release();
    expect(await request).toEqual({ outcome: { kind: 'cancelled', path: 'Daily/2026-10-08.md' }, current: false });
    expect(vault.createCalls).toEqual([]);
  });

  test('the same path in two vaults is resolved separately', async () => {
    const resolver = new DailyNoteResolver(() => NOW);
    const a = new FakeVault('vault-a');
    const b = new FakeVault('vault-b');
    a.files.set('Daily/2026-10-08.md', 'A');
    const [inA, inB] = await Promise.all([
      resolver.open(a, TODAY, DEFAULT_DAILY_NOTE_SETTINGS),
      resolver.open(b, TODAY, DEFAULT_DAILY_NOTE_SETTINGS),
    ]);
    expect(inA).toEqual({ outcome: { kind: 'open', path: 'Daily/2026-10-08.md', created: false }, current: false });
    expect(inB).toEqual({ outcome: { kind: 'open', path: 'Daily/2026-10-08.md', created: true }, current: true });
    expect(b.files.get('Daily/2026-10-08.md')).toBe('# 2026-10-08\n\nCreated 2026-10-08 00:15\n\n');
    expect(a.files.get('Daily/2026-10-08.md')).toBe('A');
  });

  test('a finished request can be repeated and finds the existing note', async () => {
    const { vault, open } = setup();
    await open();
    expect((await open()).outcome).toEqual({ kind: 'open', path: 'Daily/2026-10-08.md', created: false });
    expect(vault.createCalls).toEqual(['Daily/2026-10-08.md']);
  });
});
