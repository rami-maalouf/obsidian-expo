/**
 * the file explorer's tree (r8): note paths become folders and files, and expanded folders are
 * flattened into rows for a virtualized list.
 */
import { DEFAULT_FILE_SORT, type FileSort } from './file-sort';

export type ExplorerRow =
  | { kind: 'folder'; path: string; name: string; depth: number; expanded: boolean; count: number }
  | { kind: 'note'; path: string; name: string; depth: number; placeholder: boolean };

type TreeNote = { name: string; path: string; placeholder: boolean; modified?: number; created?: number };

type Folder = { folders: Map<string, Folder>; notes: TreeNote[]; count: number };

/** times are ms since 1970, as the native listing reports them. */
export type ExplorerNote = { path: string; placeholder?: boolean; modified?: number; created?: number };

// natural, case-insensitive order; plain lowercase comparison if the engine lacks Intl.Collator.
const collator =
  typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    : null;

export function compareNames(a: string, b: string) {
  const primary = collator ? collator.compare(a, b) : a.toLowerCase().localeCompare(b.toLowerCase());
  return primary || (a < b ? -1 : a > b ? 1 : 0);
}

function displayName(file: string) {
  return file.toLowerCase().endsWith('.md') ? file.slice(0, -3) : file;
}

// a time the listing could not read (missing, null, or not finite) counts as missing.
function knownTime(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** one time, in either direction; missing times go last both ways, equal times by name a to z. */
function byTime(field: 'modified' | 'created', newestFirst: boolean) {
  return (a: TreeNote, b: TreeNote) => {
    const x = a[field];
    const y = b[field];
    if (x !== y) {
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return newestFirst ? y - x : x - y;
    }
    return compareNames(a.name, b.name);
  };
}

const NOTE_ORDER: Record<FileSort, (a: TreeNote, b: TreeNote) => number> = {
  'name-asc': (a, b) => compareNames(a.name, b.name),
  'name-desc': (a, b) => compareNames(b.name, a.name),
  'modified-desc': byTime('modified', true),
  'modified-asc': byTime('modified', false),
  'created-desc': byTime('created', true),
  'created-asc': byTime('created', false),
};

export function buildTree(notes: ExplorerNote[]): Folder {
  const root: Folder = { folders: new Map(), notes: [], count: 0 };
  for (const note of notes) {
    const segments = note.path.split('/');
    const file = segments.pop() ?? note.path;
    let folder = root;
    folder.count++;
    for (const segment of segments) {
      let child = folder.folders.get(segment);
      if (!child) {
        child = { folders: new Map(), notes: [], count: 0 };
        folder.folders.set(segment, child);
      }
      child.count++;
      folder = child;
    }
    folder.notes.push({
      name: displayName(file),
      path: note.path,
      placeholder: note.placeholder ?? false,
      modified: knownTime(note.modified),
      created: knownTime(note.created),
    });
  }
  return root;
}

/**
 * folders first, then notes; only expanded folders show children. name sorts order folders and
 * notes by name in the chosen direction; time sorts order notes by that time and keep folders a to z.
 */
export function flattenTree(root: Folder, expanded: ReadonlySet<string>, sort: FileSort = DEFAULT_FILE_SORT): ExplorerRow[] {
  const folderOrder = sort === 'name-desc' ? (a: string, b: string) => compareNames(b, a) : compareNames;
  const noteOrder = NOTE_ORDER[sort] ?? NOTE_ORDER[DEFAULT_FILE_SORT];
  const rows: ExplorerRow[] = [];
  const visit = (folder: Folder, prefix: string, depth: number) => {
    for (const name of [...folder.folders.keys()].sort(folderOrder)) {
      const child = folder.folders.get(name);
      if (!child) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      const isExpanded = expanded.has(path);
      rows.push({ kind: 'folder', path, name, depth, expanded: isExpanded, count: child.count });
      if (isExpanded) visit(child, path, depth + 1);
    }
    for (const note of [...folder.notes].sort(noteOrder)) {
      rows.push({ kind: 'note', path: note.path, name: note.name, depth, placeholder: note.placeholder });
    }
  };
  visit(root, '', 0);
  return rows;
}

/** the folders to expand so a note is visible, for example the note open in the editor. */
export function ancestorFolders(path: string): string[] {
  const segments = path.split('/').slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}
