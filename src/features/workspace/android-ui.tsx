/**
 * small material-style pieces for the android screens: material symbols icons, icon buttons,
 * list rows, section titles, and buttons, in the app's light or dark palette (t11). the ios
 * screens use swiftui views from @expo/ui instead.
 */
import { type AndroidSymbol, SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Accent, useAndroidColors } from '@/constants/theme';

export function Icon({ name, size = 24, color }: { name: AndroidSymbol; size?: number; color?: string }) {
  const palette = useAndroidColors();
  return <SymbolView name={{ android: name }} size={size} tintColor={color ?? palette.secondary} />;
}

export function IconButton({
  icon,
  label,
  onPress,
  color,
  selected = false,
}: {
  icon: AndroidSymbol;
  label: string;
  onPress: () => void;
  color?: string;
  selected?: boolean;
}) {
  const palette = useAndroidColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      android_ripple={{ color: palette.accentSoft, borderless: true, radius: 22 }}
      style={[styles.iconButton, selected && { backgroundColor: palette.accentSoft }]}>
      <Icon name={icon} color={color ?? palette.text} />
    </Pressable>
  );
}

/** one tappable line: an optional icon, a title, an optional second line, and trailing content. */
export function Row({
  icon,
  iconColor,
  title,
  subtitle,
  trailing,
  onPress,
  indent = 0,
  strong = false,
  accessibilityLabel,
  testID,
}: {
  icon?: AndroidSymbol;
  iconColor?: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  indent?: number;
  strong?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const palette = useAndroidColors();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      android_ripple={{ color: palette.accentSoft }}
      style={[styles.row, { paddingLeft: 16 + indent }]}>
      {icon ? <Icon name={icon} size={20} color={iconColor ?? (strong ? Accent : palette.secondary)} /> : null}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: strong ? Accent : palette.text }, strong && styles.strong]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={[styles.rowSubtitle, { color: palette.secondary }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export function SectionTitle({ children, trailing }: { children: string; trailing?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text accessibilityRole="header" style={styles.sectionText}>
        {children}
      </Text>
      {trailing}
    </View>
  );
}

/** a filled button for the main action, or a text button for the others. */
export function Button({
  label,
  onPress,
  kind = 'text',
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'filled' | 'text' | 'danger';
  icon?: AndroidSymbol;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = useAndroidColors();
  const filled = kind === 'filled';
  const color = filled ? palette.onAccent : kind === 'danger' ? palette.danger : Accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: filled ? 'rgba(255, 255, 255, 0.24)' : palette.accentSoft }}
      style={[styles.button, filled && { backgroundColor: Accent }, style]}>
      {icon ? <Icon name={icon} size={18} color={color} /> : null}
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingRight: 12,
    paddingVertical: 8,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 16,
  },
  strong: {
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 13,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 4,
    paddingTop: 16,
    paddingBottom: 4,
    minHeight: 44,
  },
  sectionText: {
    color: Accent,
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
