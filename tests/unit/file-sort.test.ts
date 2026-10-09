import { describe, expect, test } from 'bun:test';

import { DEFAULT_FILE_SORT, FILE_SORT_GROUPS, type FileSort, fileSortKey, parseFileSort } from '@/features/explorer/file-sort';

const ALL: FileSort[] = ['name-asc', 'name-desc', 'modified-desc', 'modified-asc', 'created-desc', 'created-asc'];

describe('stored file sort', () => {
  test('the default is today\'s natural name order', () => {
    expect(DEFAULT_FILE_SORT).toBe('name-asc');
    expect(fileSortKey('vault-1')).toBe('vault:vault-1:file-sort');
  });

  test('every stored choice round trips as json', () => {
    for (const sort of ALL) expect(parseFileSort(JSON.stringify(sort))).toBe(sort);
  });

  test('missing or invalid values mean the default', () => {
    expect(parseFileSort(null)).toBe('name-asc');
    expect(parseFileSort('')).toBe('name-asc');
    for (const stored of ['not json', 'modified-desc', '"name"', '"NAME-DESC"', '5', 'null', '["name-desc"]', '{"sort":"name-desc"}']) {
      expect(parseFileSort(stored)).toBe('name-asc');
    }
  });
});

describe('file sort menu', () => {
  test('three groups in menu order with obsidian\'s labels', () => {
    expect(FILE_SORT_GROUPS.map((group) => group.id)).toEqual(['name', 'modified', 'created']);
    expect(FILE_SORT_GROUPS.map((group) => group.options.map((option) => [option.value, option.label]))).toEqual([
      [
        ['name-asc', 'File name (A to Z)'],
        ['name-desc', 'File name (Z to A)'],
      ],
      [
        ['modified-desc', 'Modified time (new to old)'],
        ['modified-asc', 'Modified time (old to new)'],
      ],
      [
        ['created-desc', 'Created time (new to old)'],
        ['created-asc', 'Created time (old to new)'],
      ],
    ]);
  });

  test('each sort appears exactly once', () => {
    const values = FILE_SORT_GROUPS.flatMap((group) => group.options.map((option) => option.value));
    expect([...values].sort()).toEqual([...ALL].sort());
  });
});
