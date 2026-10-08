/**
 * the note between the two side panels: drafts to recover before today, then the open note
 * (flow f2). the note title is the native navigation title. the toolbar's left group opens the
 * files panel and today's note; the right group opens the calendar panel and the native
 * "more" menu with bookmark, search, and the rest (t08).
 */
import { Stack, useRouter } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';

import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { NoteEditor, noteTitle } from '@/features/editor/note-editor';
import { RecoveryList } from '@/features/recovery/recovery-list';

import { Busy, Notice } from './status-views';
import { useWorkspace } from './workspace';

export function NotesScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
  const { path, drafts, needsRecovery, dayProblem, today, bookmarks } = workspace;
  const pending = drafts.drafts;
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
    title = noteTitle(path);
    content = (
      <NoteEditor
        key={path}
        vaultId={workspace.vault.id}
        path={path}
        onSaved={workspace.onSaved}
        onRecoveryNeeded={workspace.onRecoveryNeeded}
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
        <Stack.Toolbar.Button
          icon="sidebar.left"
          accessibilityLabel="Files"
          selected={workspace.wide && workspace.filesOpen}
          onPress={() => workspace.setFilesOpen(!workspace.filesOpen)}
        />
        {/* today's day number on a calendar page, like the calendar app's icon. */}
        <Stack.Toolbar.Button icon={todayIcon(workspace.civilToday.day)} accessibilityLabel="Open today's note" onPress={workspace.openToday} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="calendar"
          accessibilityLabel="Calendar"
          selected={workspace.calendarOpen}
          onPress={() => workspace.setCalendarOpen(!workspace.calendarOpen)}
        />
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction
            icon={marked ? 'bookmark.slash' : 'bookmark'}
            hidden={!editing}
            onPress={() => path && (marked ? bookmarks.remove(path) : bookmarks.add(path))}>
            {marked ? 'Remove bookmark' : 'Bookmark this note'}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="magnifyingglass" onPress={() => router.push('/search')}>
            Search
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="square.and.pencil" onPress={() => workspace.createNote()}>
            New note
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="calendar.badge.clock" onPress={() => router.push('/settings')}>
            Daily note settings
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="folder" onPress={workspace.chooseVault}>
            Choose another vault
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
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
