import { Database } from 'bun:sqlite';

import type { SqlDatabase } from '@/features/search/sql';

/** the expo-sqlite subset used by the search index, implemented over bun:sqlite. */
export function bunSqlDatabase(db: Database = new Database(':memory:')): SqlDatabase {
  return {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, params) {
      const result = db.query(source).run(...params);
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getAllAsync<T>(source: string, params: (string | number | null)[]) {
      return db.query(source).all(...params) as T[];
    },
    async getFirstAsync<T>(source: string, params: (string | number | null)[]) {
      return (db.query(source).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
