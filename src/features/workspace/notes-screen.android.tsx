/**
 * the note between the two side panels on android: drafts to recover first, then the open note
 * (flow f2): at launch, the note that was open last, or today's note. the note's name is above its
 * text, in the editor's scroll view, as obsidian's inline title; editing it renames the note, and
 * "Rename note" in the overflow menu puts the caret there. the app bar has no title while a note
 * is open. the app bar's left side opens the files panel and today's note; the right side has the
 * overflow menu (bookmark, rename, and the rest) and the calendar panel (t08). a floating toolbar
 * at the bottom has back and forward through the opened notes on its left and search and a new
 * note on its right; like safari's bar, it slides away while the note scrolls toward its end and
 * comes back when it scrolls back (VaultEditorView.kt). android's back gesture also goes back
 * through the opened notes. icons are material symbols drawn by
 * scripts/generate-android-icons.ts. the app bar has no shadow and takes the surface color while
 * the note is scrolled from its top, as material 3's top app bar does.
 */
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  StyleSheet,
  useAnimatedValue,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Accent, useAndroidColors } from '@/constants/theme';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { NoteEditor, type NoteEditorHandle } from '@/features/editor/note-editor';
import { useTitleRename } from '@/features/editor/use-title-rename';
import { RecoveryList } from '@/features/recovery/recovery-list';

import { Busy, Notice } from './status-views';
import { useWorkspace } from './workspace';

const icons = {
  back: require('../../../assets/icons/android/arrow_back.xml'),
  forward: require('../../../assets/icons/android/arrow_forward.xml'),
  files: require('../../../assets/icons/android/left_panel_open.xml'),
  today: require('../../../assets/icons/android/today.xml'),
  more: require('../../../assets/icons/android/more_vert.xml'),
  calendar: require('../../../assets/icons/android/calendar_month.xml'),
  bookmarkAdd: require('../../../assets/icons/android/bookmark_add.xml'),
  bookmarkRemove: require('../../../assets/icons/android/bookmark_remove.xml'),
  search: require('../../../assets/icons/android/search.xml'),
  newNote: require('../../../assets/icons/android/edit_square.xml'),
  rename: require('../../../assets/icons/android/drive_file_rename_outline.xml'),
  settings: require('../../../assets/icons/android/settings.xml'),
  vault: require('../../../assets/icons/android/folder_open.xml'),
};

export function NotesScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
  const palette = useAndroidColors();
  const insets = useSafeAreaInsets();
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
  // the open note's text is scrolled from its top; the editor reports it.
  const [scrolled, setScrolled] = useState(false);
  const lifted = editing && scrolled;
  // the bottom toolbar slides down below the screen's edge while the editor asks for it.
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const toolbarOffset = useAnimatedValue(0);
  useEffect(() => {
    Animated.timing(toolbarOffset, {
      toValue: toolbarHidden ? TOOLBAR_HEIGHT + TOOLBAR_MARGIN + insets.bottom + 8 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [toolbarHidden, toolbarOffset, insets.bottom]);

  // the back gesture first closes a panel that covers the note, then goes back through the opened
  // notes; with nothing to go back to, android handles it as before. it applies only while this
  // screen is on top, so search and settings close as usual.
  const { wide, filesOpen, calendarOpen, setFilesOpen, setCalendarOpen, canGoBack, goBack } = workspace;
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!wide && filesOpen) {
          setFilesOpen(false);
          return true;
        }
        if (!wide && calendarOpen) {
          setCalendarOpen(false);
          return true;
        }
        if (!canGoBack) return false;
        goBack();
        return true;
      });
      return () => subscription.remove();
    }, [wide, filesOpen, calendarOpen, setFilesOpen, setCalendarOpen, canGoBack, goBack]),
  );

  const renameFromTitle = useTitleRename(editor, "Can't rename the note", (from, to) => {
    // android lists notes without a file identity that a bookmark could follow, so the app moves
    // the bookmark of the note it renamed itself.
    if (bookmarks.list?.items.some((item) => item.path === from)) bookmarks.move(from, to);
    workspace.noteRenamed(from, to);
  });

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
    // the name is above the text, so the app bar keeps only its buttons.
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
        onScrolledChange={setScrolled}
        onToolbarHiddenChange={setToolbarHidden}
        bottomInset={TOOLBAR_HEIGHT + TOOLBAR_MARGIN}
        onTitleSubmit={(typed) => renameFromTitle(path, typed)}
        selectTitleOnLoad={path === workspace.newNote}
        onTitleSelected={workspace.newNoteShown}
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
          headerShadowVisible: false,
          headerStyle: { backgroundColor: lifted ? palette.surface : palette.background },
        }}
      />
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
          <Stack.Toolbar.MenuAction icon={icons.rename} hidden={!editing} onPress={() => editor.current?.focusTitle()}>
            Rename note
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={icons.settings} onPress={() => router.push('/settings')}>
            Note settings
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={icons.vault} onPress={workspace.chooseVault}>
            Choose another vault
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon={icons.calendar} accessibilityLabel="Calendar" onPress={() => workspace.setCalendarOpen(!workspace.calendarOpen)} />
      </Stack.Toolbar>
      {/* the note ends above the system's navigation bar and scrolls under the toolbar; the editor
          keeps the keyboard clear itself. other content ends above the toolbar. */}
      <View
        style={{ flex: 1, paddingBottom: insets.bottom + (editing ? 0 : TOOLBAR_HEIGHT + TOOLBAR_MARGIN), backgroundColor: palette.background }}>
        {content}
      </View>
      {/* expo router draws the toolbar with compose at the bottom of this layer, above the
          system's navigation bar. it stays behind the keyboard, which covers it while typing. */}
      <Animated.View pointerEvents="box-none" style={[styles.toolbarLayer, { transform: [{ translateY: toolbarOffset }] }]}>
        <Stack.Toolbar placement="bottom" disableImePadding tintColor={Accent} backgroundColor={palette.surface}>
          <Stack.Toolbar.Button
            icon={icons.back}
            accessibilityLabel="Back"
            disabled={!workspace.canGoBack}
            tintColor={workspace.canGoBack ? Accent : palette.disabled}
            onPress={workspace.goBack}
          />
          <Stack.Toolbar.Button
            icon={icons.forward}
            accessibilityLabel="Forward"
            disabled={!workspace.canGoForward}
            tintColor={workspace.canGoForward ? Accent : palette.disabled}
            onPress={workspace.goForward}
          />
          <Stack.Toolbar.Spacer width={TOOLBAR_GAP} />
          <Stack.Toolbar.Button icon={icons.search} accessibilityLabel="Search" onPress={() => router.push('/search')} />
          <Stack.Toolbar.Button
            icon={icons.newNote}
            accessibilityLabel="New note"
            onPress={() => workspace.createNote().then((problem) => problem && Alert.alert("Can't create a note", problem))}
          />
        </Stack.Toolbar>
      </Animated.View>
    </>
  );
}

/** expo router's floating toolbar is 64 dp tall; it floats 16 dp above the navigation bar, as material 3 places it. */
const TOOLBAR_HEIGHT = 64;
const TOOLBAR_MARGIN = 16;
/** the space between back and forward on the left and search and new note on the right. */
const TOOLBAR_GAP = 48;

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

const styles = StyleSheet.create({
  toolbarLayer: {
    ...StyleSheet.absoluteFill,
    bottom: TOOLBAR_MARGIN,
  },
});
