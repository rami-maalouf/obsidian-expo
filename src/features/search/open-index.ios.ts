import { openDatabaseAsync } from 'expo-sqlite';

import { VaultNative } from '../../../modules/vault/src';
import type { SqlDatabase } from './sql';

/** opens the vault's search index database in app caches (ios only). */
export async function openIndexDatabase(vaultId: string): Promise<SqlDatabase | null> {
  if (!VaultNative) {
    return null;
  }
  const db = await openDatabaseAsync(`index-${vaultId}.db`, undefined, VaultNative.indexDirectory);
  await db.execAsync('PRAGMA journal_mode = WAL');
  return {
    execAsync: (source) => db.execAsync(source),
    runAsync: (source, params) => db.runAsync(source, params),
    getAllAsync: (source, params) => db.getAllAsync(source, params),
    getFirstAsync: (source, params) => db.getFirstAsync(source, params),
    withTransactionAsync: (task) => db.withTransactionAsync(task),
  };
}
