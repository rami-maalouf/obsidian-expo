/**
 * the app's only custom color. everything else uses system colors, so light and dark follow
 * the phone (t11).
 */
import { Platform, PlatformColor } from 'react-native';

/** obsidian's default accent purple. */
export const Accent = '#7F6DF2';

/** ios semantic colors, with plain fallbacks for the web and android shell. */
export const SystemColors = {
  background: Platform.OS === 'ios' ? PlatformColor('systemBackground') : '#ffffff',
  label: Platform.OS === 'ios' ? PlatformColor('label') : '#000000',
  secondaryLabel: Platform.OS === 'ios' ? PlatformColor('secondaryLabel') : '#60646c',
  warning: Platform.OS === 'ios' ? PlatformColor('systemOrange') : '#c2410c',
};
