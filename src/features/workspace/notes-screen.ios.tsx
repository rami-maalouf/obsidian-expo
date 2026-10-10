/**
 * the note between the two side panels: drafts to recover first, then the open note (flow f2):
 * at launch, the note that was open last, or today's note. the note title is the native navigation title; it ends with "*" while edits wait
 * for a save, and a tap on it renames the note in a native prompt. the toolbar's left group opens
 * the files panel, goes back and forward through the opened notes, and opens today's note; the
 * right group opens the native "more" menu with bookmark, search, and the rest, then the calendar
 * panel at the trailing edge (t08). on a phone, forward appears only when there is a note ahead,
 * so the title keeps its room.
 */
import { Stack, useRouter } from 'expo-router';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { SystemColors } from '@/constants/theme';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { NoteEditor, type NoteEditorHandle, noteTitle } from '@/features/editor/note-editor';
import { UNSAVED_MARK } from '@/features/editor/status';
import { editableName, renamedPath, renameProblem } from '@/features/explorer/rename';
import { RecoveryList } from '@/features/recovery/recovery-list';

import { Busy, Notice } from './status-views';
import { useWorkspace } from './workspace';

export function NotesScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
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
  const editor = useRef<NoteEditorHandle>(null);
  const showForward = workspace.wide || workspace.canGoForward;

  /** the native rename prompt: the name without ".md", in the note's folder. */
  const rename = () => {
    if (!path || !editing) return;
    const from = path;
    Alert.prompt(
      'Rename Note',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rename', isPreferred: true, onPress: (typed?: string) => applyRename(from, typed ?? '') },
      ],
      'plain-text',
      editableName(from),
    );
  };
  const applyRename = async (from: string, typed: string) => {
    const next = renamedPath(from, typed);
    if (!next.ok) {
      Alert.alert("Can't Rename the Note", next.error);
      return;
    }
    if (next.value === null) return;
    const to = next.value;
    let problem: string | null;
    try {
      const outcome = editor.current ? await editor.current.rename(to) : null;
      problem = renameProblem(outcome, to);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem) {
      Alert.alert("Can't Rename the Note", problem);
    } else {
      workspace.noteRenamed(to);
    }
  };

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
        ref={editor}
        vaultId={workspace.vault.id}
        path={path}
        onSaved={workspace.onSaved}
        onShown={showFirstScreen}
        onRecoveryNeeded={workspace.onRecoveryNeeded}
        onOpenLink={workspace.openLink}
        onUnsavedChange={setUnsaved}
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
          headerTitle: editing ? () => <RenameTitle title={title} buttons={showForward ? 6 : 5} onPress={rename} /> : undefined,
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
          <Stack.Toolbar.MenuAction icon="pencil" hidden={!editing} onPress={rename}>
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

/** the width the title leaves for each toolbar button, and for the bar's margins. */
const TOOLBAR_BUTTON_WIDTH = 44;
const TOOLBAR_MARGINS = 64;

/**
 * the note's name as the navigation title, styled like the system title. a tap opens the rename
 * prompt; the width leaves room for the `buttons` toolbar buttons on both sides.
 */
function RenameTitle({ title, buttons, onPress }: { title: string; buttons: number; onPress: () => void }) {
  const { width } = useWindowDimensions();
  const reserved = TOOLBAR_MARGINS + buttons * TOOLBAR_BUTTON_WIDTH;
  return (
    <Pressable
      testID="note-title"
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Renames the note"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [{ maxWidth: Math.max(120, width - reserved) }, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.title, { color: SystemColors.label }]}>
        {title}
      </Text>
    </Pressable>
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

const styles = StyleSheet.create({
  // the system navigation title: 17 points, semibold.
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.5,
  },
});
