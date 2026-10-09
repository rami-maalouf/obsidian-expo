/**
 * android status views: an empty state with an optional action, and a busy indicator. the
 * ios names of the shared notices map to material symbols here.
 */
import type { AndroidSymbol } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Accent, useAndroidColors } from '@/constants/theme';

import { Button, Icon } from './android-ui';

export type NoticeProps = {
  title: string;
  /** an sf symbol name, as the shared screens pass it; shown as its material counterpart. */
  systemImage: string;
  description: string;
  detail?: string;
  action?: { title: string; onPress: () => void };
};

const ICONS: Record<string, AndroidSymbol> = {
  'ipad.and.iphone': 'devices',
  'folder.badge.plus': 'create_new_folder',
  'folder.badge.questionmark': 'folder_off',
  'icloud.and.arrow.down': 'cloud_download',
  'exclamationmark.triangle': 'warning',
  'doc.questionmark': 'unknown_document',
};

/** an empty state with an optional action, used before the workspace opens and for problems. */
export function Notice({ title, systemImage, description, detail, action }: NoticeProps) {
  const palette = useAndroidColors();
  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Icon name={ICONS[systemImage] ?? 'info'} size={48} color={palette.secondary} />
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        {title}
      </Text>
      <Text style={[styles.description, { color: palette.secondary }]}>{description}</Text>
      {detail ? <Text style={[styles.detail, { color: palette.secondary }]}>{detail}</Text> : null}
      {action ? <Button kind="filled" label={action.title} onPress={action.onPress} style={styles.action} /> : null}
    </View>
  );
}

export function Busy({ label }: { label: string }) {
  const palette = useAndroidColors();
  return (
    <View style={[styles.container, { backgroundColor: palette.background }]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={Accent} size="large" />
      <Text style={[styles.description, { color: palette.secondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  detail: {
    fontSize: 13,
    textAlign: 'center',
  },
  action: {
    marginTop: 12,
  },
});
