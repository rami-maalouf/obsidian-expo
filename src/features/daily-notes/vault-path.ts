/**
 * validation for vault-relative paths typed into settings.
 *
 * these checks give early, readable errors. they do not replace the native vault service's
 * containment checks, which resolve symlinks and parents inside coordinated operations.
 */
import type { Result } from '@/features/templates/template';

const FORBIDDEN_CHARACTERS = /[\\:*?"<>|\u0000-\u001f\u007f]/;
const MAX_NAME_BYTES = 255;
const encoder = new TextEncoder();

function segmentError(segment: string): string | null {
  if (segment === '') {
    return 'Remove the empty name between two slashes.';
  }
  if (segment === '.' || segment === '..') {
    return '"." and ".." are not allowed in vault paths.';
  }
  if (segment.startsWith('.')) {
    return `"${segment}" is hidden (starts with "."). Hidden folders such as .obsidian are not allowed.`;
  }
  if (FORBIDDEN_CHARACTERS.test(segment)) {
    return `"${segment}" contains a character that is not allowed: \\ : * ? " < > | or a control character.`;
  }
  if (segment !== segment.trim()) {
    return `"${segment}" starts or ends with a space.`;
  }
  if (encoder.encode(segment).byteLength > MAX_NAME_BYTES) {
    return `"${segment.slice(0, 20)}…" is longer than ${MAX_NAME_BYTES} bytes.`;
  }
  return null;
}

function validateSegments(path: string): Result<string, string> {
  if (path.startsWith('/')) {
    return { ok: false, error: 'Use a path inside the vault, without a leading "/".' };
  }
  for (const segment of path.split('/')) {
    const error = segmentError(segment);
    if (error) {
      return { ok: false, error };
    }
  }
  return { ok: true, value: path };
}

/** normalizes a folder path. an empty value means the vault root; trailing slashes are removed. */
export function normalizeFolderPath(input: string): Result<string, string> {
  const path = input.trim().replace(/\/+$/, '');
  return path === '' ? { ok: true, value: '' } : validateSegments(path);
}

/** normalizes a Markdown note path, adding `.md` when the extension is missing. */
export function normalizeNotePath(input: string): Result<string, string> {
  const path = input.trim();
  if (path === '') {
    return { ok: false, error: 'Enter a path.' };
  }
  if (path.endsWith('/')) {
    return { ok: false, error: 'Enter a file path, not a folder.' };
  }
  return validateSegments(/\.md$/i.test(path) ? path : `${path}.md`);
}

export function joinVaultPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}
