/**
 * the open vault's state, shared by the sidebar, the editor, and the calendar (t11). it keeps
 * the launch order of flow f2: restore vault access → resolve unsaved drafts → open today → write.
 * the vault scan and the search index wait until the first screen is shown, so they do not
 * compete with opening today's note.
 */
import { router } from 'expo-router';
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { useBookmarks } from '@/features/bookmarks/use-bookmarks';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import type { DailyNoteSettings } from '@/features/daily-notes/settings';
import { createUntitledNote, folderOf, linkedNotePath } from '@/features/explorer/new-note';
import { useNoteList } from '@/features/explorer/use-note-list';
import { useDrafts } from '@/features/recovery/use-drafts';
import { useSearchIndex } from '@/features/search/use-search-index';
import type { CivilDate } from '@/features/templates/civil-time';
import { useCivilToday } from '@/features/today/use-civil-today';
import { dailyNotes, useTodayNote } from '@/features/today/use-today-note';
import { dailyNoteVault } from '@/features/vault/daily-note-vault';
import type { VaultInfo } from '@/features/vault/use-vault';

import { VaultNative } from '../../../modules/vault/src';
import { revealApp } from './launch-screen';

/** at this width and wider the side panels can stay pinned beside the note (t08). */
export const PINNED_PANELS_WIDTH = 768;

/**
 * background work starts this long after the workspace opens at the latest, even when the first
 * note is slow to open, for example while icloud downloads it.
 */
export const BACKGROUND_START_LIMIT_MS = 1000;

type WorkspaceProps = {
  vault: VaultInfo;
  settings: DailyNoteSettings;
  saveSettings: (settings: DailyNoteSettings) => Promise<void>;
  chooseVault: () => void;
  children: ReactNode;
};

function useWorkspaceState({ vault, settings, saveSettings, chooseVault }: Omit<WorkspaceProps, 'children'>) {
  const drafts = useDrafts(vault.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<CivilDate | null>(null);
  const [dayProblem, setDayProblem] = useState<{ date: CivilDate; outcome: DailyNoteOutcome } | null>(null);
  const [continued, setContinued] = useState(false);
  const [conflicted, setConflicted] = useState<ReadonlySet<string>>(new Set());
  const { width } = useWindowDimensions();
  /** on a wide screen the panels sit beside the note; otherwise they slide over it. */
  const wide = width >= PINNED_PANELS_WIDTH;
  const [filesOpen, setFilesOpen] = useState(wide);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const civilToday = useCivilToday();
  // the note, the recovery list, or a problem is on screen: the launch is over.
  const [firstScreenShown, setFirstScreenShown] = useState(false);
  const showFirstScreen = useCallback(() => {
    setFirstScreenShown(true);
    revealApp();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setFirstScreenShown(true), BACKGROUND_START_LIMIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const notes = useNoteList(vault.id, firstScreenShown);
  const search = useSearchIndex(vault.id, notes.listing);
  const bookmarks = useBookmarks(vault.id, notes.listing?.notes ?? null);
  const knownPaths = useMemo(() => (notes.listing ? new Set(notes.listing.notes.map((note) => note.path)) : null), [notes.listing]);
  const pending = drafts.drafts;
  const needsRecovery = pending !== null && pending.length > 0 && selected === null && !continued;
  const today = useTodayNote(vault.id, pending !== null && !needsRecovery, settings);
  const path = selected ?? (today.state.phase === 'done' && today.state.outcome.kind === 'open' ? today.state.outcome.path : null);
  const todayCreated = today.state.phase === 'done' && today.state.outcome.kind === 'open' && today.state.outcome.created;
  const searchIndex = search.phase === 'ready' ? search.index : null;
  const refreshNotes = notes.refresh;

  // an opened note is searchable right away, even if discovery ran before it was created.
  useEffect(() => {
    if (path && searchIndex) searchIndex.refresh(path).catch(() => undefined);
  }, [path, searchIndex]);
  useEffect(() => {
    if (todayCreated) refreshNotes();
  }, [todayCreated, refreshNotes]);

  const open = useCallback(
    (next: string) => {
      // a deliberate choice wins over a daily-note request that is still running (r15).
      dailyNotes.navigateAway();
      setSelected(next);
      setDayProblem(null);
      // on a phone the panel slid over the note; choosing a note brings the note back.
      if (!wide) setFilesOpen(false);
    },
    [wide],
  );

  const selectDay = useCallback(
    async (date: CivilDate) => {
      if (!VaultNative) return;
      setSelectedDay(date);
      if (!wide) setCalendarOpen(false);
      const result = await dailyNotes.open(dailyNoteVault(VaultNative, vault.id), date, settings);
      if (!result.current) return;
      if (result.outcome.kind === 'open') {
        setSelected(result.outcome.path);
        setDayProblem(null);
        if (result.outcome.created) refreshNotes();
      } else {
        setDayProblem({ date, outcome: result.outcome });
      }
    },
    [refreshNotes, settings, vault.id, wide],
  );

  const openToday = useCallback(() => selectDay(civilToday), [civilToday, selectDay]);

  /** creates "Untitled.md" (or the next free number) beside the open note and opens it. */
  const createNote = useCallback(async (): Promise<boolean> => {
    const native = VaultNative;
    if (!native) return false;
    const created = await createUntitledNote(folderOf(path), async (notePath) => {
      const result = await native.createExclusive(vault.id, notePath, '');
      return result.kind === 'created' ? 'created' : result.kind === 'exists' ? 'exists' : 'failed';
    });
    if (!created) return false;
    refreshNotes();
    open(created);
    return true;
  }, [open, path, refreshNotes, vault.id]);

  /**
   * opens the note a tapped wikilink names. with no matching note, it creates the note, as
   * obsidian does: beside the open note, or at the link's vault path. creation is exclusive, so
   * a file made since the last listing is opened, never replaced.
   */
  const openLink = useCallback(
    async (target: string, resolved: string | null): Promise<boolean> => {
      if (resolved) {
        open(resolved);
        return true;
      }
      const native = VaultNative;
      const notePath = linkedNotePath(target, path);
      if (!native || !notePath || native.checkRelativePath(notePath) !== null) return false;
      const result = await native.createExclusive(vault.id, notePath, '');
      if (result.kind === 'unavailable') return false;
      refreshNotes();
      open(notePath);
      return true;
    },
    [open, path, refreshNotes, vault.id],
  );

  // the ipad menu bar runs the same actions as the toolbar (ios/MainMenu.swift).
  useEffect(() => {
    const subscription = VaultNative?.addListener('onMenuCommand', ({ command }) => {
      switch (command) {
        case 'new-note':
          createNote();
          break;
        case 'today':
          openToday();
          break;
        case 'search':
          router.push('/search');
          break;
        case 'settings':
          router.push('/settings');
          break;
        case 'toggle-files':
          setFilesOpen((open) => !open);
          break;
        case 'toggle-calendar':
          setCalendarOpen((open) => !open);
          break;
      }
    });
    return () => subscription?.remove();
  }, [createNote, openToday]);

  return {
    vault,
    settings,
    createNote,
    openLink,
    saveSettings,
    chooseVault,
    drafts,
    notes,
    knownPaths,
    bookmarks,
    search,
    today,
    civilToday,
    path,
    selectedDay,
    dayProblem,
    needsRecovery,
    conflicted,
    wide,
    filesOpen,
    setFilesOpen,
    calendarOpen,
    setCalendarOpen,
    open,
    selectDay,
    openToday,
    showFirstScreen,
    retryDay: () => (dayProblem ? selectDay(dayProblem.date) : today.retry()),
    continueToToday: () => setContinued(true),
    onSaved: (saved: string) => {
      if (searchIndex) searchIndex.refresh(saved).catch(() => undefined);
    },
    onRecoveryNeeded: (conflictPath: string) => {
      setConflicted((current) => new Set(current).add(conflictPath));
      setSelected(null);
      setContinued(false);
      drafts.refresh();
    },
  };
}

export type Workspace = ReturnType<typeof useWorkspaceState>;

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children, ...props }: WorkspaceProps) {
  const workspace = useWorkspaceState(props);
  return <WorkspaceContext value={workspace}>{children}</WorkspaceContext>;
}

export function useWorkspace(): Workspace {
  const workspace = use(WorkspaceContext);
  if (!workspace) {
    throw new Error('useWorkspace needs a WorkspaceProvider');
  }
  return workspace;
}

/** for screens that may render before a vault is open, such as on web. */
export function useOptionalWorkspace(): Workspace | null {
  return use(WorkspaceContext);
}
