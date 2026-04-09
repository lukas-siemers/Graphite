import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Pressable, TextInput, Image, Alert, Platform, FlatList } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, countNotebookContents } from '@graphite/db';
import type { Notebook, Note } from '@graphite/db';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';
import { useFolderStore } from '../../stores/use-folder-store';
import FolderTree from './FolderTree';
import TagList from './TagList';

// On web, Alert.alert is unreliable — use window.confirm directly instead.
function webConfirmDelete(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-restricted-globals
    if (confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
  }
}

export default function Sidebar() {
  const notebooks = useNotebookStore((s) => s.notebooks);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const setActiveNotebook = useNotebookStore((s) => s.setActiveNotebook);
  const renameNotebookAction = useNotebookStore((s) => s.renameNotebook);
  const createNewNotebook = useNotebookStore((s) => s.createNewNotebook);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const searchNotesAction = useNoteStore((s) => s.searchNotes);
  const clearSearch = useNoteStore((s) => s.clearSearch);
  const searchResults = useNoteStore((s) => s.searchResults);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const createNewFolder = useFolderStore((s) => s.createNewFolder);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const didAutoExpandRef = useRef(false);
  useEffect(() => {
    if (didAutoExpandRef.current || notebooks.length === 0) return;
    didAutoExpandRef.current = true;
    setExpandedIds(new Set(notebooks.map((n) => n.id)));
  }, [notebooks]);

  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<TextInput>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (!text.trim()) {
        clearSearch();
        return;
      }
      if (!activeNotebookId || Platform.OS === 'web') return;
      try {
        const db = getDatabase();
        searchNotesAction(db, activeNotebookId, text);
      } catch (_) {}
    },
    [activeNotebookId, searchNotesAction, clearSearch],
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    clearSearch();
  }, [clearSearch]);

  // First tap fires immediately. Second tap within 300ms triggers rename.
  const lastTapRef = useRef<Map<string, number>>(new Map());

  function handleNotebookPress(notebookId: string, notebookName: string) {
    if (renamingNotebookId === notebookId) return;

    const now = Date.now();
    const last = lastTapRef.current.get(notebookId) ?? 0;
    lastTapRef.current.set(notebookId, now);

    if (now - last < 500) {
      lastTapRef.current.delete(notebookId);
      startRename(notebookId, notebookName);
      return;
    }

    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(notebookId)) next.delete(notebookId);
      else next.add(notebookId);
      return next;
    });

    if (notebookId === activeNotebookId) return;
    setActiveNotebook(notebookId);
    // Clear active folder so a folder from the previous notebook doesn't stay highlighted
    useFolderStore.getState().setActiveFolder(null);

    if (Platform.OS === 'web') return;
    try {
      const db = getDatabase();
      loadNotes(db, notebookId, null);
    } catch (_) {}
  }

  function startRename(notebookId: string, currentName: string) {
    setRenamingNotebookId(notebookId);
    setRenameValue(currentName);
  }

  async function commitRename(notebookId: string, originalName: string) {
    const trimmed = renameValue.trim();
    const finalName = trimmed.length > 0 ? trimmed : originalName;
    setRenamingNotebookId(null);
    setRenameValue('');
    if (finalName === originalName) return;
    try {
      const db = getDatabase();
      await renameNotebookAction(db, notebookId, finalName);
    } catch (_) {}
  }

  function cancelRename() {
    setRenamingNotebookId(null);
    setRenameValue('');
  }

  async function handleCreateNewNotebook() {
    try {
      const db = getDatabase();
      const notebook = await createNewNotebook(db, 'New Notebook');
      setExpandedIds((prev) => new Set([...prev, notebook.id]));
      startRename(notebook.id, notebook.name);
    } catch (_) {}
  }

  async function handleCreateNewFolder(notebookId: string) {
    try {
      const db = getDatabase();
      await createNewFolder(db, notebookId, 'New Folder');
    } catch (_) {}
  }

  async function handleDeleteNotebook(notebookId: string, notebookName: string) {
    try {
      const db = getDatabase();
      const { folderCount, noteCount } = await countNotebookContents(db, notebookId);
      const message =
        folderCount === 0 && noteCount === 0
          ? `"${notebookName}" is empty. Delete it?`
          : `This will delete ${folderCount} folder${folderCount === 1 ? '' : 's'} and ${noteCount} note${noteCount === 1 ? '' : 's'}. This cannot be undone.`;
      webConfirmDelete('Delete notebook?', message, 'Delete All', async () => {
        try {
          const { deletedFolderIds, deletedNoteIds } = await useNotebookStore
            .getState()
            .deleteNotebook(db, notebookId);
          // Drop every folder from the deleted notebook from the folder store.
          const folderIdSet = new Set(deletedFolderIds);
          useFolderStore.setState((s) => ({
            folders: s.folders.filter((f) => !folderIdSet.has(f.id) && f.notebookId !== notebookId),
            activeFolderId:
              s.activeFolderId && folderIdSet.has(s.activeFolderId) ? null : s.activeFolderId,
          }));
          // Drop every deleted note from the note store; clear editor if active.
          const noteIdSet = new Set(deletedNoteIds);
          const currentActive = useNoteStore.getState().activeNoteId;
          useNoteStore.setState((s) => ({
            notes: s.notes.filter((n) => !noteIdSet.has(n.id) && n.notebookId !== notebookId),
            activeNoteId: currentActive && noteIdSet.has(currentActive) ? null : currentActive,
          }));
        } catch (_) {}
      });
    } catch (_) {}
  }

  async function handleSearchResultPress(note: Note) {
    // Search results may come from any folder in the notebook. Switch the
    // folder context so the note list loads the right folder and the editor
    // finds the note in its in-memory array.
    const targetFolderId = note.folderId ?? null;
    if (targetFolderId !== activeFolderId) {
      useFolderStore.getState().setActiveFolder(targetFolderId);
    }
    try {
      const db = getDatabase();
      await loadNotes(db, note.notebookId, targetFolderId);
    } catch (_) {
      // db not ready
    }
    setActiveNote(note.id);
    // Clear search so the user sees the note list for that folder
    setSearchQuery('');
    clearSearch();
  }

  function renderSearchResult({ item: note }: { item: Note }) {
    const isActive = note.id === activeNoteId;
    const preview = (note.body || '').slice(0, 60).replace(/\n/g, ' ');
    return (
      <Pressable
        onPress={() => handleSearchResultPress(note)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 8,
          paddingLeft: isActive ? 12 : 14,
          paddingRight: 8,
          borderLeftWidth: isActive ? 2 : 0,
          borderLeftColor: tokens.accent,
          backgroundColor: isActive ? tokens.bgHover : 'transparent',
        }}
      >
        <MaterialCommunityIcons
          name="file-document-outline"
          size={15}
          color={isActive ? tokens.accentLight : tokens.textMuted}
          style={{ marginRight: 7 }}
        />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: isActive ? '600' : '400',
              color: isActive ? tokens.accentLight : tokens.textBody,
            }}
            numberOfLines={1}
          >
            {note.title || 'Untitled'}
          </Text>
          {preview.length > 0 && (
            <Text
              style={{ fontSize: 11, color: tokens.textMuted, marginTop: 1 }}
              numberOfLines={1}
            >
              {preview}
            </Text>
          )}
        </View>
      </Pressable>
    );
  }

  function renderNotebook({ item: notebook }: { item: Notebook }) {
    // Only highlight the notebook when it's active AND no child folder is selected
    const isActive = notebook.id === activeNotebookId && activeFolderId === null;
    const isExpanded = expandedIds.has(notebook.id);
    const isRenaming = renamingNotebookId === notebook.id;

    return (
      <View key={notebook.id}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => handleNotebookPress(notebook.id, notebook.name)}
            onLongPress={() => handleDeleteNotebook(notebook.id, notebook.name)}
            delayLongPress={500}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 9,
              paddingLeft: isActive ? 12 : 14,
              paddingRight: 8,
              borderLeftWidth: isActive ? 2 : 0,
              borderLeftColor: tokens.accent,
              backgroundColor: isActive ? '#2A2A2A' : 'transparent',
            }}
          >
            <MaterialCommunityIcons
              name={isExpanded ? 'chevron-down' : 'chevron-right'}
              size={16}
              color={tokens.textHint}
              style={{ marginRight: 4, width: 16 }}
            />
            <MaterialCommunityIcons
              name={isExpanded ? 'notebook' : 'notebook-outline'}
              size={17}
              color={isActive ? tokens.accentLight : tokens.textMuted}
              style={{ marginRight: 8 }}
            />

            {isRenaming ? (
              <TextInput
                ref={renameInputRef}
                autoFocus
                value={renameValue}
                onChangeText={setRenameValue}
                onSubmitEditing={() => commitRename(notebook.id, notebook.name)}
                onBlur={() => commitRename(notebook.id, notebook.name)}
                onKeyPress={(e: any) => {
                  if (e?.nativeEvent?.key === 'Escape') {
                    e.preventDefault?.();
                    cancelRename();
                  }
                }}
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: '500',
                  color: tokens.textBody,
                  padding: 0,
                  margin: 0,
                }}
                selectTextOnFocus
                returnKeyType="done"
              />
            ) : (
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? '600' : '400',
                  color: isActive ? tokens.textBody : tokens.textMuted,
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {notebook.name}
              </Text>
            )}

            {isExpanded && !isRenaming && (
              <Pressable
                onPress={() => handleCreateNewFolder(notebook.id)}
                hitSlop={10}
                style={{ paddingHorizontal: 6 }}
              >
                <Text style={{ fontSize: 18, color: tokens.textMuted, lineHeight: 20 }}>+</Text>
              </Pressable>
            )}
          </Pressable>

          {!isRenaming && (
            <Pressable
              onPress={() => handleDeleteNotebook(notebook.id, notebook.name)}
              hitSlop={10}
              style={{ paddingHorizontal: 10, paddingVertical: 9 }}
            >
              <Text style={{ fontSize: 18, color: tokens.textMuted, lineHeight: 20 }}>×</Text>
            </Pressable>
          )}
        </View>

        {isExpanded && <FolderTree notebookId={notebook.id} searchQuery={searchQuery} />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'column', backgroundColor: tokens.bgSidebar }}>
      {/* Header */}
      <View
        style={{
          height: 52,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          borderBottomWidth: 1,
          borderBottomColor: tokens.border,
        }}
      >
        <Image
          source={require('../../assets/icon.png')}
          style={{ width: 20, height: 20, marginRight: 9 }}
          resizeMode="contain"
        />
        <Text style={{ fontSize: 15, fontWeight: '700', color: tokens.textPrimary, letterSpacing: -0.3 }}>
          Graphite
        </Text>
      </View>

      {/* Search bar */}
      <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: tokens.bgBase,
            borderWidth: 1,
            borderColor: tokens.border,
            paddingHorizontal: 8,
            paddingVertical: 6,
          }}
        >
          <MaterialCommunityIcons name="magnify" size={15} color={tokens.textHint} style={{ marginRight: 6 }} />
          <TextInput
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder="Search notes..."
            placeholderTextColor={tokens.textHint}
            style={{ flex: 1, fontSize: 12, color: tokens.textBody, padding: 0, margin: 0 }}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={handleClearSearch} hitSlop={8}>
              <Text style={{ fontSize: 14, color: tokens.textHint, lineHeight: 18 }}>×</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Section label */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 14,
          paddingRight: 8,
          paddingTop: 14,
          paddingBottom: 6,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 10,
            fontWeight: '600',
            color: tokens.textHint,
            letterSpacing: 1.8,
            textTransform: 'uppercase',
          }}
        >
          Notebooks
        </Text>
        <Pressable onPress={handleCreateNewNotebook} hitSlop={10} style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: 18, color: tokens.textMuted, lineHeight: 20 }}>+</Text>
        </Pressable>
      </View>

      {/* Notebook list / Search results + Tags */}
      <View style={{ flex: 1 }}>
        {searchQuery.trim().length > 0 ? (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            renderItem={renderSearchResult}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text
                style={{
                  fontSize: 12,
                  color: tokens.textHint,
                  textAlign: 'center',
                  paddingTop: 24,
                }}
              >
                No results
              </Text>
            }
          />
        ) : (
          <FlatList
            data={notebooks}
            keyExtractor={(item) => item.id}
            renderItem={renderNotebook}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={<TagList />}
          />
        )}
      </View>

      {/* Footer */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: tokens.border,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View
            style={{
              width: 28,
              height: 28,
              backgroundColor: tokens.bgHover,
              borderWidth: 1,
              borderColor: tokens.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 11, color: tokens.textMuted, fontWeight: '600' }}>LS</Text>
          </View>
          <Text style={{ fontSize: 12, color: tokens.textMuted, fontWeight: '500' }}>Lukas S.</Text>
        </View>
        <Pressable hitSlop={10}>
          <Text style={{ fontSize: 18, color: tokens.textHint }}>{'\u2699'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
