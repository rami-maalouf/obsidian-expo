/**
 * search on android (r6, r7): a search field above a virtualized result list, with coverage
 * below. opening a result reads the current file; the index only finds it.
 */
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Accent, useAndroidColors } from '@/constants/theme';
import { coverageText } from '@/features/search/coverage';
import { snippetParts } from '@/features/search/query';
import type { SearchHit, SearchResults } from '@/features/search/search-index';

import { Icon, IconButton, Row } from './android-ui';
import { useWorkspace } from './workspace';

const DEBOUNCE_MS = 60;

export function SearchScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
  const palette = useAndroidColors();
  const insets = useSafeAreaInsets();
  const { search, open } = workspace;
  const session = search.phase === 'ready' ? search.session : null;
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
  const coverage = coverageText(
    shown?.coverage ?? (search.phase === 'ready' ? search.coverage : null),
    search.phase !== 'ready' || search.indexing,
    'not on this device',
  );
  const openResult = useCallback(
    (path: string) => {
      router.back();
      open(path);
    },
    [open, router],
  );

  const renderHit = useCallback(
    ({ item }: { item: SearchHit }) => (
      <View>
        <Row
          icon={item.placeholder ? 'cloud_off' : 'description'}
          title={item.placeholder ? `${item.title} (not on this device)` : item.title}
          subtitle={item.folder || undefined}
          accessibilityLabel={item.title}
          onPress={() => openResult(item.path)}
        />
        {item.snippet ? (
          <Text numberOfLines={2} style={[styles.snippet, { color: palette.secondary }]}>
            {snippetParts(item.snippet).map((part, index) => (
              <Text key={index} style={part.highlight ? [styles.highlight, { color: palette.text }] : undefined}>
                {part.text.replace(/\s+/g, ' ')}
              </Text>
            ))}
          </Text>
        ) : null}
      </View>
    ),
    [openResult, palette.secondary, palette.text],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={[styles.field, { backgroundColor: palette.surface }]}>
          <Icon name="search" size={22} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search notes"
            placeholderTextColor={palette.secondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search notes"
            selectionColor={Accent}
            style={[styles.input, { color: palette.text }]}
          />
          {query ? <IconButton icon="close" label="Clear search" onPress={() => setQuery('')} /> : null}
        </View>
        <FlatList
          data={shown?.hits ?? []}
          keyExtractor={(hit) => hit.path}
          renderItem={renderHit}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          ListEmptyComponent={
            query.trim() && shown ? <Text style={[styles.message, { color: palette.secondary }]}>No notes match “{query.trim()}”.</Text> : undefined
          }
          ListFooterComponent={
            <Text style={[styles.message, { color: palette.secondary }]}>
              {shown && !shown.complete ? `${coverage} · results may be incomplete` : coverage}
            </Text>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingLeft: 14,
    paddingRight: 4,
    minHeight: 52,
    borderRadius: 26,
  },
  input: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 8,
  },
  snippet: {
    fontSize: 14,
    lineHeight: 19,
    paddingLeft: 50,
    paddingRight: 16,
    paddingBottom: 10,
    marginTop: -4,
  },
  highlight: {
    fontWeight: '700',
  },
  message: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
