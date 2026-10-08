/**
 * query semantics for search (ktd4, t06).
 *
 * - filenames: case-insensitive substring match on the note name, ranked first.
 * - contents: fts5 with the unicode61 tokenizer (diacritics removed); every term is a token
 *   prefix and all terms must match. scripts written without spaces, such as japanese, form
 *   long tokens, so content search finds them only from the start of a run; filename search
 *   still matches any substring.
 */

/** nfc when the javascript engine supports it; otherwise the text unchanged. */
function nfc(text: string): string {
  return typeof text.normalize === 'function' ? text.normalize('NFC') : text;
}

/** letters or digits: ascii alphanumerics, or any character from latin-1 letters upward. */
const WORD_CHARACTER = /[0-9A-Za-z\u00C0-\uFFFF]/;

/** splits a query into terms. quotes and operators are literal text, never fts syntax. */
export function queryTerms(query: string): string[] {
  return nfc(query)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 8);
}

/** an fts5 match expression: each term quoted (internal quotes doubled) and used as a prefix. */
export function ftsMatch(terms: string[]): string | null {
  const usable = terms.filter((term) => WORD_CHARACTER.test(term));
  if (usable.length === 0) {
    return null;
  }
  return usable.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ');
}

/** the comparison key for note names: nfc, lowercase, diacritics kept. */
export function nameKey(name: string): string {
  return nfc(name).toLowerCase();
}

/** a sql like pattern for a substring, escaping like wildcards with `\`. */
export function likeContains(term: string): string {
  return `%${nameKey(term).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function noteName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.toLowerCase().endsWith('.md') ? file.slice(0, -3) : file;
}

export function noteFolder(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** markers around highlighted snippet text; control characters never occur in typed queries. */
export const HIGHLIGHT_START = '\u0001';
export const HIGHLIGHT_END = '\u0002';

/** splits a snippet into plain and highlighted parts for display. */
export function snippetParts(snippet: string): { text: string; highlight: boolean }[] {
  const parts: { text: string; highlight: boolean }[] = [];
  let highlight = false;
  let current = '';
  for (const char of snippet) {
    if (char === HIGHLIGHT_START || char === HIGHLIGHT_END) {
      if (current) parts.push({ text: current, highlight });
      current = '';
      highlight = char === HIGHLIGHT_START;
    } else {
      current += char;
    }
  }
  if (current) parts.push({ text: current, highlight });
  return parts;
}
