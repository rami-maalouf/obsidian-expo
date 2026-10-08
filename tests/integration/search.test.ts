import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ftsMatch, likeContains, queryTerms, snippetParts } from '@/features/search/query';
import { SCHEMA_VERSION } from '@/features/search/schema';
import { type IndexSource, SearchIndex, SearchSession } from '@/features/search/search-index';

import type { NativeNote, NativeReadResult } from '../../modules/vault/src';
import { generateVault } from '../../scripts/generate-vault';
import { bunSqlDatabase } from '../support/bun-sql';

const FIXTURE = join(import.meta.dir, '../fixtures/vault-basic');
const immediate = () => Promise.resolve();

/** an in-memory vault that mimics the native listing and read results. */
class MemoryVault implements IndexSource {
  files = new Map<string, { text: string | null; modified: number; placeholder?: boolean }>();
  unreadableFolders: string[] = [];
  reads: string[] = [];

  set(path: string, text: string | null, modified = 1, placeholder = false) {
    this.files.set(path, { text, modified, placeholder });
  }

  async listNotes() {
    const notes: NativeNote[] = [...this.files].map(([path, file]) => ({
      path,
      placeholder: file.placeholder ?? false,
      modified: file.modified,
      size: file.text?.length,
    }));
    return { notes, unreadableFolders: this.unreadableFolders };
  }

  async readText(path: string): Promise<NativeReadResult> {
    this.reads.push(path);
    const file = this.files.get(path);
    if (!file) return { kind: 'unavailable', state: { kind: 'absent' } };
    if (file.placeholder) return { kind: 'unavailable', state: { kind: 'placeholder' } };
    if (file.text === null) return { kind: 'read-only', preview: '?', encoding: 'unknown', revision: { sha256: 'x', size: 1 } };
    return { kind: 'text', text: file.text, bom: false, revision: { sha256: `sha-${file.modified}`, size: file.text.length } };
  }
}

async function openIndex(vault: IndexSource, batchSize = 25) {
  return SearchIndex.open(bunSqlDatabase(), vault, { batchSize, discoveryBatchSize: 100, pause: immediate });
}

describe('query helpers', () => {
  test('terms are literal text, never fts syntax', () => {
    expect(queryTerms('  alpha   beta\tgamma ')).toEqual(['alpha', 'beta', 'gamma']);
    expect(ftsMatch(queryTerms('say "hi" OR NOT x*'))).toBe('"say"* """hi"""* "OR"* "NOT"* "x*"*');
    expect(ftsMatch(['--', '()'])).toBeNull();
    expect(likeContains('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  test('snippet markers split into highlighted parts', () => {
    expect(snippetParts('a \u0001match\u0002 b')).toEqual([
      { text: 'a ', highlight: false },
      { text: 'match', highlight: true },
      { text: ' b', highlight: false },
    ]);
  });
});

describe('SearchIndex', () => {
  test('filenames are searchable before any content is read', async () => {
    const vault = new MemoryVault();
    vault.set('Projects/Alpha/Index.md', 'alpha body');
    vault.set('Daily/2026-10-08.md', 'today');
    const index = await openIndex(vault);
    await index.discover();
    expect(vault.reads).toEqual([]);
    const results = await index.search('index');
    expect(results.hits.map((hit) => [hit.path, hit.match])).toEqual([['Projects/Alpha/Index.md', 'name']]);
    expect(results.complete).toBe(false);
    expect(results.coverage).toMatchObject({ total: 2, indexed: 0, pending: 2, placeholders: 0 });
  });

  test('content is indexed in bounded batches, newest first, and ranked after names', async () => {
    const vault = new MemoryVault();
    for (let i = 0; i < 7; i++) vault.set(`Notes/note ${i}.md`, `body ${i} mentions harbor`, i);
    vault.set('Harbor.md', 'a note named harbor', 100);
    const index = await openIndex(vault, 3);
    await index.discover();
    let batches = 0;
    const processed = await index.indexContents(() => batches++ >= 2);
    expect(processed).toBe(6);
    expect(vault.reads.slice(0, 3)).toEqual(['Harbor.md', 'Notes/note 6.md', 'Notes/note 5.md']);
    await index.indexContents();
    const results = await index.search('harbor');
    expect(results.hits[0]).toMatchObject({ path: 'Harbor.md', match: 'name' });
    expect(results.hits.slice(1).every((hit) => hit.match === 'content')).toBe(true);
    expect(results.hits).toHaveLength(8);
    expect(results.complete).toBe(true);
    expect(snippetParts(results.hits[1].snippet ?? '').some((part) => part.highlight && /harbor/i.test(part.text))).toBe(true);
  });

  test('updates, deletes, and renames are reconciled on the next discovery', async () => {
    const vault = new MemoryVault();
    vault.set('A.md', 'apple', 1);
    vault.set('B.md', 'banana', 1);
    const index = await openIndex(vault);
    await index.discover();
    await index.indexContents();
    vault.set('A.md', 'apricot', 2);
    vault.files.delete('B.md');
    vault.set('Renamed.md', 'cherry', 1);
    vault.reads = [];
    expect(await index.discover()).toEqual({ notes: 2, removed: 1 });
    await index.indexContents();
    expect(vault.reads.sort()).toEqual(['A.md', 'Renamed.md']);
    expect((await index.search('apple')).hits).toEqual([]);
    expect((await index.search('apricot')).hits.map((hit) => hit.path)).toEqual(['A.md']);
    expect((await index.search('banana')).hits).toEqual([]);
    expect((await index.search('cherry')).hits.map((hit) => hit.path)).toEqual(['Renamed.md']);
  });

  test('cloud placeholders are found by name and reported as incomplete coverage', async () => {
    const vault = new MemoryVault();
    vault.set('Cloud/Offline idea.md', null, 1, true);
    vault.set('Local.md', 'offline mentioned here', 1);
    const index = await openIndex(vault);
    await index.discover();
    await index.indexContents();
    expect(vault.reads).toEqual(['Local.md']);
    const results = await index.search('offline');
    expect(results.hits.map((hit) => [hit.path, hit.match, hit.placeholder])).toEqual([
      ['Cloud/Offline idea.md', 'name', true],
      ['Local.md', 'content', false],
    ]);
    expect(results.complete).toBe(false);
    expect(results.coverage).toMatchObject({ placeholders: 1, pending: 0 });
  });

  test('notes under an unreadable folder are kept, not deleted', async () => {
    const vault = new MemoryVault();
    vault.set('Locked/secret.md', 'kept', 1);
    const index = await openIndex(vault);
    await index.discover();
    vault.files.delete('Locked/secret.md');
    vault.unreadableFolders = ['Locked'];
    expect((await index.discover()).removed).toBe(0);
    const results = await index.search('secret');
    expect(results.hits.map((hit) => hit.path)).toEqual(['Locked/secret.md']);
    expect(results.complete).toBe(false);
  });

  test('a note changed while indexing is indexed again', async () => {
    const vault = new MemoryVault();
    vault.set('A.md', 'first', 1);
    const index = await openIndex(vault);
    await index.discover();
    const original = vault.readText.bind(vault);
    vault.readText = async (path) => {
      const result = await original(path);
      // the file changes after it was read but before the batch is stored.
      vault.set('A.md', 'second', 2);
      await index.discover();
      return result;
    };
    await index.indexContents(() => vault.reads.length >= 1);
    vault.readText = original;
    expect((await index.coverage()).pending).toBe(1);
    await index.indexContents();
    expect((await index.search('second')).hits.map((hit) => hit.path)).toEqual(['A.md']);
    expect((await index.search('first')).hits).toEqual([]);
  });

  test('refresh updates one note immediately, for example after a save', async () => {
    const vault = new MemoryVault();
    vault.set('Daily/2026-10-08.md', 'morning', 1);
    const index = await openIndex(vault);
    await index.discover();
    await index.indexContents();
    vault.set('Daily/2026-10-08.md', 'morning and evening', 2);
    await index.refresh('Daily/2026-10-08.md', 2);
    expect((await index.search('evening')).hits.map((hit) => hit.path)).toEqual(['Daily/2026-10-08.md']);
    vault.set('New.md', 'created by the editor', 3);
    await index.refresh('New.md', 3);
    expect((await index.search('editor')).hits.map((hit) => hit.path)).toEqual(['New.md']);
  });

  test('a note refreshed while discovery is running is not removed by that pass', async () => {
    const vault = new MemoryVault();
    vault.set('Daily/2026-10-07.md', 'yesterday', 1);
    let clock = 100;
    const index = await SearchIndex.open(bunSqlDatabase(), vault, { pause: immediate, now: () => clock });
    await index.discover();
    const originalList = vault.listNotes.bind(vault);
    vault.listNotes = async () => {
      const listing = await originalList();
      // today's note is created and refreshed after the listing was taken.
      clock = 200;
      vault.set('Daily/2026-10-08.md', 'today', 2);
      await index.refresh('Daily/2026-10-08.md', 2);
      return listing;
    };
    expect((await index.discover()).removed).toBe(0);
    vault.listNotes = originalList;
    expect((await index.search('today')).hits.map((hit) => hit.path)).toEqual(['Daily/2026-10-08.md']);
    // the next discovery sees the file and keeps it; a later deletion is still detected.
    clock = 300;
    await index.discover();
    vault.files.delete('Daily/2026-10-08.md');
    clock = 400;
    expect((await index.discover()).removed).toBe(1);
  });

  test('a discovery where nothing changed writes nothing', async () => {
    const vault = new MemoryVault();
    for (let i = 0; i < 300; i++) vault.set(`Notes/${i}.md`, `note ${i}`, i);
    const sql = bunSqlDatabase();
    let writes = 0;
    const counted = { ...sql, runAsync: (source: string, params: (string | number | null)[]) => (writes++, sql.runAsync(source, params)) };
    const index = await SearchIndex.open(counted, vault, { pause: immediate });
    await index.discover();
    await index.indexContents();
    writes = 0;
    expect(await index.discover()).toEqual({ notes: 300, removed: 0 });
    expect(writes).toBe(0);
    // one edit, one new note, one deletion: three rows change.
    vault.set('Notes/1.md', 'edited', 1000);
    vault.set('Notes/new.md', 'new', 1001);
    vault.files.delete('Notes/2.md');
    expect(await index.discover()).toEqual({ notes: 300, removed: 1 });
    expect(writes).toBe(4); // two upserts, then the deleted note's text and row
    vault.reads = [];
    await index.indexContents();
    expect(vault.reads.sort()).toEqual(['Notes/1.md', 'Notes/new.md']);
  });

  test('discovery can use a listing the app already took, without a second scan', async () => {
    const vault = new MemoryVault();
    vault.set('A.md', 'apple', 1);
    const index = await openIndex(vault);
    const listing = await vault.listNotes();
    vault.listNotes = async () => {
      throw new Error('no second scan');
    };
    expect(await index.discover({ listing, listedAt: 0 })).toEqual({ notes: 1, removed: 0 });
    await index.indexContents();
    expect((await index.search('apple')).hits.map((hit) => hit.path)).toEqual(['A.md']);
  });

  test('opening an unchanged note does not make the next pass read it again', async () => {
    const vault = new MemoryVault();
    vault.set('Daily/2026-10-08.md', 'morning', 5);
    const index = await openIndex(vault);
    await index.discover();
    await index.indexContents();
    vault.reads = [];
    // the workspace refreshes the open note without knowing its modified time.
    await index.refresh('Daily/2026-10-08.md');
    await index.discover();
    await index.indexContents();
    expect(vault.reads).toEqual(['Daily/2026-10-08.md']);
    // a later change is still found by discovery and indexed.
    vault.set('Daily/2026-10-08.md', 'morning and evening', 6);
    await index.discover();
    await index.indexContents();
    expect((await index.search('evening')).hits.map((hit) => hit.path)).toEqual(['Daily/2026-10-08.md']);
  });

  test('non-utf-8 notes are found by name; rebuild never writes notes', async () => {
    const vault = new MemoryVault();
    vault.set('Encodings/Latin-1.md', null, 1);
    const index = await openIndex(vault);
    await index.rebuild();
    expect((await index.search('latin')).hits.map((hit) => hit.path)).toEqual(['Encodings/Latin-1.md']);
    expect((await index.coverage()).pending).toBe(0);
  });

  test('each vault has its own index, so switching vaults never mixes results', async () => {
    const work = new MemoryVault();
    work.set('Plans/Roadmap.md', 'quarterly roadmap', 1);
    const home = new MemoryVault();
    home.set('Recipes/Bread.md', 'sourdough roadmap for the weekend', 1);
    const workIndex = await openIndex(work);
    const homeIndex = await openIndex(home);
    for (const index of [workIndex, homeIndex]) {
      await index.discover();
      await index.indexContents();
    }
    expect((await workIndex.search('roadmap')).hits.map((hit) => hit.path)).toEqual(['Plans/Roadmap.md']);
    expect((await homeIndex.search('roadmap')).hits.map((hit) => hit.path)).toEqual(['Recipes/Bread.md']);
  });

  test('an index with an older schema version is dropped and rebuilt from the notes', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, path TEXT); INSERT INTO notes (path) VALUES ('Old.md');
      PRAGMA user_version = 1;`);
    const vault = new MemoryVault();
    vault.set('Current.md', 'current text', 1);
    const index = await SearchIndex.open(bunSqlDatabase(db), vault, { batchSize: 25, discoveryBatchSize: 100, pause: immediate });
    await index.discover();
    await index.indexContents();
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
    expect((await index.search('old')).hits).toEqual([]);
    expect((await index.search('current')).hits.map((hit) => hit.path)).toEqual(['Current.md']);
    expect((await index.coverage())).toMatchObject({ total: 1, indexed: 1, pending: 0 });
  });

  test('rebuild replaces every row with the notes the vault has now', async () => {
    const vault = new MemoryVault();
    vault.set('Kept.md', 'kept text', 1);
    vault.set('Gone.md', 'gone text', 1);
    const index = await openIndex(vault);
    await index.discover();
    await index.indexContents();
    vault.files.delete('Gone.md');
    vault.set('Kept.md', 'kept and edited text', 2);
    await index.rebuild();
    expect((await index.search('gone')).hits).toEqual([]);
    expect((await index.search('edited')).hits.map((hit) => hit.path)).toEqual(['Kept.md']);
    expect((await index.coverage())).toMatchObject({ total: 1, indexed: 1, pending: 0 });
  });

  test('unicode: names and diacritic-insensitive content', async () => {
    const vault = new MemoryVault();
    vault.set('Résumé.md', 'Experience in Zürich and naïve cafés', 1);
    const index = await openIndex(vault);
    await index.discover();
    await index.indexContents();
    expect((await index.search('résumé')).hits[0]).toMatchObject({ path: 'Résumé.md', match: 'name' });
    expect((await index.search('zurich naive')).hits.map((hit) => hit.path)).toEqual(['Résumé.md']);
    expect((await index.search('---')).hits).toEqual([]);
  });

  test('the fixture vault and a 2,000-note generated vault index and search correctly', async () => {
    const vault = new MemoryVault();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (!entry.startsWith('.')) walk(full);
        } else if (entry.toLowerCase().endsWith('.md') && !entry.startsWith('.')) {
          const bytes = readFileSync(full);
          let text: string | null;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            text = null;
          }
          vault.set(relative(FIXTURE, full).split(sep).join('/'), text, 1);
        }
      }
    };
    walk(FIXTURE);
    for (const file of generateVault({ count: 2_000 })) {
      vault.set(`Generated/${file.path}`, new TextDecoder().decode(file.data), 2);
    }
    const index = await openIndex(vault, 200);
    await index.discover();
    await index.indexContents();
    const coverage = await index.coverage();
    expect(coverage).toMatchObject({ total: vault.files.size, indexed: vault.files.size, pending: 0 });
    expect((await index.search('callout title')).hits[0]?.path).toBe('Welcome.md');
    const indexHits = (await index.search('index')).hits.filter((hit) => hit.match === 'name').map((hit) => hit.path);
    expect(indexHits.slice(0, 3)).toEqual(['Archive/Index.md', 'Projects/Alpha/Index.md', 'Projects/Beta/Index.md']);
    expect((await index.search('2026-10-07')).hits[0]?.path).toBe('Daily/2026-10-07.md');
  });
});

describe('SearchSession', () => {
  test('a slow older query does not replace newer results', async () => {
    const vault = new MemoryVault();
    vault.set('Alpha.md', 'a', 1);
    vault.set('Beta.md', 'b', 1);
    const index = await openIndex(vault);
    await index.discover();
    const session = new SearchSession(index);
    const first = session.query('alpha');
    const second = session.query('beta');
    expect(await first).toBeNull();
    expect((await second)?.hits.map((hit) => hit.path)).toEqual(['Beta.md']);
  });
});
