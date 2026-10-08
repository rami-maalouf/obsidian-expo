import type { SqlDatabase } from './sql';

/** the search index needs the ios build; other platforms have no index. */
export async function openIndexDatabase(_vaultId: string): Promise<SqlDatabase | null> {
  return null;
}
