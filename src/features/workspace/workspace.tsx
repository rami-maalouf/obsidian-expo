/**
 * the open vault's state, shared by the sidebar, the editor, and the calendar (t11). it keeps
 * the launch order of flow f2: restore vault access → resolve unsaved drafts → reopen the last
 * note, or open today → write. the vault scan and the search index wait until the first screen
 * is shown, so they do not compete with opening the first note.
 */
import { router } from 'expo-router';
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, useWindowDimensions } from 'react-native';

import { useBookmarks } from '@/features/bookmarks/use-bookmarks';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { type EditorSlot, nextEditorSlot } from '@/features/editor/editor-slot';
import type { DailyNoteSettings } from '@/features/daily-notes/settings';
import { createUntitledNote, linkedNotePath } from '@/features/explorer/new-note';
import { editableName } from '@/features/explorer/rename';
import { useNoteList } from '@/features/explorer/use-note-list';
import { stepTarget } from '@/features/navigation/history';
import {
  canReopen,
  launchCandidate,
  type LaunchCheck,
  type LaunchSettings,
  launchTarget,
  type LaunchTarget,
} from '@/features/navigation/launch';
import { useNavigationHistory } from '@/features/navigation/use-navigation-history';
import { newNoteContent, newNoteFolder, type NewNoteSettings } from '@/features/new-notes/settings';
import { useDrafts } from '@/features/recovery/use-drafts';
import { useSearchIndex } from '@/features/search/use-search-index';
import type { NoteSettings } from '@/features/settings/use-note-settings';
import { captureClock, type CivilDate } from '@/features/templates/civil-time';
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
  newNoteSettings: NewNoteSettings;
  launchSettings: LaunchSettings;
  saveSettings: (settings: NoteSettings) => Promise<void>;
  chooseVault: () => void;
  children: ReactNode;
};

function useWorkspaceState({
  vault,
  settings,
  newNoteSettings,
  launchSettings,
  saveSettings,
  chooseVault,
}: Omit<WorkspaceProps, 'children'>) {
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
  const navigation = useNavigationHistory(vault.id, notes.listing?.notes ?? null);
  const pending = drafts.drafts;
  const needsRecovery = pending !== null && pending.length > 0 && selected === null && !continued;

  // the first note is chosen once, with the settings at launch: a later change of the setting
  // never replaces the note on screen. the last note's file is checked while unsaved drafts are
  // still being read. "continue to today" from the recovery list opens today's note.
  const [launchSettingsAtStart] = useState(launchSettings);
  const [launchCheck, setLaunchCheck] = useState<LaunchCheck | null>(null);
  const [launchToday, setLaunchToday] = useState(false);
  const storedHistory = navigation.stored;
  const candidate = storedHistory ? launchCandidate(storedHistory, launchSettingsAtStart) : null;
  useEffect(() => {
    const native = VaultNative;
    if (!candidate || !native) return;
    let cancelled = false;
    native.fileState(vault.id, candidate).then(
      (state) => !cancelled && setLaunchCheck({ path: candidate, reopen: canReopen(state) }),
      () => !cancelled && setLaunchCheck({ path: candidate, reopen: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [candidate, vault.id]);
  const launch: LaunchTarget = launchToday ? { kind: 'today' } : launchTarget(launchSettingsAtStart, storedHistory, launchCheck);
  const deciding = launch.kind === 'deciding';

  const today = useTodayNote(vault.id, pending !== null && !needsRecovery && launch.kind === 'today', settings);
  const todayPath = today.state.phase === 'done' && today.state.outcome.kind === 'open' ? today.state.outcome.path : null;
  const path = selected ?? (launch.kind === 'note' ? launch.path : todayPath);
  const todayCreated = today.state.phase === 'done' && today.state.outcome.kind === 'open' && today.state.outcome.created;
  const searchIndex = search.phase === 'ready' ? search.index : null;
  const refreshNotes = notes.refresh;

  // a rename keeps the editor, which follows the file; any other note gets a new editor.
  const [renamedTo, setRenamedTo] = useState<string | null>(null);
  const [editorSlot, setEditorSlot] = useState<EditorSlot>({ path, key: 0 });
  const nextSlot = nextEditorSlot(editorSlot, path, renamedTo);
  if (nextSlot !== editorSlot) {
    setEditorSlot(nextSlot);
    setRenamedTo(null);
  }
  // the note on screen when a rename ends; the user may have opened another note meanwhile.
  const pathNow = useRef(path);
  useEffect(() => {
    pathNow.current = path;
  }, [path]);
  // a new note opens with its name selected above the text, ready to be typed over.
  const [newNote, setNewNote] = useState<string | null>(null);
  const newNoteShown = useCallback(() => setNewNote(null), []);

  // an opened note is searchable right away, even if discovery ran before it was created.
  useEffect(() => {
    if (path && searchIndex) searchIndex.refresh(path).catch(() => undefined);
  }, [path, searchIndex]);
  useEffect(() => {
    if (todayCreated) refreshNotes();
  }, [todayCreated, refreshNotes]);

  // the note on screen is always the history's current note: a newly shown note is recorded,
  // while back, forward, and rename move the history first, so recording them changes nothing.
  const shown = path && pending !== null && !needsRecovery && !dayProblem ? path : null;
  const historyLoaded = navigation.history !== null;
  const recordNote = navigation.record;
  useEffect(() => {
    if (shown && historyLoaded) recordNote(shown);
  }, [shown, historyLoaded, recordNote]);

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

  /**
   * shows the previous (-1) or next (1) note in the history, skipping notes that the listing no
   * longer has. it works only while a note is on screen, so it never skips unsaved-edit recovery.
   */
  const stepHistory = navigation.step;
  const go = useCallback(
    (direction: -1 | 1) => {
      if (!shown) return;
      const target = stepHistory(direction, knownPaths);
      if (!target) return;
      // like opening a note, this wins over a daily-note request that is still running (r15).
      dailyNotes.navigateAway();
      setSelected(target);
      setDayProblem(null);
    },
    [knownPaths, shown, stepHistory],
  );
  const goBack = useCallback(() => go(-1), [go]);
  const goForward = useCallback(() => go(1), [go]);
  const canGoBack = shown !== null && navigation.history !== null && stepTarget(navigation.history, -1, knownPaths) !== null;
  const canGoForward = shown !== null && navigation.history !== null && stepTarget(navigation.history, 1, knownPaths) !== null;

  /**
   * creates "Untitled.md" (or the next free number) where the new-note settings say, from their
   * template, and opens it. the template is read and checked before anything is created.
   * returns null on success, or what went wrong.
   */
  const createNote = useCallback(async (): Promise<string | null> => {
    const native = VaultNative;
    if (!native) return 'Notes can be created only in the iPhone, iPad, and Android apps.';
    let template: string | null = null;
    if (newNoteSettings.templatePath) {
      const read = await native.readText(vault.id, newNoteSettings.templatePath).catch(() => null);
      if (read?.kind !== 'text') return `The new-note template ${newNoteSettings.templatePath} can't be read. Nothing was created.`;
      template = read.text;
    }
    const now = captureClock();
    const checked = newNoteContent(template, 'Untitled', now);
    if (!checked.ok) return `The new-note template has a problem. Nothing was created. ${checked.error.message}`;
    const created = await createUntitledNote(newNoteFolder(newNoteSettings, path), async (notePath) => {
      const content = newNoteContent(template, editableName(notePath), now);
      if (!content.ok) return 'failed';
      const result = await native.createExclusive(vault.id, notePath, content.value);
      return result.kind === 'created' ? 'created' : result.kind === 'exists' ? 'exists' : 'failed';
    });
    if (!created) return 'The note could not be created.';
    refreshNotes();
    setNewNote(created);
    open(created);
    return null;
  }, [newNoteSettings, open, path, refreshNotes, vault.id]);

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

  /**
   * records that the editor renamed the note at `from` to `to`. the history renames the note at
   * once, so back and forward reach it at its new path, and the new listing removes the old path
   * from search and moves its bookmark, which follows the file's identity. the note stays on
   * screen at its new path in the same editor, unless another note was opened meanwhile.
   */
  const renameInHistory = navigation.rename;
  const noteRenamed = useCallback(
    (from: string, to: string) => {
      renameInHistory(from, to);
      refreshNotes();
      if (pathNow.current !== from) return;
      dailyNotes.navigateAway();
      setRenamedTo(to);
      setSelected(to);
      setDayProblem(null);
    },
    [refreshNotes, renameInHistory],
  );

  // the ipad menu bar runs the same actions as the toolbar (ios/MainMenu.swift).
  useEffect(() => {
    const subscription = VaultNative?.addListener('onMenuCommand', ({ command }) => {
      switch (command) {
        case 'new-note':
          createNote().then((problem) => problem && Alert.alert("Can't Create a Note", problem));
          break;
        case 'today':
          openToday();
          break;
        case 'back':
          goBack();
          break;
        case 'forward':
          goForward();
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
  }, [createNote, goBack, goForward, openToday]);

  return {
    vault,
    settings,
    newNoteSettings,
    launchSettings,
    launching: deciding,
    createNote,
    openLink,
    noteRenamed,
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
    editorKey: nextSlot.key,
    newNote,
    newNoteShown,
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
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    showFirstScreen,
    retryDay: () => (dayProblem ? selectDay(dayProblem.date) : today.retry()),
    continueToToday: () => {
      setContinued(true);
      setLaunchToday(true);
    },
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
