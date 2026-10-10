/**
 * unsaved drafts shown before today (r11). opening a draft restores it when its file is
 * unchanged; otherwise the user keeps both versions or discards the draft.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAndroidColors } from '@/constants/theme';
import { Button } from '@/features/workspace/android-ui';

import type { NativeDraft } from '../../../modules/vault/src';
import { noteTitle } from '../editor/note-editor';

export type RecoveryListProps = {
  drafts: NativeDraft[];
  error: string | null;
  /** paths whose files changed since the draft was written; opening them would not restore. */
  conflicted: ReadonlySet<string>;
  onOpen: (draft: NativeDraft) => void;
  onKeepBoth: (draft: NativeDraft) => void;
  onDiscard: (draft: NativeDraft) => void;
  onContinue: () => void;
};

export function RecoveryList({ drafts, error, conflicted, onOpen, onKeepBoth, onDiscard, onContinue }: RecoveryListProps) {
  const palette = useAndroidColors();
  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: palette.secondary }]}>
        These edits were recorded on this device but not yet saved to their notes.
      </Text>
      {error ? <Text style={[styles.intro, { color: palette.warning }]}>{error}</Text> : null}
      {drafts.map((draft) => {
        const changed = conflicted.has(draft.path);
        return (
          <View key={draft.path} style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
              {noteTitle(draft.path)}
            </Text>
            <Text style={[styles.path, { color: palette.secondary }]}>
              {changed ? `${draft.path} · the note changed since these edits` : draft.path}
            </Text>
            <View style={styles.actions}>
              {!changed ? <Button kind="filled" icon="save" label="Open and save" onPress={() => onOpen(draft)} /> : null}
              <Button icon="file_copy" label="Keep both" onPress={() => onKeepBoth(draft)} />
              <Button kind="danger" icon="delete" label="Discard edits" onPress={() => onDiscard(draft)} />
            </View>
          </View>
        );
      })}
      <Button kind="filled" icon="arrow_forward" label="Continue to Today" onPress={onContinue} style={styles.continue} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
  },
  intro: {
    fontSize: 15,
    lineHeight: 21,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  path: {
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  continue: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
});
