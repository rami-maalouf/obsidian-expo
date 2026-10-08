/**
 * launch → restore vault access → daily-note settings → the workspace (flow f2): the note in
 * the middle, files in a panel on the left, the calendar in a panel on the right (t08).
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Slot } from 'expo-router';
import type { ReactNode } from 'react';
import { PlatformColor, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';

import { CalendarInspector } from '@/features/calendar/calendar-inspector';
import { DEFAULT_DAILY_NOTE_SETTINGS } from '@/features/daily-notes/settings';
import { NativeSidebar } from '@/features/explorer/native-sidebar';
import { DailySettingsForm } from '@/features/settings/daily-settings-form';
import { useDailySettings } from '@/features/settings/use-daily-settings';
import { type VaultInfo, useVault } from '@/features/vault/use-vault';

import { Busy, Notice } from './status-views';
import { useWorkspace, WorkspaceProvider } from './workspace';

export function VaultGate() {
  const { state, choose } = useVault();
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
  const settings = useDailySettings(vault.id);
  if (settings.state.phase === 'loading') {
    return <Busy label="Loading settings" />;
  }
  if (settings.state.phase === 'unset') {
    return <DailySettingsForm vaultId={vault.id} initial={DEFAULT_DAILY_NOTE_SETTINGS} firstSetup onSave={settings.save} />;
  }
  return (
    <WorkspaceProvider vault={vault} settings={settings.state.settings} saveSettings={settings.save} chooseVault={chooseVault}>
      <WorkspacePanels />
    </WorkspaceProvider>
  );
}

/** how far from a screen edge a swipe starts opening a panel. */
const EDGE_SWIPE = 32;
/** panels never cover more of a phone than this. */
const PANEL_WIDTH = 320;

/**
 * the note with a side panel on each edge (t08): files on the left, the calendar on the right.
 * on a phone each panel slides over the note; on a wide screen an open panel stays beside it.
 */
function WorkspacePanels() {
  const { wide, filesOpen, setFilesOpen, calendarOpen, setCalendarOpen } = useWorkspace();
  const { width } = useWindowDimensions();
  const panelStyle = [styles.panel, { width: Math.min(PANEL_WIDTH, Math.round(width * 0.86)) }];
  return (
    <Drawer
      open={filesOpen}
      onOpen={() => setFilesOpen(true)}
      onClose={() => setFilesOpen(false)}
      drawerPosition="left"
      drawerType={wide && filesOpen ? 'permanent' : 'front'}
      drawerStyle={panelStyle}
      overlayStyle={styles.scrim}
      overlayAccessibilityLabel="Close files"
      swipeEdgeWidth={EDGE_SWIPE}
      keyboardDismissMode="on-drag"
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
        drawerStyle={panelStyle}
        overlayStyle={styles.scrim}
        overlayAccessibilityLabel="Close calendar"
        swipeEdgeWidth={EDGE_SWIPE}
        keyboardDismissMode="on-drag"
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
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={styles.fill} glassEffectStyle="regular">
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
