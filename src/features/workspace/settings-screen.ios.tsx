/** note settings in a native sheet: daily notes and new notes (r5, r12). */
import { Stack, useRouter } from 'expo-router';

import { NoteSettingsForm } from '@/features/settings/note-settings-form';

import { useWorkspace } from './workspace';

export function SettingsScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: 'Note Settings' }} />
      <NoteSettingsForm
        vaultId={workspace.vault.id}
        initial={{ daily: workspace.settings, newNote: workspace.newNoteSettings, launch: workspace.launchSettings }}
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
