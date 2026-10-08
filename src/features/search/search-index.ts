/**
 * incremental search over the vault (u4, r6, r7). filenames are discovered first; content is
 * read and indexed in bounded batches; rebuilding the index never touches the notes.
 */
import type { NativeNote, NativeReadResult } from '../../../modules/vault/src';
import {
  ftsMatch,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  likeContains,
  nameKey,
  noteFolder,
  noteName,
  queryTerms,
} from './query';
import { ensureSchema } from './schema';
import { type SqlDatabase, type SqlValue, WriteQueue } from './sql';

export type NoteListing = { notes: NativeNote[]; unreadableFolders: string[] };

export type IndexSource = {
  listNotes(): Promise<NoteListing>;
  readText(path: string): Promise<NativeReadResult>;
};

export type Coverage = {
  /** notes known by name. */
  total: number;
  /** notes whose current content is searchable. */
  indexed: number;
  /** available notes whose content is not indexed yet or changed since. */
  pending: number;
  /** notes in the cloud and not downloaded: found by name only. */
  placeholders: number;
  /** folders that could not be listed; their notes may be missing. */
  unreadableFolders: string[];
};

export type SearchHit = {
  path: string;
  title: string;
  folder: string;
  match: 'name' | 'content';
  /** content excerpt with HIGHLIGHT_START/HIGHLIGHT_END around matches. */
  snippet?: string;
  placeholder: boolean;
};

export type SearchResults = {
  query: string;
  hits: SearchHit[];
  coverage: Coverage;
  /** true only when every note's current content was searchable (r7). */
  complete: boolean;
};

export type IndexOptions = {
  /** notes read per content batch. */
  batchSize: number;
  /** names written per discovery transaction. */
  discoveryBatchSize: number;
  /** yields between batches so typing and scrolling stay responsive. */
  pause: () => Promise<void>;
  /** the clock for ordering refreshes against discovery listings. */
  now: () => number;
};

const DEFAULT_OPTIONS: IndexOptions = {
  batchSize: 25,
  discoveryBatchSize: 500,
  pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
  now: () => Date.now(),
};

type NoteRow = { id: number; path: string; name: string; folder: string; placeholder: number };
type KnownRow = { id: number; path: string; size: number | null; modified: number | null; placeholder: number };

/** the folder prefix test for `unreadableFolders` entries. */
function insideAny(path: string, folders: string[]) {
  return folders.some((folder) => folder === '' || path === folder || path.startsWith(`${folder}/`));
}

export class SearchIndex {
  private readonly writes = new WriteQueue();
  private readonly options: IndexOptions;
  private unreadableFolders: string[] = [];

  private constructor(
    private readonly db: SqlDatabase,
    private readonly source: IndexSource,
    options: Partial<IndexOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  static async open(db: SqlDatabase, source: IndexSource, options: Partial<IndexOptions> = {}) {
    await ensureSchema(db);
    return new SearchIndex(db, source, options);
  }

  /**
   * filename discovery. records names, sizes, modified times, and cloud placeholders, and removes
   * notes that disappeared. notes under unreadable folders are kept: unknown is not deleted.
   *
   * it compares the listing with the index and writes only new, changed, and removed notes, so
   * a launch where nothing changed writes nothing. pass a listing the app already has, with the
   * time it was taken, to avoid a second vault scan.
   */
  async discover(given?: { listing: NoteListing; listedAt: number }): Promise<{ notes: number; removed: number }> {
    const listedAt = given?.listedAt ?? this.options.now();
    const listing = given?.listing ?? (await this.source.listNotes());
    this.unreadableFolders = listing.unreadableFolders;
    const known = new Map(
      (await this.db.getAllAsync<KnownRow>('SELECT id, path, size, modified, placeholder FROM notes', [])).map((row) => [row.path, row]),
    );
    const changed = listing.notes.filter((note) => {
      const row = known.get(note.path);
      known.delete(note.path);
      return !row || row.size !== (note.size ?? null) || row.modified !== (note.modified ?? null) || row.placeholder !== (note.placeholder ? 1 : 0);
    });
    // what is left in `known` was not listed: deleted or renamed, or in an unreadable folder.
    const missing = [...known.values()].filter((row) => !insideAny(row.path, this.unreadableFolders));
    if (changed.length > 0) {
      const passRow = await this.db.getFirstAsync<{ pass: number }>('SELECT COALESCE(MAX(seen), 0) + 1 AS pass FROM notes', []);
      const pass = passRow?.pass ?? 1;
      const { discoveryBatchSize } = this.options;
      for (let start = 0; start < changed.length; start += discoveryBatchSize) {
        const chunk = changed.slice(start, start + discoveryBatchSize);
        await this.write(async () => {
          for (const note of chunk) {
            const name = noteName(note.path);
            await this.db.runAsync(
              `INSERT INTO notes (path, name, name_key, folder, size, modified, placeholder, seen)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET
                 size = excluded.size, modified = excluded.modified,
                 placeholder = excluded.placeholder, seen = excluded.seen`,
              [note.path, name, nameKey(name), noteFolder(note.path), note.size ?? null, note.modified ?? null, note.placeholder ? 1 : 0, pass],
            );
          }
        });
        await this.options.pause();
      }
    }
    let removed = 0;
    if (missing.length > 0) {
      await this.write(async () => {
        for (const row of missing) {
          // a row refreshed after the listing was taken may be newer than the listing knows.
          const current = await this.db.getFirstAsync<{ refreshed_at: number | null }>('SELECT refreshed_at FROM notes WHERE id = ?', [row.id]);
          if (current && (current.refreshed_at === null || current.refreshed_at < listedAt)) {
            await this.removeRow(row.id);
            removed++;
          }
        }
      });
    }
    return { notes: listing.notes.length, removed };
  }

  /**
   * reads and indexes content that is new or changed, newest first, in bounded batches.
   * returns the number of notes processed. `shouldStop` lets callers pause for other work.
   */
  async indexContents(shouldStop: () => boolean = () => false): Promise<number> {
    let processed = 0;
    while (!shouldStop()) {
      const batch = await this.db.getAllAsync<{ id: number; path: string; modified: number | null }>(
        `SELECT id, path, modified FROM notes
         WHERE placeholder = 0 AND (indexed_modified IS NULL OR indexed_modified <> COALESCE(modified, -1))
         ORDER BY modified DESC LIMIT ?`,
        [this.options.batchSize],
      );
      if (batch.length === 0) {
        break;
      }
      const reads: { row: (typeof batch)[number]; result: NativeReadResult }[] = [];
      for (const row of batch) {
        reads.push({ row, result: await this.source.readText(row.path) });
      }
      await this.write(async () => {
        for (const { row, result } of reads) {
          await this.store(row.id, row.path, row.modified, result);
        }
      });
      processed += batch.length;
      await this.options.pause();
    }
    return processed;
  }

  /**
   * re-reads one note, for example right after the editor saved it. without a new `modified`
   * time the row keeps the time discovery saw: an unchanged note is not read again by the next
   * pass, and a changed one is, once discovery sees its new time.
   */
  async refresh(path: string, modified: number | null = null): Promise<void> {
    const row = await this.db.getFirstAsync<{ id: number; modified: number | null }>('SELECT id, modified FROM notes WHERE path = ?', [path]);
    const based = modified ?? row?.modified ?? null;
    const result = await this.source.readText(path);
    await this.write(async () => {
      let id = row?.id;
      if (id === undefined) {
        if (result.kind === 'unavailable') return;
        const name = noteName(path);
        const inserted = await this.db.runAsync(
          'INSERT INTO notes (path, name, name_key, folder, modified, placeholder, seen, refreshed_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
          [path, name, nameKey(name), noteFolder(path), modified, this.options.now()],
        );
        id = inserted.lastInsertRowId;
      } else {
        await this.db.runAsync('UPDATE notes SET modified = COALESCE(?, modified), refreshed_at = ? WHERE id = ?', [modified, this.options.now(), id]);
      }
      await this.store(id, path, based, result);
    });
  }

  async coverage(): Promise<Coverage> {
    const row = await this.db.getFirstAsync<{ total: number; indexed: number | null; placeholders: number | null }>(
      `SELECT COUNT(*) AS total,
         SUM(CASE WHEN placeholder = 0 AND indexed_modified = COALESCE(modified, -1) THEN 1 ELSE 0 END) AS indexed,
         SUM(placeholder) AS placeholders
       FROM notes`,
      [],
    );
    const total = row?.total ?? 0;
    const indexed = row?.indexed ?? 0;
    const placeholders = row?.placeholders ?? 0;
    return { total, indexed, placeholders, pending: total - indexed - placeholders, unreadableFolders: this.unreadableFolders };
  }

  /** filename matches first, then content matches ranked by bm25. */
  async search(query: string, limit = 50): Promise<SearchResults> {
    const terms = queryTerms(query);
    const coverage = await this.coverage();
    const complete = coverage.pending === 0 && coverage.placeholders === 0 && coverage.unreadableFolders.length === 0;
    if (terms.length === 0) {
      return { query, hits: [], coverage, complete };
    }
    const whole = nameKey(terms.join(' '));
    const conditions = terms.map(() => "name_key LIKE ? ESCAPE '\\'").join(' AND ');
    const nameRows = await this.db.getAllAsync<NoteRow>(
      `SELECT id, path, name, folder, placeholder FROM notes WHERE ${conditions}
       ORDER BY (name_key = ?) DESC, (substr(name_key, 1, length(?)) = ?) DESC, length(name) ASC, path ASC
       LIMIT ?`,
      [...terms.map(likeContains), whole, whole, whole, limit],
    );
    const hits: SearchHit[] = nameRows.map((row) => ({
      path: row.path,
      title: row.name,
      folder: row.folder,
      match: 'name',
      placeholder: row.placeholder === 1,
    }));
    const match = ftsMatch(terms);
    if (match && hits.length < limit) {
      const seen = new Set(nameRows.map((row) => row.id));
      try {
        const contentRows = await this.db.getAllAsync<NoteRow & { snippet: string }>(
          `SELECT n.id, n.path, n.name, n.folder, n.placeholder,
             snippet(note_text, 1, ?, ?, '…', 12) AS snippet
           FROM note_text JOIN notes n ON n.id = note_text.rowid
           WHERE note_text MATCH ?
           ORDER BY bm25(note_text, 4.0, 1.0)
           LIMIT ?`,
          [HIGHLIGHT_START, HIGHLIGHT_END, match, limit + nameRows.length],
        );
        for (const row of contentRows) {
          if (hits.length >= limit) break;
          if (seen.has(row.id)) continue;
          hits.push({
            path: row.path,
            title: row.name,
            folder: row.folder,
            match: 'content',
            snippet: row.snippet,
            placeholder: row.placeholder === 1,
          });
        }
      } catch {
        // an expression fts5 cannot parse still returns the filename matches.
      }
    }
    return { query, hits, coverage, complete };
  }

  /** deletes and rebuilds the index from the vault. notes are only read. */
  async rebuild(): Promise<void> {
    await this.write(async () => {
      await this.db.execAsync('DELETE FROM note_text; DELETE FROM notes;');
    });
    await this.discover();
    await this.indexContents();
  }

  // MARK: helpers

  private write(task: () => Promise<void>) {
    return this.writes.run(() => this.db.withTransactionAsync(task));
  }

  private async removeRow(id: number) {
    await this.db.runAsync('DELETE FROM note_text WHERE rowid = ?', [id]);
    await this.db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
  }

  /** stores one read result; `modified` is the value the read was based on, so a newer change is indexed again. */
  private async store(id: number, path: string, modified: number | null, result: NativeReadResult) {
    const marker: SqlValue = modified ?? -1;
    await this.db.runAsync('DELETE FROM note_text WHERE rowid = ?', [id]);
    switch (result.kind) {
      case 'text':
        await this.db.runAsync('INSERT INTO note_text (rowid, title, body) VALUES (?, ?, ?)', [id, noteName(path), result.text]);
        await this.db.runAsync('UPDATE notes SET indexed_modified = ?, indexed_revision = ?, placeholder = 0 WHERE id = ?', [
          marker,
          result.revision.sha256,
          id,
        ]);
        return;
      case 'read-only':
        // not valid utf-8: searchable by name only.
        await this.db.runAsync('INSERT INTO note_text (rowid, title, body) VALUES (?, ?, ?)', [id, noteName(path), '']);
        await this.db.runAsync("UPDATE notes SET indexed_modified = ?, indexed_revision = 'read-only' WHERE id = ?", [marker, id]);
        return;
      case 'unavailable':
        if (result.state.kind === 'absent') {
          await this.removeRow(id);
        } else if (result.state.kind === 'placeholder') {
          await this.db.runAsync('UPDATE notes SET placeholder = 1, indexed_modified = NULL WHERE id = ?', [id]);
        } else {
          // unknown: try again on the next discovery pass rather than looping now.
          await this.db.runAsync("UPDATE notes SET indexed_modified = ?, indexed_revision = 'unavailable' WHERE id = ?", [marker, id]);
        }
        return;
    }
  }
}

/**
 * runs searches so only the latest query's results are delivered (r7). an older query that
 * finishes late resolves null instead of replacing newer results.
 */
export class SearchSession {
  private generation = 0;

  constructor(private readonly index: SearchIndex) {}

  async query(text: string, limit?: number): Promise<SearchResults | null> {
    const generation = ++this.generation;
    const results = await this.index.search(text, limit);
    return generation === this.generation ? results : null;
  }

  /** invalidates in-flight queries, for example when the vault changes. */
  cancel() {
    this.generation++;
  }
}
