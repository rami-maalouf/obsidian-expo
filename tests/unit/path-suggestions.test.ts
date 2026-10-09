import { describe, expect, test } from 'bun:test';

import {
  buildPathCatalog,
  type CatalogNote,
  foldKey,
  matchScore,
  SUGGESTION_LIMIT,
  suggestFolders,
  suggestTemplates,
} from '@/features/settings/path-suggestions';

const catalog = (...notes: (string | CatalogNote)[]) => buildPathCatalog(notes.map((note) => (typeof note === 'string' ? { path: note } : note)));
const paths = (suggestions: { path: string }[]) => suggestions.map((suggestion) => suggestion.path);

const VAULT = catalog(
  'Welcome.md',
  'Journal/2026-10-07.md',
  'Journal/2026-10-08.md',
  'Journal/Archive/2025-01-01.md',
  'Projects/Alpha/Index.md',
  'Projects/Beta/Index.md',
  'Projects/Daily standup.md',
  { path: 'Templates/Daily.md', modified: 10 },
  { path: 'Templates/Meeting.md', modified: 20 },
  'Résumé.md',
);

describe('vault folders', () => {
  test('every folder is listed once with the notes inside it, subfolders included', () => {
    const folders = VAULT.folders.map(({ path, name, parent, count }) => ({ path, name, parent, count }));
    expect(folders.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'Journal', name: 'Journal', parent: '', count: 3 },
      { path: 'Journal/Archive', name: 'Archive', parent: 'Journal', count: 1 },
      { path: 'Projects', name: 'Projects', parent: '', count: 3 },
      { path: 'Projects/Alpha', name: 'Alpha', parent: 'Projects', count: 1 },
      { path: 'Projects/Beta', name: 'Beta', parent: 'Projects', count: 1 },
      { path: 'Templates', name: 'Templates', parent: '', count: 2 },
    ]);
  });

  test('folders and files the settings would refuse are left out', () => {
    const odd = catalog('Bad: name/Note.md', 'Fine/What?.md', 'Fine/Ok.md', 'Fine/image.png');
    expect(paths(odd.folders)).toEqual(['Fine']);
    expect(paths(odd.files)).toEqual(['Fine/Ok.md']);
  });
});

describe('folder suggestions', () => {
  test('nothing typed lists the fullest folders first, then shorter names', () => {
    expect(paths(suggestFolders(VAULT, ''))).toEqual(['Journal', 'Projects', 'Templates', 'Projects/Beta', 'Projects/Alpha']);
  });

  test('a name prefix beats a word start, which beats any substring', () => {
    const vault = catalog('Dear Lily/a.md', 'Holidaily/a.md', 'Old daily/a.md', 'Daily/a.md', 'Weekly/a.md');
    // the query's letters in order still match, last.
    expect(paths(suggestFolders(vault, 'dai'))).toEqual(['Daily', 'Old daily', 'Holidaily', 'Dear Lily']);
  });

  test('an exact name ranks first and is still offered', () => {
    expect(suggestFolders(VAULT, 'journal')[0]).toEqual({ path: 'Journal', name: 'Journal', parent: '', count: 3 });
  });

  test('a "/" matches against the whole path, so subfolders can be reached', () => {
    expect(paths(suggestFolders(VAULT, 'projects/'))).toEqual(['Projects/Beta', 'Projects/Alpha']);
    expect(paths(suggestFolders(VAULT, 'proj/be'))).toEqual(['Projects/Beta']);
    expect(paths(suggestFolders(VAULT, '/journal/ar'))).toEqual(['Journal/Archive']);
  });

  test('case and accents are ignored', () => {
    const vault = catalog('Résumés/a.md', 'CAFÉ/a.md');
    expect(paths(suggestFolders(vault, 'resu'))).toEqual(['Résumés']);
    expect(paths(suggestFolders(vault, 'café'))).toEqual(['CAFÉ']);
    // a decomposed é from the file system matches a typed precomposed é.
    expect(paths(suggestFolders(catalog('Café/a.md'), 'café'))).toEqual(['Café']);
  });

  test('no match means no rows', () => {
    expect(suggestFolders(VAULT, 'zzz')).toEqual([]);
    expect(suggestFolders(buildPathCatalog([]), '')).toEqual([]);
  });
});

describe('template suggestions', () => {
  test('nothing typed lists files in templates folders first, newest first', () => {
    expect(paths(suggestTemplates(VAULT, '')).slice(0, 2)).toEqual(['Templates/Meeting.md', 'Templates/Daily.md']);
  });

  test('typed text matches file names, templates first among equal matches', () => {
    expect(suggestTemplates(VAULT, 'daily')).toEqual([
      { path: 'Templates/Daily.md', name: 'Daily', parent: 'Templates' },
      { path: 'Projects/Daily standup.md', name: 'Daily standup', parent: 'Projects' },
    ]);
  });

  test('a typed path, with or without ".md", finds the file', () => {
    expect(paths(suggestTemplates(VAULT, 'Templates/Daily.md'))).toEqual(['Templates/Daily.md']);
    expect(paths(suggestTemplates(VAULT, 'templates/d'))).toEqual(['Templates/Daily.md']);
    expect(paths(suggestTemplates(VAULT, 'resume'))).toEqual(['Résumé.md']);
  });
});

describe('ranking', () => {
  test('scores follow the [[ link popup: exact, prefix, word start, substring, letters in order', () => {
    expect(matchScore('', 'anything')).toBe(0);
    expect(matchScore('daily', 'daily')).toBe(4000);
    expect(matchScore('dai', 'daily')).toBe(2998);
    expect(matchScore('dai', 'old daily')).toBe(1996);
    expect(matchScore('dai', 'holidaily')).toBe(996);
    expect(matchScore('dly', 'daily')).toBe(480);
    expect(matchScore('xyz', 'daily')).toBeNull();
  });

  test('folding removes case and accents', () => {
    expect(foldKey('Ünïcode É')).toBe('unicode e');
  });

  test('only the best few are returned from a large vault, in order', () => {
    const many = buildPathCatalog(Array.from({ length: 10_000 }, (_, index) => ({ path: `Notes ${index % 50}/Note ${index}.md`, modified: index })));
    const folders = suggestFolders(many, 'notes 1');
    expect(folders).toHaveLength(SUGGESTION_LIMIT);
    expect(folders[0].path).toBe('Notes 1');
    const files = suggestTemplates(many, 'note 999');
    expect(paths(files)).toEqual(['Notes 49/Note 999.md', 'Notes 49/Note 9999.md', 'Notes 48/Note 9998.md', 'Notes 47/Note 9997.md', 'Notes 46/Note 9996.md']);
  });
});
