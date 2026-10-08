/** the middle column's native stack: the note, with search and settings as sheets (t08). */
import { Stack } from 'expo-router';

import { Accent } from '@/constants/theme';

export default function NotesLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: Accent }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="search" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
