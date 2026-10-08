/**
 * launch → restore vault access → daily-note settings → the workspace (flow f2). the workspace
 * is a native split view: files on the left, notes in the middle, the calendar on the right (t08).
 */
import { SplitView } from 'expo-router/unstable-split-view';
import { useWindowDimensions } from 'react-native';

import { CalendarInspector } from '@/features/calendar/calendar-inspector';
import { DEFAULT_DAILY_NOTE_SETTINGS } from '@/features/daily-notes/settings';
import { NativeSidebar } from '@/features/explorer/native-sidebar';
import { DailySettingsForm } from '@/features/settings/daily-settings-form';
import { useDailySettings } from '@/features/settings/use-daily-settings';
import { type VaultInfo, useVault } from '@/features/vault/use-vault';

import { Busy, Notice } from './status-views';
import { useWorkspace, WorkspaceProvider } from './workspace';

/** below this width the split view starts collapsed, until it reports its own state. */
const COMPACT_WIDTH = 700;

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
      <WorkspaceSplit />
    </WorkspaceProvider>
  );
}

function WorkspaceSplit() {
  const workspace = useWorkspace();
  const { width } = useWindowDimensions();
  const { splitRef, setCollapsed, calendarVisible, setCalendarVisible } = workspace;
  return (
    <SplitView
      ref={splitRef}
      primaryBackgroundStyle="sidebar"
      // like obsidian, the file sidebar stays beside the note whenever there is room.
      preferredDisplayMode="oneBesideSecondary"
      preferredSplitBehavior="tile"
      displayModeButtonVisibility="automatic"
      topColumnForCollapsing="secondary"
      showInspector={calendarVisible}
      onInspectorHide={() => setCalendarVisible(false)}
      onCollapse={() => setCollapsed(true)}
      onExpand={() => setCollapsed(false)}
      onLayout={() => width < COMPACT_WIDTH && setCollapsed(true)}
      columnMetrics={{ preferredPrimaryColumnWidthOrFraction: 300, preferredInspectorColumnWidthOrFraction: 340 }}>
      <SplitView.Column>
        <NativeSidebar />
      </SplitView.Column>
      <SplitView.Inspector>
        <CalendarInspector />
      </SplitView.Inspector>
    </SplitView>
  );
}
