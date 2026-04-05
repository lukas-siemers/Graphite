import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, Alert, Platform, FlatList } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, countFolderContents } from '@graphite/db';
import type { Folder, Note } from '@graphite/db';
import { useFolderStore } from '../../stores/use-folder-store';
import { useNoteStore } from '../../stores/use-note-store';

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

interface FolderTreeProps {
  notebookId: string;
  searchQuery?: string;
}

export default function FolderTree({ notebookId, searchQuery = '' }: FolderTreeProps) {
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder);
  const renameFolderAction = useFolderStore((s) => s.renameFolder);
  const loadFolders = useFolderStore((s) => s.loadFolders);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const createNewNote = useNoteStore((s) => s.createNewNote);

  const notebookFolders = folders
    .filter((f) => f.notebookId === notebookId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    async function loadAndExpand() {
      if (Platform.OS === 'web') return;
      try {
        const db = getDatabase();
        await loadFolders(db, notebookId);
        const fresh = useFolderStore
          .getState()
          .folders.filter((f) => f.notebookId === notebookId);
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          fresh.forEach((f) => next.add(f.id));
          return next;
        });
      } catch (_) {}
    }
    loadAndExpand();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set<string>());
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // First tap fires immediately. Second tap within 300ms triggers rename.
  const lastTapRef = useRef<Map<string, number>>(new Map());

  function handleFolderPress(folderId: string, folderName: string) {
    if (renamingFolderId === folderId) return;

    const now = Date.now();
    const last = lastTapRef.current.get(folderId) ?? 0;
    lastTapRef.current.set(folderId, now);

    if (now - last < 500) {
      lastTapRef.current.delete(folderId);
      startFolderRename(folderId, folderName);
      return;
    }

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

    const isAlreadyActive = folderId === useFolderStore.getState().activeFolderId;
    if (isAlreadyActive) return;
    setActiveFolder(folderId);

    if (Platform.OS === 'web') return;
    try {
      const db = getDatabase();
      loadNotes(db, notebookId, folderId);
    } catch (_) {}
  }

  function startFolderRename(folderId: string, currentName: string) {
    setRenamingFolderId(folderId);
    setRenameValue(currentName);
  }

  async function commitFolderRename(folderId: string, originalName: string) {
    const trimmed = renameValue.trim();
    const finalName = trimmed.length > 0 ? trimmed : originalName;
    setRenamingFolderId(null);
    setRenameValue('');
    if (finalName === originalName) return;
    try {
      const db = getDatabase();
      await renameFolderAction(db, folderId, finalName);
    } catch (_) {}
  }

  function cancelFolderRename() {
    setRenamingFolderId(null);
    setRenameValue('');
  }

  async function handleCreateNewNote(folderId: string) {
    try {
      const db = getDatabase();
      await createNewNote(db, notebookId, folderId);
    } catch (_) {}
  }

  async function handleDeleteFolder(folderId: string, folderName: string) {
    try {
      const db = getDatabase();
      const { folderCount, noteCount } = await countFolderContents(db, folderId);
      const total = folderCount + noteCount;
      const message =
        total === 0
          ? `"${folderName}" is empty.`
          : `This folder contains ${noteCount} note${noteCount === 1 ? '' : 's'}${
              folderCount > 0
                ? ` and ${folderCount} subfolder${folderCount === 1 ? '' : 's'}`
                : ''
            }. Delete folder and all contents?`;
      const confirmLabel = total === 0 ? 'Delete' : 'Delete All';
      webConfirmDelete('Delete folder?', message, confirmLabel, async () => {
        try {
          const { deletedFolderIds, deletedNoteIds } = await useFolderStore
            .getState()
            .deleteFolder(db, folderId);
          const noteIdSet = new Set(deletedNoteIds);
          const folderIdSet = new Set(deletedFolderIds);
          const currentActiveNote = useNoteStore.getState().activeNoteId;
          useNoteStore.setState((s) => ({
            notes: s.notes.filter(
              (n) => !noteIdSet.has(n.id) && !(n.folderId && folderIdSet.has(n.folderId)),
            ),
            activeNoteId:
              currentActiveNote && noteIdSet.has(currentActiveNote) ? null : currentActiveNote,
          }));
        } catch (_) {}
      });
    } catch (_) {}
  }

  function handleDeleteNote(noteId: string, noteTitle: string) {
    webConfirmDelete(
      'Delete note?',
      `Delete "${noteTitle || 'Untitled'}"? This cannot be undone.`,
      'Delete',
      async () => {
        try {
          const db = getDatabase();
          await useNoteStore.getState().deleteNote(db, noteId);
        } catch (_) {}
      },
    );
  }

  function renderNote({ item: note }: { item: Note }) {
    const isActiveNote = note.id === activeNoteId;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          onPress={() => setActiveNote(note.id)}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: isActiveNote ? 46 : 48,
            paddingRight: 8,
            paddingVertical: 6,
            borderLeftWidth: isActiveNote ? 2 : 0,
            borderLeftColor: tokens.accent,
            backgroundColor: isActiveNote ? '#2A2A2A' : 'transparent',
          }}
        >
          <MaterialCommunityIcons
            name="file-document-outline"
            size={15}
            color={isActiveNote ? tokens.accentLight : tokens.textMuted}
            style={{ marginRight: 7 }}
          />
          <Text
            style={{
              fontSize: 12,
              color: isActiveNote ? tokens.accentLight : tokens.textMuted,
              fontWeight: isActiveNote ? '500' : '400',
              flex: 1,
            }}
            numberOfLines={1}
          >
            {note.title || 'Untitled'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleDeleteNote(note.id, note.title)}
          hitSlop={10}
          style={{ paddingHorizontal: 10, paddingVertical: 6 }}
        >
          <Text style={{ fontSize: 18, color: tokens.textMuted, lineHeight: 20 }}>×</Text>
        </Pressable>
      </View>
    );
  }

  function renderFolder({ item: folder }: { item: Folder }) {
    const isActiveFolder = folder.id === activeFolderId;
    const isExpanded = expandedFolders.has(folder.id);
    const isRenaming = renamingFolderId === folder.id;

    const q = searchQuery.toLowerCase();
    const folderNotes = notes
      .filter((n) => {
        if (n.folderId !== folder.id) return false;
        if (q) return (n.title || '').toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q);
        return true;
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const shouldExpand = isExpanded || (q.length > 0 && folderNotes.length > 0);

    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => handleFolderPress(folder.id, folder.name)}
            onLongPress={() => handleDeleteFolder(folder.id, folder.name)}
            delayLongPress={500}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: isActiveFolder ? 22 : 24,
              paddingRight: 8,
              paddingVertical: 8,
              borderLeftWidth: isActiveFolder ? 2 : 0,
              borderLeftColor: tokens.accent,
              backgroundColor: isActiveFolder ? '#2A2A2A' : 'transparent',
            }}
          >
            <MaterialCommunityIcons
              name={shouldExpand ? 'chevron-down' : 'chevron-right'}
              size={16}
              color={tokens.textHint}
              style={{ marginRight: 4, width: 16 }}
            />
            <MaterialCommunityIcons
              name={shouldExpand ? 'folder-open' : 'folder'}
              size={16}
              color={isActiveFolder ? tokens.accentLight : tokens.textMuted}
              style={{ marginRight: 7 }}
            />

            {isRenaming ? (
              <TextInput
                autoFocus
                value={renameValue}
                onChangeText={setRenameValue}
                onSubmitEditing={() => commitFolderRename(folder.id, folder.name)}
                onBlur={() => commitFolderRename(folder.id, folder.name)}
                onKeyPress={(e: any) => {
                  if (e?.nativeEvent?.key === 'Escape') {
                    e.preventDefault?.();
                    cancelFolderRename();
                  }
                }}
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: tokens.textBody,
                  fontWeight: '500',
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
                  color: isActiveFolder ? tokens.textBody : tokens.textMuted,
                  fontWeight: isActiveFolder ? '500' : '400',
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {folder.name}
              </Text>
            )}
          </Pressable>

          {!isRenaming && (
            <Pressable
              onPress={() => handleDeleteFolder(folder.id, folder.name)}
              hitSlop={10}
              style={{ paddingHorizontal: 10, paddingVertical: 8 }}
            >
              <Text style={{ fontSize: 18, color: tokens.textMuted, lineHeight: 20 }}>×</Text>
            </Pressable>
          )}
        </View>

        {shouldExpand && (
          <View>
            <FlatList
              data={folderNotes}
              keyExtractor={(note) => note.id}
              renderItem={renderNote}
              scrollEnabled={false}
            />
            {!q && (
              <Pressable
                onPress={() => handleCreateNewNote(folder.id)}
                style={{ paddingLeft: 48, paddingVertical: 5 }}
              >
                <Text style={{ fontSize: 11, color: tokens.textHint }}>+ New Note</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <FlatList
      data={notebookFolders}
      keyExtractor={(item) => item.id}
      renderItem={renderFolder}
      scrollEnabled={false}
    />
  );
}
