/**
 * the left sidebar: bookmarks and the vault's files as a native SwiftUI sidebar list (r8, r9,
 * t07, t08). only expanded folders produce rows, and the list reuses rows while scrolling.
 */
import { Button, Host, Label, List, Menu, NavigationStack, Section, Text, Toolbar, ToolbarItem } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  bold,
  foregroundStyle,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  padding,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { Accent } from '@/constants/theme';
import { viewBookmarks } from '@/features/bookmarks/bookmarks';
import { useWorkspace } from '@/features/workspace/workspace';

import { ancestorFolders, buildTree, type ExplorerRow, flattenTree } from './tree';

const INDENT = 14;
const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

export function NativeSidebar() {
  const workspace = useWorkspace();
  const router = useRouter();
  const { notes, bookmarks, path: activePath, open, vault } = workspace;
  const listing = notes.listing;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(activePath ? ancestorFolders(activePath) : []));
  const [locating, setLocating] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const tree = useMemo(() => (listing ? buildTree(listing.notes) : null), [listing]);
  const rows = useMemo(() => (tree ? flattenTree(tree, expanded) : []), [tree, expanded]);
  const known = useMemo(() => (listing ? new Set(listing.notes.map((note) => note.path)) : null), [listing]);
  const marks = bookmarks.list ? viewBookmarks(bookmarks.list, known) : [];

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
    setProblem((await workspace.createNote()) ? null : 'The note could not be created.');
  };

  const renderRow = useCallback(
    ({ item }: { item: ExplorerRow }) =>
      item.kind === 'folder' ? (
        <Button
          onPress={() => toggle(item.path)}
          modifiers={[padding({ leading: item.depth * INDENT }), accessibilityLabel(`${item.name} folder, ${item.count} notes, ${item.expanded ? 'expanded' : 'collapsed'}`)]}>
          <Label title={item.name} systemImage={item.expanded ? 'chevron.down' : 'chevron.right'} />
        </Button>
      ) : (
        <Button
          onPress={() => choose(item.path)}
          modifiers={[
            padding({ leading: item.depth * INDENT }),
            accessibilityIdentifier(`file:${item.path}`),
            ...(item.path === activePath ? [bold(), foregroundStyle(Accent)] : []),
          ]}>
          <Label title={item.placeholder ? `${item.name} (in iCloud)` : item.name} systemImage={item.placeholder ? 'icloud' : 'doc.text'} />
        </Button>
      ),
    [activePath, choose, toggle],
  );

  return (
    <Host style={{ flex: 1 }} modifiers={[tint(Accent)]}>
      <NavigationStack>
        <Toolbar>
          <List modifiers={[listStyle('sidebar'), scrollContentBackground('hidden'), navigationTitle(vault.name), navigationBarTitleDisplayMode('inline')]}>
            {locating ? (
              <Section title="Locate bookmark">
                <Text>Choose the new location of {locating} in Files.</Text>
                <Button label="Cancel" systemImage="xmark" onPress={() => setLocating(null)} />
              </Section>
            ) : null}
            {problem ? (
              <Section>
                <Text modifiers={[secondary]}>{problem}</Text>
              </Section>
            ) : null}
            <Section title="Bookmarks">
              {marks.length === 0 ? (
                <Text modifiers={[secondary]}>{bookmarks.list ? 'Bookmark a note from its toolbar to find it here.' : 'Loading bookmarks…'}</Text>
              ) : (
                marks.map((mark) =>
                  mark.missing ? (
                    <Menu key={mark.path} label={`${mark.title} (missing)`} systemImage="bookmark.slash" modifiers={[accessibilityIdentifier(`bookmark:${mark.path}`)]}>
                      <Button label="Locate" systemImage="magnifyingglass" onPress={() => setLocating(mark.path)} />
                      <Button label="Remove Bookmark" systemImage="trash" role="destructive" onPress={() => bookmarks.remove(mark.path)} />
                    </Menu>
                  ) : (
                    <Button key={mark.path} onPress={() => choose(mark.path)} modifiers={[accessibilityIdentifier(`bookmark:${mark.path}`)]}>
                      <Label title={mark.title} systemImage="bookmark.fill" />
                    </Button>
                  ),
                )
              )}
              {bookmarks.error ? <Text modifiers={[secondary]}>{bookmarks.error}</Text> : null}
            </Section>
            <Section title="Files">
              {listing?.unreadableFolders.length ? (
                <Text modifiers={[secondary]}>Some folders could not be read: {listing.unreadableFolders.join(', ')}</Text>
              ) : null}
              {listing && rows.length === 0 ? <Text modifiers={[secondary]}>No Markdown notes in this vault.</Text> : null}
              {!listing ? <Text modifiers={[secondary]}>Loading files…</Text> : null}
              <List.ForEach data={rows} keyExtractor={(row: ExplorerRow) => `${row.kind}:${row.path}`} estimatedItemSize={44}>
                {renderRow}
              </List.ForEach>
            </Section>
          </List>
          <Toolbar.Content>
            <ToolbarItem placement="topBarLeading">
              <Button label="Close Files" systemImage="sidebar.left" onPress={() => workspace.setFilesOpen(false)} />
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button label="New Note" systemImage="square.and.pencil" onPress={newNote} />
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Menu label="Vault" systemImage="ellipsis.circle">
                <Button label="Daily Note Settings" systemImage="calendar.badge.clock" onPress={() => router.push('/settings')} />
                <Button label="Choose Another Vault" systemImage="folder" onPress={workspace.chooseVault} />
              </Menu>
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>
      </NavigationStack>
    </Host>
  );
}
