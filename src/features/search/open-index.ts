import type { SqlDatabase } from './sql';

/** the search index needs a native build; the web shell has no index. */
export async function openIndexDatabase(_vaultId: string): Promise<SqlDatabase | null> {
  return null;
}
