/**
 * the note between the two side panels on android: drafts to recover before today, then the
 * open note (flow f2). the note title is the app bar title; it ends with "*" while edits wait
 * for a save. the app bar's left side opens the files panel and today's note; the right side
 * has the overflow menu (bookmark, search, and the rest) and the calendar panel (t08). icons are
 * material symbols drawn by scripts/generate-android-icons.ts.
 */
import { Stack, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAndroidColors } from '@/constants/theme';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { NoteEditor, noteTitle } from '@/features/editor/note-editor';
import { UNSAVED_MARK } from '@/features/editor/status';
import { RecoveryList } from '@/features/recovery/recovery-list';

import { Busy, Notice } from './status-views';
import { useWorkspace } from './workspace';

const icons = {
  files: require('../../../assets/icons/android/left_panel_open.xml'),
  today: require('../../../assets/icons/android/today.xml'),
  more: require('../../../assets/icons/android/more_vert.xml'),
  calendar: require('../../../assets/icons/android/calendar_month.xml'),
  bookmarkAdd: require('../../../assets/icons/android/bookmark_add.xml'),
  bookmarkRemove: require('../../../assets/icons/android/bookmark_remove.xml'),
  search: require('../../../assets/icons/android/search.xml'),
  newNote: require('../../../assets/icons/android/edit_square.xml'),
  settings: require('../../../assets/icons/android/edit_calendar.xml'),
  vault: require('../../../assets/icons/android/folder_open.xml'),
};

export function NotesScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
  const palette = useAndroidColors();
  const insets = useSafeAreaInsets();
  const { path, drafts, needsRecovery, dayProblem, today, bookmarks, showFirstScreen } = workspace;
  const [unsaved, setUnsaved] = useState(false);
  const pending = drafts.drafts;
  // the recovery list or a problem is the first screen; the editor reports its own (onShown).
  const shownWithoutEditor = pending !== null && (needsRecovery || dayProblem !== null || (!path && today.state.phase === 'done'));
  useEffect(() => {
    if (shownWithoutEditor) showFirstScreen();
  }, [shownWithoutEditor, showFirstScreen]);
  const marked = path ? (bookmarks.list?.items.some((item) => item.path === path) ?? false) : false;
  const editing = Boolean(path) && pending !== null && !needsRecovery && !dayProblem;

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
    title = unsaved ? `${noteTitle(path)}${UNSAVED_MARK}` : noteTitle(path);
    content = (
      <NoteEditor
        key={path}
        vaultId={workspace.vault.id}
        path={path}
        onSaved={workspace.onSaved}
        onShown={showFirstScreen}
        onRecoveryNeeded={workspace.onRecoveryNeeded}
        onOpenLink={workspace.openLink}
        onUnsavedChange={setUnsaved}
      />
    );
  } else if (today.state.phase !== 'done') {
    content = <Busy label="Opening today's note" />;
  } else {
    content = <TodayProblem outcome={today.state.outcome} onRetry={workspace.retryDay} />;
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon={icons.files} accessibilityLabel="Files" onPress={() => workspace.setFilesOpen(!workspace.filesOpen)} />
        <Stack.Toolbar.Button icon={icons.today} accessibilityLabel="Open today's note" onPress={workspace.openToday} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={icons.more} accessibilityLabel="More">
          <Stack.Toolbar.MenuAction
            icon={marked ? icons.bookmarkRemove : icons.bookmarkAdd}
            hidden={!editing}
            onPress={() => path && (marked ? bookmarks.remove(path) : bookmarks.add(path))}>
            {marked ? 'Remove bookmark' : 'Bookmark this note'}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={icons.search} onPress={() => router.push('/search')}>
            Search
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={icons.newNote} onPress={() => workspace.createNote()}>
            New note
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={icons.settings} onPress={() => router.push('/settings')}>
            Daily note settings
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={icons.vault} onPress={workspace.chooseVault}>
            Choose another vault
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon={icons.calendar} accessibilityLabel="Calendar" onPress={() => workspace.setCalendarOpen(!workspace.calendarOpen)} />
      </Stack.Toolbar>
      {/* the note ends above the system's navigation bar; the editor keeps the keyboard clear itself. */}
      <View style={{ flex: 1, paddingBottom: insets.bottom, backgroundColor: palette.background }}>{content}</View>
    </>
  );
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
              ? `${outcome.path} is not on this device yet. Nothing was created.`
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
