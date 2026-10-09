/**
 * new notes, as in obsidian: "Untitled.md", then "Untitled 1.md" and so on, in the open note's
 * folder (r9). creation is exclusive, so an existing file is never replaced.
 */
export type CreateResult = 'created' | 'exists' | 'failed';

const MAX_ATTEMPTS = 100;

/** the folder of a vault path, or '' for the vault root. */
export function folderOf(path: string | null): string {
  return path && path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

export function untitledPath(folder: string, attempt: number): string {
  const name = attempt === 0 ? 'Untitled.md' : `Untitled ${attempt}.md`;
  return folder ? `${folder}/${name}` : name;
}

/** characters that obsidian refuses in note names; a link that needs them creates nothing. */
const UNSAFE_NAME = /[\\:*?"<>]/;

/**
 * the path for the note a wikilink names when no note matches: beside the open note, or the
 * vault path itself when the target has a "/". returns null when no valid name results.
 */
export function linkedNotePath(target: string, from: string | null): string | null {
  let name = target.trim().replace(/\.md$/i, '');
  if (!name || UNSAFE_NAME.test(name)) return null;
  if (name.includes('/')) {
    name = name.replace(/^\/+/, '');
    const segments = name.split('/').map((segment) => segment.trim());
    if (segments.some((segment) => segment === '')) return null;
    return `${segments.join('/')}.md`;
  }
  const folder = folderOf(from);
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}

/** returns the created path, or null when every name is taken or creation failed. */
export async function createUntitledNote(folder: string, create: (path: string) => Promise<CreateResult>): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const path = untitledPath(folder, attempt);
    const result = await create(path);
    if (result === 'created') return path;
    if (result === 'failed') return null;
  }
  return null;
}
