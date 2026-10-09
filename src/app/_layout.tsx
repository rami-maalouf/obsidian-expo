/**
 * the root: gestures for the side panels, the phone's light or dark appearance, then vault
 * access and the workspace (t08, t11).
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Accent, AndroidColors } from '@/constants/theme';
import { holdLaunchScreen } from '@/features/workspace/launch-screen';
import { VaultGate } from '@/features/workspace/vault-gate';

// before the first render: the launch screen stays until the first note is ready.
holdLaunchScreen();

/** android's app bar and screens use obsidian's palette; ios keeps the system colors. */
const androidColors = (palette: (typeof AndroidColors)['light']) =>
  Platform.OS === 'android' ? { background: palette.background, card: palette.background, text: palette.text, border: palette.border } : {};

const light = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: Accent, ...androidColors(AndroidColors.light) } };
const dark = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: Accent, ...androidColors(AndroidColors.dark) } };

const styles = StyleSheet.create({ root: { flex: 1 } });

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? dark : light}>
        <VaultGate />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
