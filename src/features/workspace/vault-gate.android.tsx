/**
 * launch → restore vault access → note settings → the workspace (flow f2) on android: the
 * note in the middle, files in a panel on the left, the calendar in a panel on the right (t08).
 * the vault is a folder picked with the system folder picker; its permission is kept across
 * restarts (t04).
 */
import { Slot } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';

import { CalendarInspector } from '@/features/calendar/calendar-inspector';
import { detectDailyNotes, detectedSettings } from '@/features/daily-notes/detect';
import { NativeSidebar } from '@/features/explorer/native-sidebar';
import { useNoteList } from '@/features/explorer/use-note-list';
import type { LaunchSettings } from '@/features/navigation/launch';
import type { NewNoteSettings } from '@/features/new-notes/settings';
import { NoteSettingsForm } from '@/features/settings/note-settings-form';
import { type NoteSettings, useNoteSettings } from '@/features/settings/use-note-settings';
import { type VaultInfo, useVault } from '@/features/vault/use-vault';

import { VaultNative } from '../../../modules/vault/src';
import { revealApp } from './launch-screen';
import { Busy, Notice } from './status-views';
import { useWorkspace, WorkspaceProvider } from './workspace';

export function VaultGate() {
  const { state, choose } = useVault();
  // a screen that needs the user replaces the launch screen at once.
  const needsUser = state.phase !== 'loading' && state.phase !== 'ready';
  useEffect(() => {
    if (needsUser) revealApp();
  }, [needsUser]);
  switch (state.phase) {
    case 'unsupported':
      return <Notice title="This build has no vault module" systemImage="ipad.and.iphone" description="Vault access and the editor need the app's own native build." />;
    case 'loading':
      return <Busy label="Opening your vault" />;
    case 'needs-vault':
      return (
        <Notice
          title="Choose your vault"
          systemImage="folder.badge.plus"
          description="Pick the folder that holds your Markdown notes. Notes stay where they are; the app asks to keep access to that folder only."
          detail={state.error}
          action={{ title: 'Choose Folder', onPress: choose }}
        />
      );
    case 'unavailable':
      return (
        <Notice
          title={`Can't open ${state.vault.name}`}
          systemImage="folder.badge.questionmark"
          description="Access to the folder was lost or the folder moved. Choose it again to continue; your notes are not changed."
          detail={state.error}
          action={{ title: 'Choose Folder', onPress: choose }}
        />
      );
    case 'ready':
      return <VaultSettingsGate key={state.vault.id} vault={state.vault} chooseVault={choose} />;
  }
}

function VaultSettingsGate({ vault, chooseVault }: { vault: VaultInfo; chooseVault: () => void }) {
  const settings = useNoteSettings(vault.id);
  const firstSetup = settings.state.phase === 'unset';
  useEffect(() => {
    if (firstSetup) revealApp();
  }, [firstSetup]);
  if (settings.state.phase === 'loading') {
    return <Busy label="Loading settings" />;
  }
  if (settings.state.phase === 'unset') {
    return <FirstSetup vaultId={vault.id} newNote={settings.state.newNote} launch={settings.state.launch} onSave={settings.save} />;
  }
  return (
    <WorkspaceProvider
      vault={vault}
      settings={settings.state.settings.daily}
      newNoteSettings={settings.state.settings.newNote}
      launchSettings={settings.state.settings.launch}
      saveSettings={settings.save}
      chooseVault={chooseVault}>
      <WorkspacePanels />
    </WorkspaceProvider>
  );
}

/**
 * first setup (flow f1): one scan of the vault's file names finds where daily notes and the
 * daily template seem to be, and the form starts from that, with the new-note settings below.
 */
function FirstSetup({
  vaultId,
  newNote,
  launch,
  onSave,
}: {
  vaultId: string;
  newNote: NewNoteSettings;
  launch: LaunchSettings;
  onSave: (settings: NoteSettings) => void;
}) {
  const { listing, error } = useNoteList(vaultId);
  const notes = listing?.notes ?? null;
  const initial = useMemo(
    () => ({ daily: detectedSettings(detectDailyNotes(notes ?? [])), newNote, launch }),
    [launch, newNote, notes],
  );
  if (!listing && !error) {
    return <Busy label="Looking for your daily notes" />;
  }
  return <NoteSettingsForm vaultId={vaultId} initial={initial} notes={notes} firstSetup onSave={onSave} />;
}

/** how far from a screen edge a swipe starts opening a panel; android's back gesture starts at the very edge. */
const EDGE_SWIPE = 32;
const FILES_WIDTH = 320;
const CALENDAR_WIDTH = 360;

/** closes the keyboard and takes focus from the native editor, which Keyboard.dismiss() misses. */
function dismissKeyboard() {
  VaultNative?.dismissKeyboard().catch(() => undefined);
}

/**
 * the note with a side panel on each edge (t08): files on the left, the calendar on the right.
 * on a phone each panel slides over the note; on a wide screen an open panel stays beside it.
 */
function WorkspacePanels() {
  const { wide, filesOpen, setFilesOpen, calendarOpen, setCalendarOpen } = useWorkspace();
  const { width } = useWindowDimensions();
  useEffect(() => {
    if (filesOpen) dismissKeyboard();
  }, [filesOpen]);
  useEffect(() => {
    if (calendarOpen) dismissKeyboard();
  }, [calendarOpen]);
  const filesStyle = [styles.panel, { width: Math.min(FILES_WIDTH, Math.round(width * 0.86)) }];
  const calendarStyle = [styles.panel, { width: Math.min(CALENDAR_WIDTH, Math.round(width * 0.92)) }];
  return (
    <Drawer
      open={filesOpen}
      onOpen={() => setFilesOpen(true)}
      onClose={() => setFilesOpen(false)}
      drawerPosition="left"
      drawerType={wide && filesOpen ? 'permanent' : 'front'}
      drawerStyle={filesStyle}
      overlayStyle={styles.scrim}
      overlayAccessibilityLabel="Close files"
      swipeEdgeWidth={EDGE_SWIPE}
      keyboardDismissMode="none"
      onGestureStart={dismissKeyboard}
      renderDrawerContent={() => <NativeSidebar />}>
      <Drawer
        open={calendarOpen}
        onOpen={() => setCalendarOpen(true)}
        onClose={() => setCalendarOpen(false)}
        drawerPosition="right"
        drawerType={wide && calendarOpen ? 'permanent' : 'front'}
        drawerStyle={calendarStyle}
        overlayStyle={styles.scrim}
        overlayAccessibilityLabel="Close calendar"
        swipeEdgeWidth={EDGE_SWIPE}
        keyboardDismissMode="none"
        onGestureStart={dismissKeyboard}
        renderDrawerContent={() => <CalendarInspector />}>
        <Slot />
      </Drawer>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'transparent',
  },
  scrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
});
