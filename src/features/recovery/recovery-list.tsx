/**
 * unsaved drafts shown before today (r11). opening a draft restores it when its file is
 * unchanged; otherwise the user keeps both versions or discards the draft.
 */
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

import type { NativeDraft } from '../../../modules/vault/src';
import { noteTitle } from '../editor/note-editor';

type RecoveryListProps = {
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
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedText type="subtitle" accessibilityRole="header">
        Unsaved edits
      </ThemedText>
      <ThemedText themeColor="textSecondary">
        These edits were recorded on this device but not yet saved to their notes.
      </ThemedText>
      {error && <ThemedText>{error}</ThemedText>}
      {drafts.map((draft) => {
        const changed = conflicted.has(draft.path);
        return (
          <ThemedView key={draft.path} type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">{noteTitle(draft.path)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {draft.path}
              {changed ? ' · the note changed since these edits' : ''}
            </ThemedText>
            <View style={styles.actions}>
              {!changed && <Button title="Open and save" onPress={() => onOpen(draft)} />}
              <Button kind={changed ? 'primary' : 'plain'} title="Keep both" onPress={() => onKeepBoth(draft)} />
              <Button kind="plain" title="Discard edits" onPress={() => onDiscard(draft)} />
            </View>
          </ThemedView>
        );
      })}
      <Button kind="plain" title="Continue to Today" onPress={onContinue} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
