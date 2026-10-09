import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_NEW_NOTE_SETTINGS,
  newNoteContent,
  newNoteFolder,
  newNoteWhere,
  validateNewNoteSettings,
} from '@/features/new-notes/settings';
import { newNoteSettingsKey, parseNewNoteSettings, serializeNewNoteSettings } from '@/features/settings/new-note-settings';

const NOW = { year: 2026, month: 10, day: 9, hour: 7, minute: 5, second: 0 };

describe('new-note settings', () => {
  test('the default keeps the old behavior: an empty note beside the open note', () => {
    expect(DEFAULT_NEW_NOTE_SETTINGS).toEqual({ location: 'beside', folder: '', templatePath: null });
    expect(newNoteFolder(DEFAULT_NEW_NOTE_SETTINGS, 'Projects/Alpha/Index.md')).toBe('Projects/Alpha');
    expect(newNoteFolder(DEFAULT_NEW_NOTE_SETTINGS, null)).toBe('');
  });

  test('each location gives its folder', () => {
    expect(newNoteFolder({ location: 'root', folder: 'Inbox', templatePath: null }, 'Projects/Index.md')).toBe('');
    expect(newNoteFolder({ location: 'folder', folder: 'Inbox', templatePath: null }, 'Projects/Index.md')).toBe('Inbox');
    expect(newNoteWhere({ location: 'folder', folder: 'Inbox', templatePath: null })).toBe('Inbox/Untitled.md');
    expect(newNoteWhere({ location: 'root', folder: 'Inbox', templatePath: null })).toBe('Untitled.md');
    expect(newNoteWhere(DEFAULT_NEW_NOTE_SETTINGS)).toBe('Untitled.md, beside the open note');
  });

  test('the folder is required and checked only for the folder location', () => {
    expect(validateNewNoteSettings({ location: 'folder', folder: ' Inbox/ ', templatePath: '' })).toEqual({
      ok: true,
      value: { location: 'folder', folder: 'Inbox', templatePath: null },
    });
    expect(validateNewNoteSettings({ location: 'folder', folder: '', templatePath: '' })).toEqual({
      ok: false,
      error: { folder: 'Enter a folder, or choose "Top of the vault".' },
    });
    const hidden = validateNewNoteSettings({ location: 'folder', folder: '.obsidian', templatePath: '' });
    expect(hidden.ok ? null : hidden.error.folder).toContain('hidden');
    // another location keeps a valid folder for later and ignores an invalid one.
    expect(validateNewNoteSettings({ location: 'root', folder: 'Inbox', templatePath: '' })).toEqual({
      ok: true,
      value: { location: 'root', folder: 'Inbox', templatePath: null },
    });
    expect(validateNewNoteSettings({ location: 'beside', folder: '../x', templatePath: '' })).toEqual({
      ok: true,
      value: { location: 'beside', folder: '', templatePath: null },
    });
  });

  test('the template path gets ".md" and is validated; an unknown location is refused', () => {
    expect(validateNewNoteSettings({ location: 'beside', folder: '', templatePath: 'Templates/Note' })).toEqual({
      ok: true,
      value: { location: 'beside', folder: '', templatePath: 'Templates/Note.md' },
    });
    const bad = validateNewNoteSettings({ location: 'beside', folder: '', templatePath: '/abs.md' });
    expect(bad.ok ? null : bad.error.templatePath).toBeDefined();
    const unknown = validateNewNoteSettings({ location: 'desktop', folder: '', templatePath: '' });
    expect(unknown.ok ? null : unknown.error.location).toBe('Choose where new notes go.');
  });
});

describe('new-note content', () => {
  test('no template means an empty note', () => {
    expect(newNoteContent(null, 'Untitled', NOW)).toEqual({ ok: true, value: '' });
  });

  test('a template gets the note title and the creation clock', () => {
    expect(newNoteContent('# <% tp.file.title %>\nCreated <% tp.date.now("YYYY-MM-DD HH:mm") %>\n', 'Untitled 2', NOW)).toEqual({
      ok: true,
      value: '# Untitled 2\nCreated 2026-10-09 07:05\n',
    });
  });

  test('an unsupported template is an error, so nothing is created', () => {
    const result = newNoteContent('<% tp.system.prompt("Name") %>', 'Untitled', NOW);
    expect(result.ok).toBe(false);
  });
});

describe('stored new-note settings', () => {
  test('round trip per vault', () => {
    expect(newNoteSettingsKey('vault-1')).toBe('vault:vault-1:new-notes');
    const custom = { location: 'folder' as const, folder: 'Inbox', templatePath: 'Templates/Note.md' };
    expect(parseNewNoteSettings(serializeNewNoteSettings(custom))).toEqual(custom);
    expect(parseNewNoteSettings(serializeNewNoteSettings(DEFAULT_NEW_NOTE_SETTINGS))).toEqual(DEFAULT_NEW_NOTE_SETTINGS);
  });

  test('missing or invalid values give the defaults, never first setup', () => {
    for (const stored of [null, '', 'nope', '{"location":"desktop"}', '{"location":"folder","folder":""}', '{"location":"beside","templatePath":"../x.md"}']) {
      expect(parseNewNoteSettings(stored)).toEqual(DEFAULT_NEW_NOTE_SETTINGS);
    }
  });
});
