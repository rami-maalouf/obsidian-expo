/**
 * the root: the phone's light or dark appearance, then vault access and the native workspace
 * (t08, t11).
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Accent } from '@/constants/theme';
import { VaultGate } from '@/features/workspace/vault-gate';

const light = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: Accent } };
const dark = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: Accent } };

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? dark : light}>
      <VaultGate />
    </ThemeProvider>
  );
}
