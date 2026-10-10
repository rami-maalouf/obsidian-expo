/** the middle column's native stack: the note, with search and settings as sheets (t08). */
import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { Accent, useAndroidColors } from '@/constants/theme';

export default function NotesLayout() {
  const palette = useAndroidColors();
  // android app bars draw the title in the text color; only the icons take the accent.
  const title = Platform.OS === 'android' ? { headerTitleStyle: { color: palette.text } } : {};
  return (
    <Stack screenOptions={{ headerTintColor: Accent, ...title }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="search" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
