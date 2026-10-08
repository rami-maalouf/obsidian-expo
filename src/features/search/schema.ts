/**
 * the disposable search index (ktd4). it lives in app-private storage, never in the vault, and
 * is rebuilt from the notes whenever its schema version changes.
 */
import type { SqlDatabase } from './sql';

export const SCHEMA_VERSION = 1;

const CREATE = `
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  folder TEXT NOT NULL,
  size INTEGER,
  modified REAL,
  placeholder INTEGER NOT NULL DEFAULT 0,
  -- the modified time and revision of the content in note_text; null until indexed.
  indexed_modified REAL,
  indexed_revision TEXT,
  -- the discovery pass that last saw this path; older rows were deleted or renamed.
  seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_name_key ON notes(name_key);
CREATE VIRTUAL TABLE IF NOT EXISTS note_text USING fts5(
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const DROP = `
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS note_text;
DROP TABLE IF EXISTS meta;
`;

/** creates the schema, rebuilding the index when the stored version differs. */
export async function ensureSchema(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  if (row?.user_version !== SCHEMA_VERSION) {
    await db.execAsync(DROP);
  }
  await db.execAsync(CREATE);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
