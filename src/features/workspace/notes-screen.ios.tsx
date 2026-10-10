/**
 * the note between the two side panels: drafts to recover first, then the open note (flow f2):
 * at launch, the note that was open last, or today's note. the note's name is above its text, in
 * the editor's scroll view, as obsidian's inline title; editing it renames the note, and "rename
 * note" in the menu puts the caret there. the navigation bar has no title while a note is open.
 * the toolbar's left group opens the files panel, goes back and forward through the opened notes,
 * and opens today's note; the right group opens the native "more" menu with bookmark, search, and
 * the rest, then the calendar panel at the trailing edge (t08). on a phone, forward appears only
 * when there is a note ahead. the navigation bar is see-through: the note scrolls under it, and
 * liquid glass's soft scroll edge effect fades the text out below the bar.
 */
import { Stack, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { NoteEditor, type NoteEditorHandle } from '@/features/editor/note-editor';
import { useTitleRename } from '@/features/editor/use-title-rename';
import { RecoveryList } from '@/features/recovery/recovery-list';

import { Busy, Notice } from './status-views';
import { useWorkspace } from './workspace';

export function NotesScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
  const { path, drafts, needsRecovery, dayProblem, today, bookmarks, showFirstScreen } = workspace;
  const pending = drafts.drafts;
  // the recovery list or a problem is the first screen; the editor reports its own (onShown).
  const shownWithoutEditor = pending !== null && (needsRecovery || dayProblem !== null || (!path && today.state.phase === 'done'));
  useEffect(() => {
    if (shownWithoutEditor) showFirstScreen();
  }, [shownWithoutEditor, showFirstScreen]);
  const marked = path ? (bookmarks.list?.items.some((item) => item.path === path) ?? false) : false;
  const editing = Boolean(path) && pending !== null && !needsRecovery && !dayProblem;
  const editor = useRef<NoteEditorHandle>(null);
  const headerHeight = useHeaderHeight();
  const showForward = workspace.wide || workspace.canGoForward;
  const renameFromTitle = useTitleRename(editor, "Can't Rename the Note", workspace.noteRenamed);

  let title = 'Today';
  let content: ReactNode;
  if (pending === null) {
    content = <Busy label="Checking for unsaved edits" />;
  } else if (needsRecovery) {
    title = 'Unsaved edits';
    content = (
      <RecoveryList
        drafts={pending}
        error={drafts.error}
        conflicted={workspace.conflicted}
        onOpen={(draft) => workspace.open(draft.path)}
        onKeepBoth={async (draft) => {
          await drafts.keepBoth(draft);
          workspace.notes.refresh();
        }}
        onDiscard={drafts.discard}
        onContinue={workspace.continueToToday}
      />
    );
  } else if (dayProblem) {
    content = <TodayProblem outcome={dayProblem.outcome} onRetry={workspace.retryDay} />;
  } else if (path) {
    // the name is above the text, so the bar keeps only its buttons.
    title = '';
    content = (
      <NoteEditor
        key={workspace.editorKey}
        ref={editor}
        vaultId={workspace.vault.id}
        path={path}
        onSaved={workspace.onSaved}
        onShown={showFirstScreen}
        onRecoveryNeeded={workspace.onRecoveryNeeded}
        onOpenLink={workspace.openLink}
        onTitleSubmit={(typed) => renameFromTitle(path, typed)}
        selectTitleOnLoad={path === workspace.newNote}
        onTitleSelected={workspace.newNoteShown}
        headerInset={headerHeight}
      />
    );
  } else if (workspace.launching) {
    content = <Busy label="Opening the last note" />;
  } else if (today.state.phase !== 'done') {
    content = <Busy label="Opening today's note" />;
  } else {
    content = <TodayProblem outcome={today.state.outcome} onRetry={workspace.retryDay} />;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          // the native text view and the swiftui status views inset themselves below the bar.
          // the editor sets its own soft scroll edge effect (VaultEditorView.swift).
          headerTransparent: true,
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="sidebar.left"
          accessibilityLabel="Files"
          selected={workspace.wide && workspace.filesOpen}
          onPress={() => workspace.setFilesOpen(!workspace.filesOpen)}
        />
        <Stack.Toolbar.Button
          icon="chevron.backward"
          accessibilityLabel="Back"
          accessibilityHint="Opens the previous note"
          disabled={!workspace.canGoBack}
          onPress={workspace.goBack}
        />
        <Stack.Toolbar.Button
          icon="chevron.forward"
          accessibilityLabel="Forward"
          accessibilityHint="Opens the next note"
          hidden={!showForward}
          disabled={!workspace.canGoForward}
          onPress={workspace.goForward}
        />
        {/* today's day number on a calendar page, like the calendar app's icon. */}
        <Stack.Toolbar.Button icon={todayIcon(workspace.civilToday.day)} accessibilityLabel="Open today's note" onPress={workspace.openToday} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction
            icon={marked ? 'bookmark.slash' : 'bookmark'}
            hidden={!editing}
            onPress={() => path && (marked ? bookmarks.remove(path) : bookmarks.add(path))}>
            {marked ? 'Remove bookmark' : 'Bookmark this note'}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="pencil" hidden={!editing} onPress={() => editor.current?.focusTitle()}>
            Rename note
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="magnifyingglass" onPress={() => router.push('/search')}>
            Search
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="square.and.pencil"
            onPress={() => workspace.createNote().then((problem) => problem && Alert.alert("Can't Create a Note", problem))}>
            New note
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push('/settings')}>
            Note settings
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="folder" onPress={workspace.chooseVault}>
            Choose another vault
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          icon="calendar"
          accessibilityLabel="Calendar"
          selected={workspace.calendarOpen}
          onPress={() => workspace.setCalendarOpen(!workspace.calendarOpen)}
        />
      </Stack.Toolbar>
      {content}
    </>
  );
}

/** sf symbols has a calendar page for every day of the month: 1.calendar to 31.calendar. */
type ToolbarIcon = ComponentProps<typeof Stack.Toolbar.Button>['icon'];

function todayIcon(day: number): ToolbarIcon {
  return `${day}.calendar` as ToolbarIcon;
}

function TodayProblem({ outcome, onRetry }: { outcome: DailyNoteOutcome; onRetry: () => void }) {
  const retry = { title: 'Try Again', onPress: onRetry };
  switch (outcome.kind) {
    case 'unavailable':
      return (
        <Notice
          title="This note isn't available yet"
          systemImage="icloud.and.arrow.down"
          description={
            outcome.state === 'placeholder'
              ? `${outcome.path} is in iCloud and has not downloaded. Nothing was created.`
              : `${outcome.path} could not be checked. Nothing was created.`
          }
          detail={outcome.reason}
          action={retry}
        />
      );
    case 'template-error':
      return (
        <Notice
          title="The daily template has a problem"
          systemImage="exclamationmark.triangle"
          description={`Nothing was created. ${outcome.error.message}`}
          detail={outcome.error.tag}
          action={retry}
        />
      );
    case 'template-unavailable':
      return <Notice title="The daily template can't be read" systemImage="doc.questionmark" description={outcome.reason} action={retry} />;
    case 'failed':
      return <Notice title="The note couldn't be opened" systemImage="exclamationmark.triangle" description={outcome.reason} action={retry} />;
    case 'cancelled':
    case 'open':
      return <Busy label="Opening the note" />;
  }
}
