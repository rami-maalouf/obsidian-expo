/**
 * daily-note protocol: open a day's existing note, or create it once from the template.
 *
 * - an existing note opens unchanged; its template is never read again (R10, R14).
 * - cloud placeholders and uncertain states never lead to creation (R4).
 * - the whole template is validated before any mutation (R13).
 * - requests are deduplicated per vault and path, and only the latest navigation is
 *   "current", so late completions cannot take focus (R15).
 */
import { captureClock, type CivilDate, type CivilDateTime } from '@/features/templates/civil-time';
import { BUILT_IN_TEMPLATE, expandTemplate, type TemplateError } from '@/features/templates/template';

import { dailyNoteTarget, type DailyNoteSettings, type DailyNoteTarget } from './settings';

export type FileState =
  | { kind: 'readable' }
  /** exists in iCloud but is not downloaded. it is never treated as absent. */
  | { kind: 'placeholder' }
  /** positively confirmed not to exist. */
  | { kind: 'absent' }
  /** permission, availability, or identity could not be established. */
  | { kind: 'unknown'; reason: string };

export type ReadTextResult =
  | { kind: 'text'; text: string }
  | { kind: 'unavailable'; state: Exclude<FileState, { kind: 'readable' }> }
  | { kind: 'unsupported-encoding' };

export type CreateResult = { kind: 'created' } | { kind: 'exists' } | { kind: 'failed'; reason: string };

/** the part of the native vault service that daily notes need. paths are vault-relative. */
export interface DailyNoteVault {
  readonly vaultId: string;
  fileState(path: string): Promise<FileState>;
  readText(path: string): Promise<ReadTextResult>;
  /** coordinated exclusive create, including missing parent folders. never replaces a file. */
  createExclusive(path: string, text: string): Promise<CreateResult>;
}

export type DailyNoteOutcome =
  | { kind: 'open'; path: string; created: boolean }
  | { kind: 'unavailable'; path: string; state: 'placeholder' | 'unknown'; reason?: string }
  | { kind: 'template-error'; path: string; error: TemplateError }
  | { kind: 'template-unavailable'; path: string; templatePath: string; reason: string }
  /** navigation moved elsewhere before creation started; nothing was created. */
  | { kind: 'cancelled'; path: string }
  | { kind: 'failed'; path: string; reason: string };

export type DailyNoteResult = {
  outcome: DailyNoteOutcome;
  /** false when a later navigation replaced this request; the UI must not take focus. */
  current: boolean;
};

const MAX_ATTEMPTS = 2;

function templateUnavailableReason(templatePath: string, result: Exclude<ReadTextResult, { kind: 'text' }>) {
  if (result.kind === 'unsupported-encoding') {
    return `The template ${templatePath} is not UTF-8 text.`;
  }
  switch (result.state.kind) {
    case 'absent':
      return `No template exists at ${templatePath}.`;
    case 'placeholder':
      return `The template ${templatePath} is in iCloud and has not downloaded yet.`;
    case 'unknown':
      return `The template ${templatePath} could not be read: ${result.state.reason}`;
  }
}

export class DailyNoteResolver {
  private generation = 0;
  private currentKey: string | null = null;
  private readonly inFlight = new Map<string, Promise<DailyNoteOutcome>>();

  constructor(private readonly clock: () => CivilDateTime = captureClock) {}

  /** call when the user navigates to anything other than a daily note. */
  navigateAway(): void {
    this.generation++;
    this.currentKey = null;
  }

  async open(vault: DailyNoteVault, date: CivilDate, settings: DailyNoteSettings): Promise<DailyNoteResult> {
    const target = dailyNoteTarget(date, settings);
    const key = `${vault.vaultId}\u0000${target.path}`;
    const generation = ++this.generation;
    this.currentKey = key;
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.resolve(vault, target, settings, key).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    const outcome = await pending;
    return { outcome, current: this.generation === generation };
  }

  private async resolve(
    vault: DailyNoteVault,
    target: DailyNoteTarget,
    settings: DailyNoteSettings,
    key: string,
  ): Promise<DailyNoteOutcome> {
    const { path } = target;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const state = await vault.fileState(path);
      if (state.kind === 'readable') {
        return { kind: 'open', path, created: false };
      }
      if (state.kind === 'placeholder') {
        return { kind: 'unavailable', path, state: 'placeholder' };
      }
      if (state.kind === 'unknown') {
        return { kind: 'unavailable', path, state: 'unknown', reason: state.reason };
      }

      const content = await this.render(vault, target, settings);
      if (typeof content !== 'string') {
        return content;
      }
      if (this.currentKey !== key) {
        return { kind: 'cancelled', path };
      }
      const created = await vault.createExclusive(path, content);
      if (created.kind === 'created') {
        return { kind: 'open', path, created: true };
      }
      if (created.kind === 'failed') {
        return { kind: 'failed', path, reason: created.reason };
      }
      // another writer created the note first: resolve the canonical path again and open it.
    }
    return { kind: 'failed', path, reason: 'The note changed repeatedly while opening it. Try again.' };
  }

  private async render(
    vault: DailyNoteVault,
    target: DailyNoteTarget,
    settings: DailyNoteSettings,
  ): Promise<string | DailyNoteOutcome> {
    let source = BUILT_IN_TEMPLATE;
    if (settings.templatePath !== null) {
      const read = await vault.readText(settings.templatePath);
      if (read.kind !== 'text') {
        const reason = templateUnavailableReason(settings.templatePath, read);
        return { kind: 'template-unavailable', path: target.path, templatePath: settings.templatePath, reason };
      }
      source = read.text;
    }
    // KTD6: capture the clock once per expansion.
    const expanded = expandTemplate(source, { title: target.title, now: this.clock() });
    return expanded.ok ? expanded.value : { kind: 'template-error', path: target.path, error: expanded.error };
  }
}
