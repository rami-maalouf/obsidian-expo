/**
 * profiles the javascript side of a returning launch over a generated vault: the explorer
 * listing, the bookmark check, and the search index. it counts calls into the native vault
 * module and into sqlite, the rows sqlite writes, and the data passed to javascript, and times
 * each stage on this machine.
 *
 *   bun scripts/profile-launch.ts [--count 3000]
 *
 * the counts are the same on an iphone; the times are this machine's, not an iphone's. native
 * work (enumerating the folder, coordinated reads) is outside this profile.
 */
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { followMoves } from '../src/features/bookmarks/bookmarks';
import { ancestorFolders, buildTree, flattenTree } from '../src/features/explorer/tree';
import { type IndexSource, SearchIndex } from '../src/features/search/search-index';
import type { SqlDatabase } from '../src/features/search/sql';
import type { NativeNote, NativeReadResult } from '../modules/vault/src';
import { bunSqlDatabase } from '../tests/support/bun-sql';
import { generateVault } from './generate-vault';

type Counts = Record<string, number>;

/** a vault in memory with native-like listing and read results, counting every call. */
function fakeVault(count: number) {
  const decoder = new TextDecoder();
  const files = new Map<string, { text: string; modified: number; fileId: string }>();
  let inode = 1;
  for (const file of generateVault({ count })) {
    files.set(file.path, { text: decoder.decode(file.data), modified: 1_700_000_000_000 + inode * 1000, fileId: `1:${inode++}` });
  }
  const counts: Counts = { listNotes: 0, listedNotes: 0, listingBytes: 0, readText: 0, readBytes: 0 };
  const listNotes = async () => {
    const notes: NativeNote[] = [...files].map(([path, file]) => ({
      path,
      placeholder: false,
      size: file.text.length,
      modified: file.modified,
      fileId: file.fileId,
    }));
    counts.listNotes++;
    counts.listedNotes += notes.length;
    counts.listingBytes += JSON.stringify(notes).length;
    return { notes, unreadableFolders: [] as string[] };
  };
  const readText = async (path: string): Promise<NativeReadResult> => {
    counts.readText++;
    const file = files.get(path);
    if (!file) return { kind: 'unavailable', state: { kind: 'absent' } };
    counts.readBytes += file.text.length;
    return { kind: 'text', text: file.text, bom: false, revision: { sha256: path, size: file.text.length } };
  };
  return { files, counts, source: { listNotes, readText } satisfies IndexSource };
}

/** wraps the sqlite adapter to count calls and changed rows. */
function countingDatabase(db: SqlDatabase, counts: Counts): SqlDatabase {
  const bump = (key: string, by = 1) => {
    counts[key] = (counts[key] ?? 0) + by;
  };
  return {
    async execAsync(source) {
      bump('sqlCalls');
      return db.execAsync(source);
    },
    async runAsync(source, params) {
      bump('sqlCalls');
      const result = await db.runAsync(source, params);
      bump('rowsChanged', result.changes);
      return result;
    },
    async getAllAsync<T>(source: string, params: (string | number | null)[]) {
      bump('sqlCalls');
      const rows = await db.getAllAsync<T>(source, params);
      bump('rowsReturned', rows.length);
      return rows;
    },
    async getFirstAsync<T>(source: string, params: (string | number | null)[]) {
      bump('sqlCalls');
      return db.getFirstAsync<T>(source, params);
    },
    async withTransactionAsync(task) {
      bump('transactions');
      return db.withTransactionAsync(task);
    },
  };
}

async function time<T>(stages: Record<string, number>, name: string, task: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const result = await task();
  stages[name] = Number((performance.now() - start).toFixed(1));
  return result;
}

/** the launch work after the first note shows, in the app's order (workspace.tsx, use-search-index.ts). */
async function launch(vault: ReturnType<typeof fakeVault>, dbFile: string, openNote: string) {
  const stages: Record<string, number> = {};
  const sql: Counts = {};
  const before = { ...vault.counts };
  const raw = new Database(dbFile);
  raw.exec('PRAGMA journal_mode = WAL');
  const db = countingDatabase(bunSqlDatabase(raw), sql);

  // explorer: the listing, the tree with the open note's folders expanded, and the path set.
  const listedAt = Date.now();
  const listing = await time(stages, 'explorer listing', () => vault.source.listNotes());
  await time(stages, 'explorer tree and rows', () => flattenTree(buildTree(listing.notes), new Set(ancestorFolders(openNote))));
  await time(stages, 'path set and bookmarks', () => {
    // workspace.tsx builds one set of every path; the sidebar and calendar share it.
    new Set(listing.notes.map((note) => note.path));
    const items = [...vault.files.keys()].slice(0, 5).map((path) => ({ path, addedAt: 0 }));
    followMoves({ version: 1, items }, listing.notes);
  });

  // search index (use-search-index.ts): open, publish coverage, discover from the explorer's
  // listing, publish, index contents, publish. the workspace refreshes the open note.
  const index = await time(stages, 'index open', () => SearchIndex.open(db, vault.source, { pause: () => Promise.resolve() }));
  await time(stages, 'index coverage x3', async () => {
    await index.coverage();
    await index.coverage();
    await index.coverage();
  });
  await time(stages, 'index refresh open note', () => index.refresh(openNote));
  const sqlBeforeDiscover = { ...sql };
  await time(stages, 'index discover', () => index.discover({ listing, listedAt }));
  const discoverSql = {
    calls: (sql.sqlCalls ?? 0) - (sqlBeforeDiscover.sqlCalls ?? 0),
    rowsChanged: (sql.rowsChanged ?? 0) - (sqlBeforeDiscover.rowsChanged ?? 0),
  };
  const indexed = await time(stages, 'index contents', () => index.indexContents());
  raw.close();

  const native: Counts = {};
  for (const key of Object.keys(vault.counts)) native[key] = vault.counts[key] - before[key];
  return { stages, discoverSql, notesReadForIndex: indexed, native, sql };
}

async function main() {
  const { values } = parseArgs({ options: { count: { type: 'string', default: '3000' } } });
  const count = Number(values.count);
  const vault = fakeVault(count);
  const openNote = [...vault.files.keys()][0];
  const directory = mkdtempSync(join(tmpdir(), 'launch-profile-'));
  try {
    const dbFile = join(directory, 'index.db');
    const first = await launch(vault, dbFile, openNote);
    const unchanged = await launch(vault, dbFile, openNote);
    // a typical day between launches: a few notes edited, one added, one deleted.
    const paths = [...vault.files.keys()];
    for (const path of paths.slice(10, 15)) {
      const file = vault.files.get(path);
      if (file) file.modified += 60_000;
    }
    vault.files.delete(paths[20]);
    vault.files.set('Inbox/New idea.md', { text: '# New idea\n', modified: 1_800_000_000_000, fileId: '1:999999' });
    const edited = await launch(vault, dbFile, openNote);
    console.log(
      JSON.stringify(
        {
          environment: `${process.platform} ${process.arch}, bun ${Bun.version}`,
          notes: count,
          firstLaunch: first,
          relaunchUnchanged: unchanged,
          relaunchAfterEdits: edited,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await main();
