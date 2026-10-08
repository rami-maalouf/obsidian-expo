/**
 * preliminary search benchmark over the generated 10,000-note vault, using bun:sqlite.
 *
 *   bun scripts/benchmark-search.ts [--count 10000] [--queries 100]
 *
 * this measures the index and query logic on the host machine. it does not qualify the app's
 * performance targets, which need a release build on a physical iphone (verification contract).
 */
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { type IndexSource, SearchIndex } from '../src/features/search/search-index';
import type { NativeNote, NativeReadResult } from '../modules/vault/src';
import { bunSqlDatabase } from '../tests/support/bun-sql';
import { createRandom, generateVault } from './generate-vault';

const QUERY_WORDS = ['harbor', 'river signal', 'quartz', 'café', 'journal', 'index', 'zenith ember', 'pattern', '日本語', 'tide'];

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const { values } = parseArgs({
    options: { count: { type: 'string', default: '10000' }, queries: { type: 'string', default: '100' } },
  });
  const count = Number(values.count);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  let bytes = 0;
  for (const file of generateVault({ count })) {
    files.set(file.path, decoder.decode(file.data));
    bytes += file.data.byteLength;
  }
  const source: IndexSource = {
    async listNotes() {
      const notes: NativeNote[] = [...files.keys()].map((path) => ({ path, placeholder: false, modified: 1 }));
      return { notes, unreadableFolders: [] };
    },
    async readText(path): Promise<NativeReadResult> {
      const text = files.get(path) ?? '';
      return { kind: 'text', text, bom: false, revision: { sha256: path, size: text.length } };
    },
  };

  const directory = mkdtempSync(join(tmpdir(), 'search-benchmark-'));
  try {
    const db = new Database(join(directory, 'index.db'));
    db.exec('PRAGMA journal_mode = WAL');
    const index = await SearchIndex.open(bunSqlDatabase(db), source, { pause: () => Promise.resolve() });

    let start = performance.now();
    await index.discover();
    const discoverMs = performance.now() - start;
    start = performance.now();
    await index.indexContents();
    const indexMs = performance.now() - start;

    const random = createRandom(7);
    const timings: number[] = [];
    const queryCount = Number(values.queries);
    for (let i = 0; i < queryCount; i++) {
      const query = QUERY_WORDS[i % QUERY_WORDS.length] + (random.next() < 0.3 ? ` ${random.int(0, 199)}` : '');
      const t0 = performance.now();
      await index.search(query, 50);
      timings.push(performance.now() - t0);
    }
    timings.sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
          environment: `${process.platform} ${process.arch}, bun ${Bun.version}, sqlite ${(db.query('select sqlite_version() as v').get() as { v: string }).v}`,
          notes: count,
          bytes,
          discoverMs: Math.round(discoverMs),
          indexMs: Math.round(indexMs),
          queries: queryCount,
          queryP50Ms: Number(percentile(timings, 50).toFixed(2)),
          queryP95Ms: Number(percentile(timings, 95).toFixed(2)),
          coverage: await index.coverage(),
        },
        null,
        2,
      ),
    );
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await main();
