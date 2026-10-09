/**
 * the app's only custom color. everything else uses system colors, so light and dark follow
 * the phone (t11).
 */
import { DynamicColorIOS, Platform, PlatformColor } from 'react-native';

/** evereld emerald, with separate shades for legibility in each appearance. */
export const AccentLight = '#08745B';
export const AccentDark = '#63DDB2';
export const Accent = Platform.OS === 'ios'
  ? DynamicColorIOS({ light: AccentLight, dark: AccentDark })
  : AccentLight;

/** ios semantic colors, with plain fallbacks for the web and android shell. */
export const SystemColors = {
  background: Platform.OS === 'ios' ? PlatformColor('systemBackground') : '#ffffff',
  label: Platform.OS === 'ios' ? PlatformColor('label') : '#000000',
  secondaryLabel: Platform.OS === 'ios' ? PlatformColor('secondaryLabel') : '#60646c',
  warning: Platform.OS === 'ios' ? PlatformColor('systemOrange') : '#c2410c',
};
