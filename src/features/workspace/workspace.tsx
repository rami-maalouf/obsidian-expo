/**
 * the open vault's state, shared by the sidebar, the editor, and the calendar (t11). it keeps
 * the launch order of flow f2: restore vault access → resolve unsaved drafts → open today → write.
 */
import { createContext, type ReactNode, type RefObject, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBookmarks } from '@/features/bookmarks/use-bookmarks';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import type { DailyNoteSettings } from '@/features/daily-notes/settings';
import { createUntitledNote, folderOf } from '@/features/explorer/new-note';
import { useNoteList } from '@/features/explorer/use-note-list';
import { useDrafts } from '@/features/recovery/use-drafts';
import { useSearchIndex } from '@/features/search/use-search-index';
import type { CivilDate } from '@/features/templates/civil-time';
import { useCivilToday } from '@/features/today/use-civil-today';
import { dailyNotes, useTodayNote } from '@/features/today/use-today-note';
import { dailyNoteVault } from '@/features/vault/daily-note-vault';
import type { VaultInfo } from '@/features/vault/use-vault';

import { VaultNative } from '../../../modules/vault/src';

/** commands of the native split view (react-native-screens `SplitHostCommands`). */
export type SplitCommands = { show: (column: 'primary' | 'supplementary' | 'secondary') => void };

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
  const [calendarVisible, setCalendarVisible] = useState(false);
  /** true when the split view shows one column, as on iPhone or in a narrow iPad window. */
  const [collapsed, setCollapsed] = useState(false);
  const splitRef = useRef<SplitCommands | null>(null);
  const civilToday = useCivilToday();
  const search = useSearchIndex(vault.id);
  const notes = useNoteList(vault.id);
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
      if (collapsed) splitRef.current?.show('secondary');
    },
    [collapsed],
  );

  const selectDay = useCallback(
    async (date: CivilDate) => {
      if (!VaultNative) return;
      setSelectedDay(date);
      if (collapsed) setCalendarVisible(false);
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
    [collapsed, refreshNotes, settings, vault.id],
  );

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

  return {
    vault,
    settings,
    createNote,
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
    calendarVisible,
    setCalendarVisible,
    collapsed,
    setCollapsed,
    splitRef: splitRef as RefObject<SplitCommands | null>,
    open,
    selectDay,
    retryDay: () => (dayProblem ? selectDay(dayProblem.date) : today.retry()),
    continueToToday: () => setContinued(true),
    showSidebar: () => splitRef.current?.show('primary'),
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
