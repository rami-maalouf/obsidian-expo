/**
 * launch → restore vault access → resolve unsaved drafts → open today → write (flow f2).
 */
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { DailyNoteOutcome } from '@/features/daily-notes/resolver';
import { useBookmarks } from '@/features/bookmarks/use-bookmarks';
import { NoteEditor } from '@/features/editor/note-editor';
import { Sidebar } from '@/features/explorer/sidebar';
import { useNoteList } from '@/features/explorer/use-note-list';
import { RecoveryList } from '@/features/recovery/recovery-list';
import { useDrafts } from '@/features/recovery/use-drafts';
import { SearchPanel } from '@/features/search/search-panel';
import { useSearchIndex } from '@/features/search/use-search-index';
import { dailyNotes, useTodayNote } from '@/features/today/use-today-note';
import { type VaultInfo, useVault } from '@/features/vault/use-vault';

export default function TodayScreen() {
  const { state, choose } = useVault();
  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {state.phase === 'unsupported' && (
          <Message
            title="Open on iPhone or iPad"
            body="Vault access and the editor use native iOS features. This build shows the app shell only."
          />
        )}
        {state.phase === 'loading' && <Busy label="Opening your vault" />}
        {state.phase === 'needs-vault' && (
          <Message
            title="Choose your vault"
            body="Pick the folder that holds your Markdown notes. Notes stay where they are, including in iCloud Drive."
            detail={state.error}
            action={{ title: 'Choose Folder', onPress: choose }}
          />
        )}
        {state.phase === 'unavailable' && (
          <Message
            title={`Can't open ${state.vault.name}`}
            body="Access to the folder was lost or the folder moved. Choose it again to continue; your notes are not changed."
            detail={state.error}
            action={{ title: 'Choose Folder', onPress: choose }}
          />
        )}
        {state.phase === 'ready' && <VaultHome vault={state.vault} />}
      </SafeAreaView>
    </ThemedView>
  );
}

/** at or above this width the sidebar stays beside the editor; below it, it opens as a drawer. */
const WIDE_LAYOUT = 768;

type Overlay = 'none' | 'search' | 'sidebar';

function VaultHome({ vault }: { vault: VaultInfo }) {
  const drafts = useDrafts(vault.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [continued, setContinued] = useState(false);
  const [conflicted, setConflicted] = useState<ReadonlySet<string>>(new Set());
  const [overlay, setOverlay] = useState<Overlay>('none');
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_LAYOUT;
  const search = useSearchIndex(vault.id);
  const notes = useNoteList(vault.id);
  const bookmarks = useBookmarks(vault.id);
  const pending = drafts.drafts;
  const needsRecovery = pending !== null && pending.length > 0 && selected === null && !continued;
  const today = useTodayNote(vault.id, pending !== null && !needsRecovery);
  const path = selected ?? (today.state.phase === 'done' && today.state.outcome.kind === 'open' ? today.state.outcome.path : null);

  const open = (next: string) => {
    // a deliberate choice wins over a today request that is still running (r15).
    dailyNotes.navigateAway();
    setSelected(next);
    setOverlay('none');
  };

  if (overlay === 'search') {
    return (
      <SearchPanel
        session={search.phase === 'ready' ? search.session : null}
        coverage={search.phase === 'ready' ? search.coverage : null}
        indexing={search.phase !== 'ready' || search.indexing}
        onOpen={open}
        onClose={() => setOverlay('none')}
      />
    );
  }

  const sidebar = (
    <Sidebar
      vaultId={vault.id}
      vaultName={vault.name}
      listing={notes.listing}
      bookmarks={bookmarks}
      activePath={path}
      onOpen={open}
      onCreated={notes.refresh}
      onClose={wide ? undefined : () => setOverlay('none')}
    />
  );
  if (!wide && overlay === 'sidebar') {
    return sidebar;
  }

  let content: ReactNode;
  if (pending === null) {
    content = <Busy label="Checking for unsaved edits" />;
  } else if (needsRecovery) {
    content = (
      <RecoveryList
        drafts={pending}
        error={drafts.error}
        conflicted={conflicted}
        onOpen={(draft) => open(draft.path)}
        onKeepBoth={async (draft) => {
          await drafts.keepBoth(draft);
          notes.refresh();
        }}
        onDiscard={drafts.discard}
        onContinue={() => setContinued(true)}
      />
    );
  } else if (path) {
    const marked = bookmarks.list?.items.some((item) => item.path === path) ?? false;
    content = (
      <NoteEditor
        key={path}
        vaultId={vault.id}
        path={path}
        accessory={
          <View style={styles.actions}>
            {!wide && <Button kind="plain" title="Files" onPress={() => setOverlay('sidebar')} />}
            <Button
              kind="plain"
              title={marked ? '★' : '☆'}
              accessibilityLabel={marked ? 'Remove bookmark' : 'Bookmark this note'}
              onPress={() => (marked ? bookmarks.remove(path) : bookmarks.add(path))}
            />
            <Button kind="plain" title="Search" onPress={() => setOverlay('search')} />
          </View>
        }
        onSaved={(saved) => {
          if (search.phase === 'ready') search.index.refresh(saved).catch(() => undefined);
        }}
        onRecoveryNeeded={(conflictPath) => {
          setConflicted((current) => new Set(current).add(conflictPath));
          setSelected(null);
          setContinued(false);
          drafts.refresh();
        }}
      />
    );
  } else if (today.state.phase !== 'done') {
    content = <Busy label="Opening today's note" />;
  } else {
    content = <TodayProblem outcome={today.state.outcome} onRetry={today.retry} />;
  }

  if (!wide) {
    return content;
  }
  return (
    <View style={styles.split}>
      <View style={styles.sidebar}>{sidebar}</View>
      <View style={styles.main}>{content}</View>
    </View>
  );
}

function TodayProblem({ outcome, onRetry }: { outcome: DailyNoteOutcome; onRetry: () => void }) {
  const retry = { title: 'Try Again', onPress: onRetry };
  switch (outcome.kind) {
    case 'unavailable':
      return (
        <Message
          title="Today's note isn't available yet"
          body={
            outcome.state === 'placeholder'
              ? `${outcome.path} is in iCloud and has not downloaded. Nothing was created.`
              : `${outcome.path} could not be checked. Nothing was created.`
          }
          detail={outcome.reason}
          action={retry}
        />
      );
    case 'template-error':
      return (
        <Message
          title="The daily template has a problem"
          body={`Nothing was created. ${outcome.error.message}`}
          detail={outcome.error.tag}
          action={retry}
        />
      );
    case 'template-unavailable':
      return <Message title="The daily template can't be read" body={outcome.reason} action={retry} />;
    case 'failed':
      return <Message title="Today's note couldn't be opened" body={outcome.reason} action={retry} />;
    case 'cancelled':
    case 'open':
      return <Busy label="Opening today's note" />;
  }
}

type MessageProps = {
  title: string;
  body: string;
  detail?: string;
  action?: { title: string; onPress: () => void };
};

function Message({ title, body, detail, action }: MessageProps) {
  return (
    <View style={styles.message}>
      <ThemedText type="subtitle" accessibilityRole="header">
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary">{body}</ThemedText>
      {detail ? (
        <ThemedText type="code" themeColor="textSecondary" selectable>
          {detail}
        </ThemedText>
      ) : null}
      {action && <Button title={action.title} onPress={action.onPress} />}
    </View>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <View style={styles.message} accessible accessibilityLabel={label}>
      <ActivityIndicator />
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  split: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 300,
  },
  main: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  message: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
});
