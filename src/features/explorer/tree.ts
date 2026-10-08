/**
 * the file explorer's tree (r8): note paths become folders and files, and expanded folders are
 * flattened into rows for a virtualized list.
 */

export type ExplorerRow =
  | { kind: 'folder'; path: string; name: string; depth: number; expanded: boolean; count: number }
  | { kind: 'note'; path: string; name: string; depth: number; placeholder: boolean };

type Folder = { folders: Map<string, Folder>; notes: { name: string; path: string; placeholder: boolean }[]; count: number };

export type ExplorerNote = { path: string; placeholder?: boolean };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareNames(a: string, b: string) {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function displayName(file: string) {
  return file.toLowerCase().endsWith('.md') ? file.slice(0, -3) : file;
}

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
    folder.notes.push({ name: displayName(file), path: note.path, placeholder: note.placeholder ?? false });
  }
  return root;
}

/** folders first, then notes, each in natural name order; only expanded folders show children. */
export function flattenTree(root: Folder, expanded: ReadonlySet<string>): ExplorerRow[] {
  const rows: ExplorerRow[] = [];
  const visit = (folder: Folder, prefix: string, depth: number) => {
    for (const name of [...folder.folders.keys()].sort(compareNames)) {
      const child = folder.folders.get(name);
      if (!child) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      const isExpanded = expanded.has(path);
      rows.push({ kind: 'folder', path, name, depth, expanded: isExpanded, count: child.count });
      if (isExpanded) visit(child, path, depth + 1);
    }
    for (const note of [...folder.notes].sort((a, b) => compareNames(a.name, b.name))) {
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
