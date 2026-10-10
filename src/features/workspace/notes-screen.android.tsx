/**
 * the note between the two side panels on android: drafts to recover first, then the open note
 * (flow f2): at launch, the note that was open last, or today's note. the note title is the app bar title; it ends with "*" while edits wait
 * for a save, and a tap on it renames the note in a dialog, as does "Rename note" in the
 * overflow menu. the app bar's left side opens the files panel and today's note; the right side
 * has the overflow menu (bookmark, rename, and the rest) and the calendar panel (t08). a floating
 * toolbar at the bottom has back and forward through the opened notes on its left and search and
 * a new note on its right; like safari's bar, it slides away while the note scrolls toward its
 * end and comes back when it scrolls back (VaultEditorView.kt). android's back gesture also goes
 * back through the opened notes. icons are material symbols drawn by
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
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useAnimatedValue,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Accent, useAndroidColors } from '@/constants/theme';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { NoteEditor, type NoteEditorHandle, noteTitle } from '@/features/editor/note-editor';
import { UNSAVED_MARK } from '@/features/editor/status';
import { editableName, renamedPath, renameProblem } from '@/features/explorer/rename';
import { RecoveryList } from '@/features/recovery/recovery-list';

import { Button } from './android-ui';
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
  // the open note's text is scrolled from its top; the editor reports it.
  const [scrolled, setScrolled] = useState(false);
  const lifted = editing && scrolled;
  // the note the rename dialog is open for, or null.
  const [renaming, setRenaming] = useState<string | null>(null);
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
  // screen is on top, so search and settings close as usual, and the rename dialog handles its own.
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

  const rename = () => {
    if (path && editing) setRenaming(path);
  };
  /** renames the note from the dialog; returns what went wrong, or null when the dialog can close. */
  const applyRename = async (from: string, typed: string): Promise<string | null> => {
    const next = renamedPath(from, typed);
    if (!next.ok) return next.error;
    if (next.value === null) return null;
    const to = next.value;
    let problem: string | null;
    try {
      const outcome = editor.current ? await editor.current.rename(to) : null;
      problem = renameProblem(outcome, to);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem) return problem;
    // android lists notes without a file identity that a bookmark could follow, so the app moves
    // the bookmark of the note it renamed itself.
    if (bookmarks.list?.items.some((item) => item.path === from)) bookmarks.move(from, to);
    workspace.noteRenamed(to);
    return null;
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
        onScrolledChange={setScrolled}
        onToolbarHiddenChange={setToolbarHidden}
        bottomInset={TOOLBAR_HEIGHT + TOOLBAR_MARGIN}
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
          headerTitle: editing ? () => <RenameTitle title={title} onPress={rename} /> : undefined,
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
          <Stack.Toolbar.MenuAction icon={icons.rename} hidden={!editing} onPress={rename}>
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
      {renaming ? <RenameDialog key={renaming} from={renaming} onRename={applyRename} onClose={() => setRenaming(null)} /> : null}
    </>
  );
}

/** expo router's floating toolbar is 64 dp tall; it floats 16 dp above the navigation bar, as material 3 places it. */
const TOOLBAR_HEIGHT = 64;
const TOOLBAR_MARGIN = 16;
/** the space between back and forward on the left and search and new note on the right. */
const TOOLBAR_GAP = 48;

/**
 * the note's name as the app bar title, in the style of the system title. a tap opens the rename
 * dialog; the width leaves room for the app bar's buttons on both sides.
 */
function RenameTitle({ title, onPress }: { title: string; onPress: () => void }) {
  const palette = useAndroidColors();
  const { width } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Renames the note"
      hitSlop={8}
      onPress={onPress}
      android_ripple={{ color: palette.accentSoft }}
      style={[styles.titleButton, { maxWidth: Math.max(120, width - 232) }]}>
      <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * the rename dialog: the name without ".md", in the note's folder. a problem shows under the
 * field and keeps the dialog open, so the name can be corrected.
 */
function RenameDialog({
  from,
  onRename,
  onClose,
}: {
  from: string;
  onRename: (from: string, typed: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const palette = useAndroidColors();
  const [typed, setTyped] = useState(() => editableName(from));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const result = await onRename(from, typed);
    setBusy(false);
    if (result) setProblem(result);
    else onClose();
  };
  return (
    <Modal transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.scrim}>
        <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: palette.surface }]}>
          <Text accessibilityRole="header" style={[styles.dialogTitle, { color: palette.text }]}>
            Rename note
          </Text>
          <TextInput
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              setProblem(null);
            }}
            autoFocus
            selectTextOnFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel="Note name"
            selectionColor={Accent}
            style={[styles.dialogInput, { color: palette.text, borderColor: problem ? palette.danger : Accent }]}
          />
          {problem ? (
            <Text accessibilityLiveRegion="polite" style={[styles.dialogProblem, { color: palette.danger }]}>
              {problem}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Button label="Cancel" onPress={onClose} />
            <Button label="Rename" onPress={submit} style={busy && styles.busy} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

const styles = StyleSheet.create({
  toolbarLayer: {
    ...StyleSheet.absoluteFill,
    bottom: TOOLBAR_MARGIN,
  },
  titleButton: {
    borderRadius: 8,
    paddingVertical: 4,
  },
  // the app bar title: 20 sp, medium.
  title: {
    fontSize: 20,
    fontWeight: '500',
  },
  scrim: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  dialog: {
    borderRadius: 28,
    padding: 24,
    gap: 16,
  },
  dialogTitle: {
    fontSize: 24,
  },
  dialogInput: {
    minHeight: 52,
    borderRadius: 4,
    borderWidth: 2,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  dialogProblem: {
    fontSize: 13,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  busy: {
    opacity: 0.4,
  },
});
