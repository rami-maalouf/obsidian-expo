/**
 * unsaved drafts shown before today (r11) as a native form. opening a draft restores it when its
 * file is unchanged; otherwise the user keeps both versions or discards the draft.
 */
import { Button, Form, Host, Section, Text } from '@expo/ui/swift-ui';
import { foregroundStyle, tint } from '@expo/ui/swift-ui/modifiers';

import { Accent } from '@/constants/theme';

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

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

export function RecoveryList({ drafts, error, conflicted, onOpen, onKeepBoth, onDiscard, onContinue }: RecoveryListProps) {
  return (
    <Host style={{ flex: 1 }} modifiers={[tint(Accent)]}>
      <Form>
        <Section>
          <Text modifiers={[secondary]}>These edits were recorded on this device but not yet saved to their notes.</Text>
          {error ? <Text>{error}</Text> : null}
        </Section>
        {drafts.map((draft) => {
          const changed = conflicted.has(draft.path);
          return (
            <Section
              key={draft.path}
              title={noteTitle(draft.path)}
              footer={<Text>{changed ? `${draft.path} · the note changed since these edits` : draft.path}</Text>}>
              {!changed ? <Button label="Open and save" systemImage="square.and.arrow.down" onPress={() => onOpen(draft)} /> : null}
              <Button label="Keep both" systemImage="doc.on.doc" onPress={() => onKeepBoth(draft)} />
              <Button label="Discard edits" systemImage="trash" role="destructive" onPress={() => onDiscard(draft)} />
            </Section>
          );
        })}
        <Section>
          <Button label="Continue to Today" systemImage="arrow.right" onPress={onContinue} />
        </Section>
      </Form>
    </Host>
  );
}
