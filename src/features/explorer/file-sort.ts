/**
 * the file explorer's sort order (r8), like obsidian's: by file name, modified time, or created
 * time, each in both directions. stored per vault as app data outside the vault (r16).
 */

export type FileSort = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc' | 'created-desc' | 'created-asc';

/** natural name order, a to z: the explorer's order before sorting could be chosen. */
export const DEFAULT_FILE_SORT: FileSort = 'name-asc';

export type FileSortOption = { value: FileSort; label: string };

export type FileSortGroup = { id: 'name' | 'modified' | 'created'; options: readonly FileSortOption[] };

/** the sort menu's sections, in menu order. */
export const FILE_SORT_GROUPS: readonly FileSortGroup[] = [
  {
    id: 'name',
    options: [
      { value: 'name-asc', label: 'File name (A to Z)' },
      { value: 'name-desc', label: 'File name (Z to A)' },
    ],
  },
  {
    id: 'modified',
    options: [
      { value: 'modified-desc', label: 'Modified time (new to old)' },
      { value: 'modified-asc', label: 'Modified time (old to new)' },
    ],
  },
  {
    id: 'created',
    options: [
      { value: 'created-desc', label: 'Created time (new to old)' },
      { value: 'created-asc', label: 'Created time (old to new)' },
    ],
  },
];

const FILE_SORTS: ReadonlySet<unknown> = new Set(FILE_SORT_GROUPS.flatMap((group) => group.options.map((option) => option.value)));

export function isFileSort(value: unknown): value is FileSort {
  return FILE_SORTS.has(value);
}

export function fileSortKey(vaultId: string) {
  return `vault:${vaultId}:file-sort`;
}

/** reads the stored json string; anything missing or invalid means the default order. */
export function parseFileSort(stored: string | null): FileSort {
  if (!stored) return DEFAULT_FILE_SORT;
  try {
    const value: unknown = JSON.parse(stored);
    return isFileSort(value) ? value : DEFAULT_FILE_SORT;
  } catch {
    return DEFAULT_FILE_SORT;
  }
}
