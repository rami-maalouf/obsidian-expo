/**
 * search results with their coverage (r6, r7). opening a result reads the current file; the
 * index only finds it.
 */
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { snippetParts } from './query';
import type { Coverage, SearchHit, SearchResults, SearchSession } from './search-index';

const DEBOUNCE_MS = 60;

export function coverageText(coverage: Coverage | null, indexing: boolean): string {
  if (!coverage) return 'Preparing search…';
  const parts = [`${coverage.indexed.toLocaleString()} of ${coverage.total.toLocaleString()} notes searchable by content`];
  if (coverage.placeholders > 0) parts.push(`${coverage.placeholders.toLocaleString()} in iCloud, names only`);
  if (coverage.unreadableFolders.length > 0) parts.push(`${coverage.unreadableFolders.length} folders unreadable`);
  if (indexing) parts.push('indexing');
  return parts.join(' · ');
}

type SearchPanelProps = {
  session: SearchSession | null;
  coverage: Coverage | null;
  indexing: boolean;
  onOpen: (path: string) => void;
  onClose: () => void;
};

export function SearchPanel({ session, coverage, indexing, onOpen, onClose }: SearchPanelProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      session.query(query).then((next) => next && setResults(next));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, session]);

  const shown = results?.query === query ? results : null;
  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Search notes"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Button kind="plain" title="Done" onPress={onClose} />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.coverage} accessibilityLiveRegion="polite">
        {session ? coverageText(shown?.coverage ?? coverage, indexing) : 'Search needs the iOS app.'}
        {shown && !shown.complete ? ' · results may be incomplete' : ''}
      </ThemedText>
      <FlatList
        data={shown?.hits ?? []}
        keyExtractor={(hit) => hit.path}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={15}
        windowSize={7}
        renderItem={({ item }) => <ResultRow hit={item} onOpen={onOpen} />}
        ListEmptyComponent={
          query.trim() && shown ? (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No matches.
            </ThemedText>
          ) : undefined
        }
      />
    </View>
  );
}

function ResultRow({ hit, onOpen }: { hit: SearchHit; onOpen: (path: string) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${hit.title}${hit.folder ? `, in ${hit.folder}` : ''}${hit.placeholder ? ', not downloaded' : ''}`}
      onPress={() => onOpen(hit.path)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <ThemedText type="smallBold" numberOfLines={1}>
        {hit.title}
        {hit.placeholder ? ' ☁︎' : ''}
      </ThemedText>
      {hit.folder ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {hit.folder}
        </ThemedText>
      ) : null}
      {hit.snippet ? (
        <ThemedText type="small" numberOfLines={2}>
          {snippetParts(hit.snippet).map((part, index) => (
            <ThemedText key={index} type={part.highlight ? 'smallBold' : 'small'}>
              {part.text.replace(/\s+/g, ' ')}
            </ThemedText>
          ))}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bar: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
    paddingBottom: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
  },
  coverage: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    padding: Spacing.three,
  },
});
