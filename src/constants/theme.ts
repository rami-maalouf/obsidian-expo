/**
 * the app's only custom color. everything else uses system colors, so light and dark follow
 * the phone (t11).
 */
import { Platform, PlatformColor, useColorScheme } from 'react-native';

/** obsidian's default accent purple. */
export const Accent = '#7F6DF2';

/** ios semantic colors, with plain fallbacks for the web and android shell. */
export const SystemColors = {
  background: Platform.OS === 'ios' ? PlatformColor('systemBackground') : '#ffffff',
  label: Platform.OS === 'ios' ? PlatformColor('label') : '#000000',
  secondaryLabel: Platform.OS === 'ios' ? PlatformColor('secondaryLabel') : '#60646c',
  warning: Platform.OS === 'ios' ? PlatformColor('systemOrange') : '#c2410c',
};

/**
 * the android shell's colors: obsidian's light and dark palettes. android has no semantic color
 * names that react native can follow at runtime, so screens pick one with the color scheme.
 */
export const AndroidColors = {
  light: {
    background: '#ffffff',
    surface: '#f6f6f6',
    text: '#222222',
    secondary: '#5c5c5c',
    border: '#e3e3e3',
    accentSoft: 'rgba(127, 109, 242, 0.14)',
    // material's disabled content: the text color at 38% opacity.
    disabled: 'rgba(34, 34, 34, 0.38)',
    onAccent: '#ffffff',
    warning: '#c2410c',
    danger: '#d93025',
  },
  dark: {
    background: '#1e1e1e',
    surface: '#262626',
    text: '#dadada',
    secondary: '#a3a3a3',
    border: '#363636',
    accentSoft: 'rgba(165, 148, 255, 0.2)',
    disabled: 'rgba(218, 218, 218, 0.38)',
    onAccent: '#ffffff',
    warning: '#f0a35e',
    danger: '#f28b82',
  },
};

export type AndroidPalette = (typeof AndroidColors)['light'];

/** the android palette for the phone's current light or dark appearance. */
export function useAndroidColors(): AndroidPalette {
  return useColorScheme() === 'dark' ? AndroidColors.dark : AndroidColors.light;
}

/** semantic colors that follow light and dark on every platform: ios names, or the android palette. */
export function useSystemColors() {
  const palette = useAndroidColors();
  if (Platform.OS === 'ios') return SystemColors;
  return { background: palette.background, label: palette.text, secondaryLabel: palette.secondary, warning: palette.warning };
}
