import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'plain';
  disabled?: boolean;
  /** spoken name when the title is a symbol. */
  accessibilityLabel?: string;
};

export function Button({ title, onPress, kind = 'primary', disabled = false, accessibilityLabel }: ButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && { backgroundColor: theme.text },
        kind === 'plain' && { backgroundColor: theme.backgroundElement },
        (pressed || disabled) && styles.dimmed,
      ]}>
      <ThemedText type="smallBold" style={kind === 'primary' && { color: theme.background }}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: {
    opacity: 0.6,
  },
});
