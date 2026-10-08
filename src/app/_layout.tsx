/**
 * the root: gestures for the side panels, the phone's light or dark appearance, then vault
 * access and the workspace (t08, t11).
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Accent } from '@/constants/theme';
import { VaultGate } from '@/features/workspace/vault-gate';

const light = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: Accent } };
const dark = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: Accent } };

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
