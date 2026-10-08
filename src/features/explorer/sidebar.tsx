/**
 * left sidebar: file explorer, bookmarks, and new notes (r5, r8, r9). on wide screens it stays
 * beside the editor; on compact screens it opens as a drawer.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { viewBookmarks, type BookmarkView } from '@/features/bookmarks/bookmarks';
import type { useBookmarks } from '@/features/bookmarks/use-bookmarks';
import { joinVaultPath, normalizeFolderPath, normalizeNotePath } from '@/features/daily-notes/vault-path';
import { useTheme } from '@/hooks/use-theme';

import { VaultNative } from '../../../modules/vault/src';
import { ancestorFolders, buildTree, type ExplorerRow, flattenTree } from './tree';
import type { NoteListing } from './use-note-list';

type SidebarProps = {
  vaultId: string;
  vaultName: string;
  listing: NoteListing | null;
  bookmarks: ReturnType<typeof useBookmarks>;
  activePath: string | null;
  onOpen: (path: string) => void;
  onCreated: () => void;
  onClose?: () => void;
};

type Section = 'files' | 'bookmarks' | 'new';

export function Sidebar(props: SidebarProps) {
  const { listing, bookmarks, activePath, onOpen, onClose, vaultName } = props;
  const theme = useTheme();
  const [section, setSection] = useState<Section>('files');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(activePath ? ancestorFolders(activePath) : []));
  const [locating, setLocating] = useState<string | null>(null);

  const tree = useMemo(() => (listing ? buildTree(listing.notes) : null), [listing]);
  const rows = useMemo(() => (tree ? flattenTree(tree, expanded) : []), [tree, expanded]);
  const known = useMemo(() => (listing ? new Set(listing.notes.map((note) => note.path)) : null), [listing]);
  const marks = bookmarks.list ? viewBookmarks(bookmarks.list, known) : [];

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const openNote = (path: string) => {
    if (locating) {
      bookmarks.move(locating, path);
      setLocating(null);
      setSection('bookmarks');
      return;
    }
    onOpen(path);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.flex} accessibilityRole="header">
          {vaultName}
        </ThemedText>
        {onClose && <Button kind="plain" title="Close" onPress={onClose} />}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['files', 'bookmarks', 'new'] as const).map((tab) => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === tab }}
            onPress={() => setSection(tab)}
            style={[styles.tab, section === tab && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small">{tab === 'files' ? 'Files' : tab === 'bookmarks' ? 'Bookmarks' : 'New Note'}</ThemedText>
          </Pressable>
        ))}
      </View>
      {locating && section === 'files' && (
        <View style={styles.banner}>
          <ThemedText type="small" style={styles.flex}>
            Choose the new location of {locating}.
          </ThemedText>
          <Button kind="plain" title="Cancel" onPress={() => setLocating(null)} />
        </View>
      )}
      {section === 'files' && (
        <FlatList
          data={rows}
          keyExtractor={(row) => `${row.kind}:${row.path}`}
          initialNumToRender={30}
          windowSize={9}
          ListHeaderComponent={
            listing?.unreadableFolders.length ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
                Some folders could not be read: {listing.unreadableFolders.join(', ')}
              </ThemedText>
            ) : undefined
          }
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              {listing ? 'No Markdown notes in this vault.' : 'Loading files…'}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <ExplorerItem row={item} active={item.path === activePath} onToggle={toggle} onOpen={openNote} />
          )}
        />
      )}
      {section === 'bookmarks' && (
        <FlatList
          data={marks}
          keyExtractor={(item) => item.path}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              {bookmarks.list ? 'Bookmark a note from its header to find it here.' : 'Loading bookmarks…'}
            </ThemedText>
          }
          ListFooterComponent={bookmarks.error ? <ThemedText style={styles.note}>{bookmarks.error}</ThemedText> : undefined}
          renderItem={({ item }) => (
            <BookmarkItem
              bookmark={item}
              onOpen={() => openNote(item.path)}
              onLocate={() => {
                setLocating(item.path);
                setSection('files');
              }}
              onRemove={() => bookmarks.remove(item.path)}
            />
          )}
        />
      )}
      {section === 'new' && (
        <NewNoteForm
          vaultId={props.vaultId}
          defaultFolder={activePath && activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : ''}
          onCreated={(path) => {
            props.onCreated();
            setSection('files');
            onOpen(path);
          }}
        />
      )}
    </View>
  );
}

function ExplorerItem({
  row,
  active,
  onToggle,
  onOpen,
}: {
  row: ExplorerRow;
  active: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const theme = useTheme();
  const folder = row.kind === 'folder';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={folder ? `${row.name} folder, ${row.count} notes` : `${row.name}${row.placeholder ? ', not downloaded' : ''}`}
      accessibilityState={folder ? { expanded: row.expanded } : { selected: active }}
      onPress={() => (folder ? onToggle(row.path) : onOpen(row.path))}
      style={({ pressed }) => [
        styles.row,
        { paddingLeft: Spacing.three + row.depth * Spacing.three },
        active && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small" numberOfLines={1}>
        {folder ? `${row.expanded ? '▾' : '▸'} ${row.name}` : `${row.name}${row.placeholder ? ' ☁︎' : ''}`}
      </ThemedText>
    </Pressable>
  );
}

function BookmarkItem({
  bookmark,
  onOpen,
  onLocate,
  onRemove,
}: {
  bookmark: BookmarkView;
  onOpen: () => void;
  onLocate: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.bookmark}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${bookmark.title}${bookmark.missing ? ', missing' : ''}`}
        disabled={bookmark.missing}
        onPress={onOpen}
        style={styles.flex}>
        <ThemedText type="small" numberOfLines={1} themeColor={bookmark.missing ? 'textSecondary' : 'text'}>
          {bookmark.title}
          {bookmark.missing ? ' (missing)' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {bookmark.path}
        </ThemedText>
      </Pressable>
      {bookmark.missing && <Button kind="plain" title="Locate" onPress={onLocate} />}
      <Button kind="plain" title="Remove" onPress={onRemove} />
    </View>
  );
}

function NewNoteForm({
  vaultId,
  defaultFolder,
  onCreated,
}: {
  vaultId: string;
  defaultFolder: string;
  onCreated: (path: string) => void;
}) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(defaultFolder);
  const [error, setError] = useState<string | null>(null);
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  const create = async () => {
    const folderPath = normalizeFolderPath(folder);
    if (!folderPath.ok) return setError(folderPath.error);
    const notePath = normalizeNotePath(joinVaultPath(folderPath.value, title.trim()));
    if (!title.trim() || !notePath.ok) return setError(notePath.ok ? 'Enter a title.' : notePath.error);
    const result = await VaultNative?.createExclusive(vaultId, notePath.value, '');
    if (result?.kind === 'created') {
      setTitle('');
      setError(null);
      onCreated(notePath.value);
    } else if (result?.kind === 'exists') {
      setError('A note with this name already exists in that folder.');
    } else {
      setError('The note could not be created.');
    }
  };

  return (
    <View style={styles.form}>
      <ThemedText type="small">Title</ThemedText>
      <TextInput value={title} onChangeText={setTitle} placeholder="Untitled" accessibilityLabel="Note title" style={inputStyle} />
      <ThemedText type="small">Folder (empty for the vault root)</ThemedText>
      <TextInput
        value={folder}
        onChangeText={setFolder}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Folder"
        style={inputStyle}
      />
      {error && <ThemedText type="small">{error}</ThemedText>}
      <Button title="Create Note" onPress={create} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    paddingBottom: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  tab: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  row: {
    minHeight: 40,
    justifyContent: 'center',
    paddingRight: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
  note: {
    padding: Spacing.three,
  },
  bookmark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  form: {
    gap: Spacing.two,
    padding: Spacing.three,
  },
  input: {
    minHeight: 44,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
  },
});
