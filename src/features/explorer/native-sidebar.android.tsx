/**
 * the left panel on android: bookmarks and the vault's files in one virtualized list (r8, r9,
 * t07, t08). only expanded folders produce rows, and the list renders the rows near the screen.
 */
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Accent, useAndroidColors } from '@/constants/theme';
import { type BookmarkView, viewBookmarks } from '@/features/bookmarks/bookmarks';
import { Button, Icon, IconButton, Row, SectionTitle } from '@/features/workspace/android-ui';
import { useWorkspace } from '@/features/workspace/workspace';

import { FILE_SORT_GROUPS, type FileSort } from './file-sort';
import { ancestorFolders, buildTree, type ExplorerRow, flattenTree } from './tree';
import { useFileSort } from './use-file-sort';

const INDENT = 16;

type Item =
  | { kind: 'title'; key: string; title: string; sort?: boolean }
  | { kind: 'message'; key: string; text: string }
  | { kind: 'action'; key: string; icon: 'settings' | 'folder_open'; title: string; run: () => void }
  | { kind: 'locate'; key: string; path: string }
  | { kind: 'bookmark'; key: string; mark: BookmarkView }
  | { kind: 'sort'; key: string; value: FileSort; label: string }
  | { kind: 'row'; key: string; row: ExplorerRow };

export function NativeSidebar() {
  const workspace = useWorkspace();
  const router = useRouter();
  const palette = useAndroidColors();
  const insets = useSafeAreaInsets();
  const { notes, bookmarks, path: activePath, open, vault, knownPaths: known } = workspace;
  const listing = notes.listing;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(activePath ? ancestorFolders(activePath) : []));
  const [locating, setLocating] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const { sort, setSort } = useFileSort(vault.id);

  const tree = useMemo(() => (listing ? buildTree(listing.notes) : null), [listing]);
  const rows = useMemo(() => (tree ? flattenTree(tree, expanded, sort) : []), [tree, expanded, sort]);
  const marks = useMemo(() => (bookmarks.list ? viewBookmarks(bookmarks.list, known) : []), [bookmarks.list, known]);

  const toggle = useCallback(
    (folder: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(folder)) next.delete(folder);
        else next.add(folder);
        return next;
      }),
    [],
  );

  const choose = useCallback(
    (notePath: string) => {
      if (locating) {
        bookmarks.move(locating, notePath);
        setLocating(null);
        return;
      }
      open(notePath);
    },
    [bookmarks, locating, open],
  );

  const newNote = async () => {
    setProblem(await workspace.createNote());
  };

  const items = useMemo(() => {
    const list: Item[] = [];
    if (showActions) {
      list.push({ kind: 'action', key: 'action:settings', icon: 'settings', title: 'Note settings', run: () => router.push('/settings') });
      list.push({ kind: 'action', key: 'action:vault', icon: 'folder_open', title: 'Choose another vault', run: workspace.chooseVault });
    }
    if (locating) list.push({ kind: 'locate', key: 'locate', path: locating });
    if (problem) list.push({ kind: 'message', key: 'problem', text: problem });
    list.push({ kind: 'title', key: 'title:bookmarks', title: 'Bookmarks' });
    if (marks.length === 0) {
      list.push({ kind: 'message', key: 'bookmarks:empty', text: bookmarks.list ? 'Bookmark a note from its menu to find it here.' : 'Loading bookmarks…' });
    }
    for (const mark of marks) list.push({ kind: 'bookmark', key: `bookmark:${mark.path}`, mark });
    if (bookmarks.error) list.push({ kind: 'message', key: 'bookmarks:error', text: bookmarks.error });
    list.push({ kind: 'title', key: 'title:files', title: 'Files', sort: true });
    if (showSort) {
      for (const group of FILE_SORT_GROUPS) {
        for (const option of group.options) list.push({ kind: 'sort', key: `sort:${option.value}`, value: option.value, label: option.label });
      }
    }
    if (listing?.unreadableFolders.length) {
      list.push({ kind: 'message', key: 'files:unreadable', text: `Some folders could not be read: ${listing.unreadableFolders.join(', ')}` });
    }
    if (listing && rows.length === 0) list.push({ kind: 'message', key: 'files:empty', text: 'No Markdown notes in this vault.' });
    if (!listing) list.push({ kind: 'message', key: 'files:loading', text: 'Loading files…' });
    for (const row of rows) list.push({ kind: 'row', key: `${row.kind}:${row.path}`, row });
    return list;
  }, [bookmarks.error, bookmarks.list, listing, locating, marks, problem, router, rows, showActions, showSort, workspace.chooseVault]);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.kind) {
        case 'title':
          return (
            <SectionTitle
              trailing={
                item.sort ? <IconButton icon="sort" label="Sort files" selected={showSort} onPress={() => setShowSort((shown) => !shown)} /> : undefined
              }>
              {item.title}
            </SectionTitle>
          );
        case 'message':
          return <Text style={[styles.message, { color: palette.secondary }]}>{item.text}</Text>;
        case 'action':
          return (
            <Row
              icon={item.icon}
              title={item.title}
              onPress={() => {
                setShowActions(false);
                item.run();
              }}
            />
          );
        case 'locate':
          return (
            <View style={[styles.locate, { backgroundColor: palette.accentSoft }]}>
              <Text style={[styles.locateText, { color: palette.text }]}>Choose the new location of {item.path} in Files.</Text>
              <Button icon="close" label="Cancel" onPress={() => setLocating(null)} />
            </View>
          );
        case 'bookmark':
          return item.mark.missing ? (
            <Row
              icon="bookmark_remove"
              title={`${item.mark.title} (missing)`}
              testID={`bookmark:${item.mark.path}`}
              trailing={
                <View style={styles.inline}>
                  <Button label="Locate" onPress={() => setLocating(item.mark.path)} />
                  <Button kind="danger" label="Remove" onPress={() => bookmarks.remove(item.mark.path)} />
                </View>
              }
            />
          ) : (
            <Row
              icon="bookmark"
              iconColor={Accent}
              title={item.mark.title}
              testID={`bookmark:${item.mark.path}`}
              strong={item.mark.path === activePath}
              onPress={() => choose(item.mark.path)}
            />
          );
        case 'sort':
          return (
            <Row
              title={item.label}
              indent={8}
              accessibilityLabel={`${item.label}${sort === item.value ? ', selected' : ''}`}
              trailing={sort === item.value ? <Icon name="check" color={Accent} /> : undefined}
              onPress={() => {
                setSort(item.value);
                setShowSort(false);
              }}
            />
          );
        case 'row': {
          const row = item.row;
          return row.kind === 'folder' ? (
            <Row
              icon={row.expanded ? 'expand_more' : 'chevron_right'}
              title={row.name}
              indent={row.depth * INDENT}
              accessibilityLabel={`${row.name} folder, ${row.count} notes, ${row.expanded ? 'expanded' : 'collapsed'}`}
              trailing={<Text style={[styles.count, { color: palette.secondary }]}>{row.count}</Text>}
              onPress={() => toggle(row.path)}
            />
          ) : (
            <Row
              icon={row.placeholder ? 'cloud_off' : 'description'}
              title={row.placeholder ? `${row.name} (not on this device)` : row.name}
              indent={row.depth * INDENT}
              strong={row.path === activePath}
              testID={`file:${row.path}`}
              onPress={() => choose(row.path)}
            />
          );
        }
      }
    },
    [activePath, bookmarks, choose, palette, setSort, showSort, sort, toggle],
  );

  return (
    <View style={[styles.panel, { paddingTop: insets.top, backgroundColor: palette.surface }]}>
      <View style={styles.header}>
        <IconButton icon="left_panel_close" label="Close files" onPress={() => workspace.setFilesOpen(false)} />
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: palette.text }]}>
          {vault.name}
        </Text>
        <IconButton icon="edit_square" label="New note" onPress={newNote} />
        <IconButton icon="more_vert" label="Vault" selected={showActions} onPress={() => setShowActions((shown) => !shown)} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        initialNumToRender={30}
        windowSize={11}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    minHeight: 56,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  message: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  locate: {
    margin: 12,
    padding: 12,
    borderRadius: 12,
    gap: 4,
  },
  locateText: {
    fontSize: 14,
  },
  inline: {
    flexDirection: 'row',
  },
  count: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
