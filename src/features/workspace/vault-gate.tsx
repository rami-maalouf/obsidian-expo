/**
 * the web build shows only the app shell; vault access and the editor are native ios and
 * android features.
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SystemColors } from '@/constants/theme';

import { revealApp } from './launch-screen';

export function VaultGate() {
  useEffect(revealApp, []);
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: SystemColors.label }]} accessibilityRole="header">
        Open on iPhone, iPad, or Android
      </Text>
      <Text style={{ color: SystemColors.secondaryLabel }}>
        Vault access and the editor use native iOS and Android features. This build shows the app shell only.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: 12, padding: 32, backgroundColor: SystemColors.background },
  title: { fontSize: 22, fontWeight: '600' },
});
