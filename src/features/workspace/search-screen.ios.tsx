/**
 * native search (r6, r7): the system search field in the navigation bar and a native result
 * list. opening a result reads the current file; the index only finds it.
 */
import { Button, Host, List, Section, Text, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, bold, font, foregroundStyle, lineLimit, tint } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Accent } from '@/constants/theme';
import { coverageText, snippetMarkdown } from '@/features/search/coverage';
import type { SearchHit, SearchResults } from '@/features/search/search-index';

import { useWorkspace } from './workspace';

const DEBOUNCE_MS = 60;
const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

export function SearchScreen() {
  const workspace = useWorkspace();
  const router = useRouter();
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
  const coverage = coverageText(shown?.coverage ?? (search.phase === 'ready' ? search.coverage : null), search.phase !== 'ready' || search.indexing);
  const openResult = useCallback(
    (path: string) => {
      router.back();
      open(path);
    },
    [open, router],
  );

  const renderHit = useCallback(
    ({ item }: { item: SearchHit }) => (
      <Button onPress={() => openResult(item.path)} modifiers={[accessibilityLabel(item.title)]}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[bold(), lineLimit(1)]}>{item.placeholder ? `${item.title} (in iCloud)` : item.title}</Text>
          {item.folder ? <Text modifiers={[secondary, font({ size: 13 }), lineLimit(1)]}>{item.folder}</Text> : null}
          {item.snippet ? (
            <Text markdownEnabled modifiers={[secondary, font({ size: 14 }), lineLimit(2)]}>
              {snippetMarkdown(item.snippet)}
            </Text>
          ) : null}
        </VStack>
      </Button>
    ),
    [openResult],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <Stack.SearchBar
        placeholder="Search notes"
        autoFocus
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Done" onPress={() => router.back()}>
          Done
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} modifiers={[tint(Accent)]}>
        <List>
          <Section footer={<Text>{shown && !shown.complete ? `${coverage} · results may be incomplete` : coverage}</Text>}>
            {query.trim() && shown && shown.hits.length === 0 ? <Text modifiers={[secondary]}>No notes match “{query.trim()}”.</Text> : null}
            <List.ForEach data={shown?.hits ?? []} keyExtractor={(hit: SearchHit) => hit.path} estimatedItemSize={72}>
              {renderHit}
            </List.ForEach>
          </Section>
        </List>
      </Host>
    </>
  );
}
