/** daily-note settings as a screen in the note's stack (r12). */
import { Stack, useRouter } from 'expo-router';

import { DailySettingsForm } from '@/features/settings/daily-settings-form';

import { useWorkspace } from './workspace';

export function SettingsScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: 'Daily notes' }} />
      <DailySettingsForm
        vaultId={workspace.vault.id}
        initial={workspace.settings}
        notes={workspace.notes.listing?.notes ?? null}
        firstSetup={false}
        onSave={async (settings) => {
          await workspace.saveSettings(settings);
          router.back();
        }}
        onCancel={() => router.back()}
      />
    </>
  );
}
