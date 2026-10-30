import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, release, tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import type { NativeNote, NativeReadResult } from '../modules/vault/src';
import { FILE_SORT_GROUPS } from '../src/features/explorer/file-sort';
import { ancestorFolders, buildTree, flattenTree } from '../src/features/explorer/tree';
import { type IndexSource, SearchIndex } from '../src/features/search/search-index';
import { bunSqlDatabase } from '../tests/support/bun-sql';
import { type BenchmarkReport, compareReports, REPORT_FORMAT, summarize } from './benchmark-report';
import { createRandom, generateVault } from './generate-vault';
import { manifestFromEntries, sha256 } from './vault-manifest';

const ROOT = join(import.meta.dir, '..');
const QUERY_WORDS = ['harbor', 'river signal', 'quartz', 'café', 'journal', 'index', 'zenith ember', 'pattern', '日本語', 'tide'];
const DEFAULTS = { count: 10_000, seed: 1, queries: 100, repeats: 5, warmups: 1, stress: false };
type Options = typeof DEFAULTS;
type File = { text: string; bytes: number; digest: string; modified: number; created: number };

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function filesDigest(paths: string[]) {
  const hash = createHash('sha256');
  for (const path of paths.sort()) {
    const fullPath = join(ROOT, path);
    hash.update(path).update('\0').update(existsSync(fullPath) ? readFileSync(fullPath) : 'deleted').update('\0');
  }
  return hash.digest('hex');
}

function makeFile(text: string, modified: number, created = modified): File {
  return { text, modified, created, bytes: Buffer.byteLength(text), digest: sha256(text) };
}

export async function runBenchmark(input: Partial<Options> = {}): Promise<BenchmarkReport> {
  const options = { ...DEFAULTS, ...input };
  for (const name of ['count', 'seed', 'queries', 'repeats', 'warmups'] as const) {
    const minimum = name === 'count' ? 3 : name === 'seed' || name === 'warmups' ? 0 : 1;
    if (!Number.isSafeInteger(options[name]) || options[name] < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  const original = new Map<string, File>();
  const decoder = new TextDecoder();
  const epoch = Date.UTC(2026, 0, 1);
  for (const file of generateVault(options)) {
    const index = original.size;
    const modified = epoch + (index % 2 === 0 ? index : -index) * 1000;
    original.set(file.path, makeFile(decoder.decode(file.data), modified, epoch - index * 1000));
  }
  const paths = [...original.keys()];
  for (const [path, marker] of [[paths[1], 'benchmarkrenamed'], [paths[2], 'benchmarkremoved0end']]) {
    const file = original.get(path)!;
    original.set(path, makeFile(`${file.text}\n${marker}`, file.modified, file.created));
  }
  const manifest = manifestFromEntries([...original].map(([path, file]) => ({ path, bytes: file.bytes, sha256: file.digest })));
  const mutatedPaths = paths.slice(0, 3);
  const random = createRandom(7);
  const queries = Array.from({ length: options.queries }, (_, i) => QUERY_WORDS[i % QUERY_WORDS.length] + (random.next() < 0.3 ? ` ${random.int(0, 199)}` : ''));
  const samplesMs: Record<string, number[]> = {};
  const directory = mkdtempSync(join(tmpdir(), 'vault-benchmark-'));
  let correctness: BenchmarkReport['correctness'] | undefined;
  let sqlite = '';
  try {
    for (let round = -options.warmups; round < options.repeats; round++) {
      const files = new Map(original);
      let reads = 0;
      const source: IndexSource = {
        async listNotes() {
          const notes: NativeNote[] = [...files].map(([path, file]) => ({ path, size: file.bytes, modified: file.modified, created: file.created, placeholder: false }));
          return { notes, unreadableFolders: [] };
        },
        async readText(path): Promise<NativeReadResult> {
          reads++;
          const file = files.get(path);
          if (!file) return { kind: 'unavailable', state: { kind: 'absent' } };
          return { kind: 'text', text: file.text, bom: false, revision: { sha256: file.digest, size: file.bytes } };
        },
      };
      const measured = async <T>(name: string, work: () => T | Promise<T>) => {
        const start = performance.now();
        const result = await work();
        const elapsed = performance.now() - start;
        if (round >= 0) (samplesMs[name] ??= []).push(elapsed);
        return result;
      };
      const results = createHash('sha256');
      const record = (value: unknown) => results.update(JSON.stringify(value)).update('\n');
      const dbPath = join(directory, `round-${round}.db`);
      const db = new Database(dbPath);
      try {
        db.exec('PRAGMA journal_mode = WAL');
        sqlite = (db.query('select sqlite_version() as v').get() as { v: string }).v;
        const index = await measured('schemaOpen', () => SearchIndex.open(bunSqlDatabase(db), source, { pause: () => Promise.resolve() }));
        await measured('discoverFresh', () => index.discover());
        await measured('indexFresh', () => index.indexContents());
        const coverage = await index.coverage();
        assert.deepEqual(coverage, { total: files.size, indexed: files.size, pending: 0, placeholders: 0, unreadableFolders: [] });

        const beforeReads = reads;
        await measured('discoverUnchanged', async () => { await index.discover(); await index.indexContents(); });
        const unchangedReads = reads - beforeReads;
        assert.equal(unchangedReads, 0, 'unchanged discovery must not reread note content');

        for (const query of QUERY_WORDS) await index.search(query, 50);
        for (const query of queries) {
          const result = await measured('queryWarm', () => index.search(query, 50));
          assert.equal(result.complete, true);
          assert.equal(new Set(result.hits.map((hit) => hit.path)).size, result.hits.length);
          assert.ok(result.hits.every((hit) => files.has(hit.path)));
          record(result);
        }

        const listing = await source.listNotes();
        const expanded = new Set(listing.notes.flatMap((note) => ancestorFolders(note.path)));
        const tree = await measured('explorerBuild', () => buildTree(listing.notes));
        const chronologicalOrders: Record<string, string[]> = {};
        for (const { value: sort } of FILE_SORT_GROUPS.flatMap((group) => group.options)) {
          const rows = await measured(`explorerSort:${sort}`, () => flattenTree(tree, expanded, sort));
          const notePaths = rows.filter((row) => row.kind === 'note').map((row) => row.path);
          assert.deepEqual(new Set(notePaths), new Set(files.keys()), 'expanded explorer must include every note');
          assert.equal(notePaths.length, files.size);
          const field = sort.startsWith('modified') ? 'modified' : sort.startsWith('created') ? 'created' : undefined;
          if (field) {
            const previousByFolder = new Map<string, number>();
            for (const path of notePaths) {
              const time: number = files.get(path)![field];
              assert.equal(typeof time, 'number', `${field} fixtures need timestamps`);
              const folder = dirname(path);
              const previous = previousByFolder.get(folder);
              if (previous !== undefined) {
                assert.ok(sort.endsWith('asc') ? time >= previous : time <= previous, `${sort} must order sibling notes by time`);
              }
              previousByFolder.set(folder, time);
            }
            chronologicalOrders[sort] = notePaths;
          }
          record(rows);
        }
        if (new Set(paths.map((path) => dirname(path))).size < paths.length) {
          for (const field of ['modified', 'created']) {
            assert.notDeepEqual(chronologicalOrders[`${field}-asc`], chronologicalOrders[`${field}-desc`], `${field} fixtures must exercise both directions`);
          }
        }

        let renamedPath = paths[1];
        let replacedPath = paths[2];
        const matching = async (index: SearchIndex, query: string) => (await index.search(query)).hits.map((hit) => hit.path);
        for (let cycle = 0; cycle < (options.stress ? 20 : 1); cycle++) {
          const editedFile = original.get(paths[0])!;
          files.set(paths[0], makeFile(`${editedFile.text}\nbenchmarkupdated${cycle}end`, editedFile.modified + (cycle + 1) * 1000, editedFile.created));
          const renamed = files.get(renamedPath)!;
          files.delete(renamedPath);
          renamedPath = `Benchmark/Renamed ${cycle}.md`;
          files.set(renamedPath, renamed);
          files.delete(replacedPath);
          replacedPath = `Benchmark/Created ${cycle}.md`;
          files.set(replacedPath, makeFile(`benchmarkremoved${cycle + 1}end`, cycle + 2));
          await measured('reconcileChanges', async () => { await index.discover(); await index.indexContents(); });
          const edited = await matching(index, `benchmarkupdated${cycle}end`);
          const renamedHits = await matching(index, 'benchmarkrenamed');
          const removed = await matching(index, `benchmarkremoved${cycle}end`);
          assert.deepEqual(edited, [paths[0]]);
          assert.deepEqual(renamedHits, [renamedPath]);
          assert.deepEqual(removed, []);
          assert.deepEqual(await matching(index, `benchmarkremoved${cycle + 1}end`), [replacedPath]);
          if (cycle > 0) assert.deepEqual(await matching(index, `benchmarkupdated${cycle - 1}end`), []);
          const current = await index.coverage();
          assert.deepEqual(current, coverage);
          record({ edited, renamedHits, removed, current });
        }
        for (const [path, file] of original) {
          if (!mutatedPaths.includes(path)) assert.equal(files.get(path), file, 'untouched fixtures must remain unchanged');
        }
        const actual = { resultDigest: results.digest('hex'), coverage, unchangedReads };
        if (correctness) assert.deepEqual(actual, correctness, 'results changed between identical rounds');
        correctness = actual;
      } finally {
        db.close();
        rmSync(dbPath, { force: true });
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const cpu = cpus();
  const intl = new Intl.DateTimeFormat().resolvedOptions();
  return {
    format: REPORT_FORMAT,
    capturedAt: new Date().toISOString(),
    measurement: 'host-bun-sqlite',
    revision: {
      commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0,
      sourceDigest: filesDigest(git('ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'modules', 'patches', 'app.config.ts', 'app.json').split('\0').filter(Boolean)),
      lockfileDigest: sha256(readFileSync(join(ROOT, 'bun.lock'))),
    },
    dependencies: { expo: packageJson.dependencies.expo, reactNative: packageJson.dependencies['react-native'] },
    environment: {
      platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpu[0]?.model ?? 'unknown',
      cpuCount: cpu.length, totalMemoryBytes: totalmem(), bun: Bun.version, sqlite, locale: intl.locale, timeZone: intl.timeZone,
    },
    workload: { ...options, harnessDigest: filesDigest(['scripts/benchmark-search.ts', 'scripts/benchmark-report.ts', 'scripts/generate-vault.ts', 'scripts/vault-manifest.ts', 'tests/support/bun-sql.ts']) },
    fixture: { notes: manifest.fileCount, bytes: manifest.totalBytes, digest: manifest.digest },
    correctness: correctness!, samplesMs,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      count: { type: 'string' }, seed: { type: 'string' }, queries: { type: 'string' }, repeats: { type: 'string' },
      warmups: { type: 'string' }, stress: { type: 'boolean' }, output: { type: 'string' },
      baseline: { type: 'string' }, candidate: { type: 'string' },
    },
  });
  let result: unknown;
  if (values.baseline || values.candidate) {
    if (!values.baseline || !values.candidate) throw new Error('comparison needs both --baseline and --candidate');
    result = compareReports(JSON.parse(readFileSync(values.baseline, 'utf8')), JSON.parse(readFileSync(values.candidate, 'utf8')));
  } else {
    const options: Partial<Options> = { stress: values.stress ?? false };
    for (const name of ['count', 'seed', 'queries', 'repeats', 'warmups'] as const) {
      if (values[name] !== undefined) options[name] = Number(values[name]);
    }
    const report = await runBenchmark(options);
    result = { ...report, summaryMs: Object.fromEntries(Object.entries(report.samplesMs).map(([name, samples]) => [name, summarize(samples)])) };
  }
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output) {
    mkdirSync(dirname(values.output), { recursive: true });
    writeFileSync(values.output, json, { flag: 'wx' });
    console.log(`wrote ${values.output}`);
  } else console.log(json);
}
