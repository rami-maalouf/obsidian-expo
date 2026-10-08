/**
 * generates a reproducible synthetic Markdown vault for search, explorer, and performance work.
 *
 *   bun scripts/generate-vault.ts --out /tmp/vault-10k
 *   bun scripts/generate-vault.ts --out /tmp/vault-10k --stress
 *
 * the same seed and count always produce the same bytes. output must go to a new or empty
 * directory outside version control; inside this repository only `.fixtures/` is allowed.
 * a manifest with every file's size and SHA-256 is written next to the vault.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import {
  manifestEntry,
  manifestFromEntries,
  manifestPathFor,
  serializeManifest,
  type VaultManifest,
} from './vault-manifest';

export const GENERATOR_VERSION = 1;
export const DEFAULT_SEED = 1;
export const DEFAULT_COUNT = 10_000;
export const MIN_NOTE_BYTES = 2 * 1024;
export const MAX_NOTE_BYTES = 8 * 1024;
export const DAILY_NOTE_COUNT = 730;
/** the last generated daily note; earlier ones go back one day at a time. */
export const LAST_DAILY_DATE = { year: 2026, month: 10, day: 8 };
export const STRESS_NOTES = [
  { path: 'Stress/Long 100 KiB.md', bytes: 100 * 1024 },
  { path: 'Stress/Long 1 MiB.md', bytes: 1024 * 1024 },
] as const;

export type GeneratedFile = { path: string; data: Uint8Array };

export type GenerateOptions = { seed?: number; count?: number; stress?: boolean };

const WORDS = [
  'archive', 'balance', 'canvas', 'delta', 'ember', 'field', 'garden', 'harbor', 'index', 'journal',
  'kernel', 'ledger', 'meadow', 'north', 'orbit', 'pattern', 'quartz', 'river', 'signal', 'timber',
  'update', 'vector', 'window', 'yield', 'zenith', 'anchor', 'bridge', 'cobalt', 'drift', 'echo',
  'focus', 'granite', 'horizon', 'island', 'jasper', 'kettle', 'lantern', 'marble', 'nectar', 'olive',
  'pebble', 'quiet', 'ripple', 'summit', 'tide', 'umber', 'valley', 'willow', 'xylem', 'yarrow',
];
const UNICODE_WORDS = [
  'café', 'naïve', 'Zürich', 'mañana', 'café', '日本語', '中文', '한국어', 'Ελληνικά', 'Русский',
  'مرحبا', 'שלום', 'नमस्ते', '👩‍💻', '✨', '𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
];
const AREA_COUNT = 40;
const TOPICS_PER_AREA = 5;
const encoder = new TextEncoder();

/** mulberry32: small, fast, and identical on every JavaScript engine. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

type Random = ReturnType<typeof createRandom>;

function pad(value: number, width: number) {
  return String(value).padStart(width, '0');
}

function dailyName(index: number) {
  const date = new Date(Date.UTC(LAST_DAILY_DATE.year, LAST_DAILY_DATE.month - 1, LAST_DAILY_DATE.day - index));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

function word(random: Random) {
  return random.next() < 0.04 ? random.pick(UNICODE_WORDS) : random.pick(WORDS);
}

/** appends Markdown blocks until the body reaches `targetBytes`. */
function body(random: Random, targetBytes: number, linkTargets: readonly string[]) {
  const parts: string[] = [];
  let bytes = 0;
  const push = (text: string) => {
    parts.push(text);
    bytes += encoder.encode(text).byteLength;
  };
  while (bytes < targetBytes) {
    const kind = random.next();
    if (kind < 0.08) {
      push(`## ${word(random)} ${word(random)}\n\n`);
    } else if (kind < 0.16) {
      const done = random.next() < 0.5 ? 'x' : ' ';
      push(`- [${done}] ${word(random)} ${word(random)} ${word(random)}\n\n`);
    } else if (kind < 0.19) {
      push(`\`\`\`js\nconst ${random.pick(WORDS)} = ${random.int(0, 999)};\n\`\`\`\n\n`);
    } else {
      const sentence: string[] = [];
      const length = random.int(8, 40);
      for (let i = 0; i < length; i++) {
        const roll = random.next();
        if (roll < 0.03 && linkTargets.length > 0) {
          sentence.push(`[[${random.pick(linkTargets)}]]`);
        } else if (roll < 0.04) {
          sentence.push(`#${random.pick(WORDS)}`);
        } else {
          sentence.push(word(random));
        }
      }
      push(`${sentence.join(' ')}.\n\n`);
    }
  }
  return parts.join('');
}

function note(random: Random, title: string, created: string, targetBytes: number, links: readonly string[]) {
  const head = `---\ncreated: ${created}\ntags: [${random.pick(WORDS)}, generated]\n---\n\n# ${title}\n\n`;
  return head + body(random, targetBytes - encoder.encode(head).byteLength, links);
}

/**
 * yields the vault's files in a fixed order. notes are 2-8 KiB of UTF-8 Markdown with
 * frontmatter, headings, tasks, code, tags, wikilinks, and some non-ASCII words. the vault
 * includes daily notes, deep folders, and basenames repeated across folders.
 */
export function* generateVault(options: GenerateOptions = {}): Generator<GeneratedFile> {
  const seed = options.seed ?? DEFAULT_SEED;
  const count = options.count ?? DEFAULT_COUNT;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('count must be a positive integer');
  }
  const random = createRandom(seed);
  const titles: string[] = [];
  const usedPaths = new Set<string>();
  // the last block can overshoot the target by about 1.3 KiB; leave room so notes stay in range.
  const sizeTarget = () => random.int(MIN_NOTE_BYTES, MAX_NOTE_BYTES - 1536);
  const dailyCount = Math.min(DAILY_NOTE_COUNT, Math.floor(count / 10));

  for (let index = 0; index < count; index++) {
    let path: string;
    let title: string;
    if (index < dailyCount) {
      title = dailyName(index);
      path = `Daily/${title}.md`;
    } else {
      const area = random.int(0, AREA_COUNT - 1);
      const topic = random.int(0, TOPICS_PER_AREA - 1);
      const deep = random.next() < 0.05 ? '/Deep/Deeper/Deepest' : '';
      const folder = `Areas/Area ${pad(area, 2)}/Topic ${topic}${deep}`;
      // a small name space makes the same basename appear in many folders.
      title = `${random.pick(WORDS)} ${random.int(0, 199)}`;
      path = `${folder}/${title}.md`;
      if (usedPaths.has(path)) {
        title = `${title} (${index})`;
        path = `${folder}/${title}.md`;
      }
    }
    usedPaths.add(path);
    const created = `${dailyName(index % 365)} ${pad(random.int(0, 23), 2)}:${pad(random.int(0, 59), 2)}`;
    const text = note(random, title, created, sizeTarget(), titles.slice(-200));
    titles.push(title);
    yield { path, data: encoder.encode(text) };
  }

  if (options.stress) {
    for (const stress of STRESS_NOTES) {
      const title = stress.path.slice(stress.path.lastIndexOf('/') + 1, -'.md'.length);
      yield { path: stress.path, data: encoder.encode(note(random, title, `${dailyName(0)} 00:00`, stress.bytes, titles.slice(-200))) };
    }
  }
}

export function manifestForVault(options: GenerateOptions = {}): VaultManifest {
  const entries = [];
  for (const file of generateVault(options)) {
    entries.push(manifestEntry(file.path, file.data));
  }
  return manifestFromEntries(entries);
}

function isInside(parent: string, child: string) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function assertDisposableTarget(outDir: string) {
  const repoRoot = resolve(import.meta.dir, '..');
  const fixturesRoot = join(repoRoot, '.fixtures');
  const target = resolve(outDir);
  if (isInside(repoRoot, target) && (target === fixturesRoot || !isInside(fixturesRoot, target))) {
    throw new Error(`Refusing to write inside the repository outside .fixtures/: ${target}`);
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`Refusing to write into a non-empty directory: ${target}`);
  }
}

export function writeVault(outDir: string, options: GenerateOptions = {}): VaultManifest {
  assertDisposableTarget(outDir);
  const entries = [];
  for (const file of generateVault(options)) {
    const full = join(outDir, ...file.path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.data, { flag: 'wx' });
    entries.push(manifestEntry(file.path, file.data));
  }
  const manifest = manifestFromEntries(entries);
  writeFileSync(manifestPathFor(outDir), serializeManifest(manifest));
  return manifest;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      seed: { type: 'string', default: String(DEFAULT_SEED) },
      count: { type: 'string', default: String(DEFAULT_COUNT) },
      stress: { type: 'boolean', default: false },
    },
  });
  if (!values.out) {
    console.error('Usage: bun scripts/generate-vault.ts --out <empty-dir> [--seed 1] [--count 10000] [--stress]');
    process.exit(2);
  }
  const options = { seed: Number(values.seed), count: Number(values.count), stress: values.stress };
  const manifest = writeVault(values.out, options);
  console.log(
    JSON.stringify({
      out: resolve(values.out),
      manifest: manifestPathFor(values.out),
      generatorVersion: GENERATOR_VERSION,
      ...options,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      digest: manifest.digest,
    }),
  );
}
