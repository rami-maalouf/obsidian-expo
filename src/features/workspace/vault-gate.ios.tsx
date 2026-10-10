/**
 * launch → restore vault access → daily-note settings → the workspace (flow f2): the note in
 * the middle, files in a panel on the left, the calendar in a panel on the right (t08).
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Slot } from 'expo-router';
import { type ReactNode, useEffect, useMemo } from 'react';
import { PlatformColor, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';

import { CalendarInspector } from '@/features/calendar/calendar-inspector';
import { detectDailyNotes, detectedSettings } from '@/features/daily-notes/detect';
import type { LaunchSettings } from '@/features/navigation/launch';
import type { NewNoteSettings } from '@/features/new-notes/settings';
import { NativeSidebar } from '@/features/explorer/native-sidebar';
import { useNoteList } from '@/features/explorer/use-note-list';
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
      return <Notice title="Open on iPhone or iPad" systemImage="ipad.and.iphone" description="Vault access and the editor use native iOS features." />;
    case 'loading':
      return <Busy label="Opening your vault" />;
    case 'needs-vault':
      return (
        <Notice
          title="Choose your vault"
          systemImage="folder.badge.plus"
          description="Pick the folder that holds your Markdown notes. Notes stay where they are, including in iCloud Drive."
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
 * daily template seem to be, and the form starts from that, with the new-note settings below. if
 * the scan fails, the form starts from the defaults.
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

/** how far from a screen edge a swipe starts opening a panel. */
const EDGE_SWIPE = 32;
/** systemGray6 in dark mode (#1C1C1E) at 82% opacity: glass that hides most of the note. */
const DARK_PANEL_TINT = 'rgba(28, 28, 30, 0.82)';
/** the files panel's width; it never covers more than 86% of a phone. */
const FILES_WIDTH = 320;
/** the calendar panel is a little wider, so the graphical month fits with its margins. */
const CALENDAR_WIDTH = 360;

/**
 * closes the keyboard. the drawer's own keyboard handling calls react native's
 * Keyboard.dismiss(), which does not reach the native editor.
 */
function dismissKeyboard() {
  VaultNative?.dismissKeyboard().catch(() => undefined);
}

/**
 * the note with a side panel on each edge (t08): files on the left, the calendar on the right.
 * on a phone each panel slides over the note; on a wide screen an open panel stays beside it.
 * a panel closes the keyboard when it opens, from a button, the menu bar, or a swipe.
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
      renderDrawerContent={() => (
        <Panel>
          <NativeSidebar />
        </Panel>
      )}>
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
        renderDrawerContent={() => (
          <Panel>
            <CalendarInspector />
          </Panel>
        )}>
        <Slot />
      </Drawer>
    </Drawer>
  );
}

/** a panel on liquid glass, or on the grouped background where glass is not available. */
function Panel({ children }: { children: ReactNode }) {
  const dark = useColorScheme() === 'dark';
  if (isLiquidGlassAvailable()) {
    return (
      // in dark mode plain glass lets too much of the note through, so it is tinted with the
      // dark grouped background (systemGray6) to stay readable.
      <GlassView
        style={styles.fill}
        glassEffectStyle="regular"
        colorScheme={dark ? 'dark' : 'auto'}
        tintColor={dark ? DARK_PANEL_TINT : undefined}>
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.fill, styles.opaque]}>{children}</View>;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'transparent',
  },
  scrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  fill: {
    flex: 1,
  },
  opaque: {
    backgroundColor: PlatformColor('secondarySystemBackground'),
  },
});
