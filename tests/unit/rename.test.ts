import { describe, expect, test } from 'bun:test';

import { editableName, renamedPath, renameProblem } from '@/features/explorer/rename';

describe('rename field', () => {
  test('shows the name without its folder or ".md"', () => {
    expect(editableName('Daily/2026-10-09.md')).toBe('2026-10-09');
    expect(editableName('Welcome.md')).toBe('Welcome');
    expect(editableName('Notes/Read.ME.md')).toBe('Read.ME');
    expect(editableName('Notes/Upper.MD')).toBe('Upper');
  });
});

describe('renamed path', () => {
  test('keeps the note in its folder and adds ".md"', () => {
    expect(renamedPath('Projects/Untitled.md', 'Launch plan')).toEqual({ ok: true, value: 'Projects/Launch plan.md' });
    expect(renamedPath('Untitled.md', 'Ideas')).toEqual({ ok: true, value: 'Ideas.md' });
  });

  test('a typed ".md" and surrounding spaces are not part of the name', () => {
    expect(renamedPath('Untitled.md', '  Ideas.md ')).toEqual({ ok: true, value: 'Ideas.md' });
    expect(renamedPath('Untitled.md', 'Ideas.MD')).toEqual({ ok: true, value: 'Ideas.md' });
  });

  test('the same name is no change, but a change of case is a rename', () => {
    expect(renamedPath('Notes/Plan.md', 'Plan')).toEqual({ ok: true, value: null });
    expect(renamedPath('Notes/Plan.md', ' Plan.md ')).toEqual({ ok: true, value: null });
    expect(renamedPath('Notes/plan.md', 'Plan')).toEqual({ ok: true, value: 'Notes/Plan.md' });
  });

  test('empty names, folders, hidden names, and refused characters are errors', () => {
    expect(renamedPath('Untitled.md', '   ')).toEqual({ ok: false, error: 'Enter a name.' });
    expect(renamedPath('Untitled.md', '.md')).toEqual({ ok: false, error: 'Enter a name.' });
    expect(renamedPath('Untitled.md', 'Inbox/Idea')).toEqual({ ok: false, error: 'A note name can\'t contain "/".' });
    for (const name of ['.hidden', 'What?', 'a:b', 'pipe|name', 'quote"name']) {
      const result = renamedPath('Untitled.md', name);
      expect(result.ok).toBe(false);
    }
  });
});

describe('rename messages', () => {
  test('a moved note needs no message; every other outcome explains itself', () => {
    expect(renameProblem({ kind: 'moved' }, 'Notes/Plan.md')).toBeNull();
    expect(renameProblem({ kind: 'exists' }, 'Notes/Plan.md')).toBe('A note named "Plan" already exists in this folder.');
    expect(renameProblem({ kind: 'missing' }, 'Plan.md')).toBe('The note was moved or deleted outside the app.');
    expect(renameProblem({ kind: 'unsaved' }, 'Plan.md')).toContain('not renamed');
    expect(renameProblem({ kind: 'unavailable' }, 'Plan.md')).toBe('The note is not available right now.');
    expect(renameProblem(null, 'Plan.md')).toBe('Open the note to rename it.');
  });
});
