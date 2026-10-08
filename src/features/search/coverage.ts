/**
 * text for search coverage and result snippets (r6, r7), shared by the native search screen.
 */
import { snippetParts } from './query';
import type { Coverage } from './search-index';

export function coverageText(coverage: Coverage | null, indexing: boolean): string {
  if (!coverage) return 'Preparing search…';
  const parts = [`${coverage.indexed.toLocaleString()} of ${coverage.total.toLocaleString()} notes searchable by content`];
  if (coverage.placeholders > 0) parts.push(`${coverage.placeholders.toLocaleString()} in iCloud, names only`);
  if (coverage.unreadableFolders.length > 0) parts.push(`${coverage.unreadableFolders.length} folders unreadable`);
  if (indexing) parts.push('indexing');
  return parts.join(' · ');
}

/** markdown for a native text view: highlighted matches are bold, note text is escaped. */
export function snippetMarkdown(snippet: string): string {
  return snippetParts(snippet)
    .map((part) => {
      const text = part.text.replace(/\s+/g, ' ').replace(/[\\`*_[\]~<>#|]/g, '\\$&');
      return part.highlight && text.trim() ? `**${text}**` : text;
    })
    .join('');
}
