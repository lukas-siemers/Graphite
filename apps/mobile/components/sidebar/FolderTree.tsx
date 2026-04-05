import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, Alert, Platform } from 'react-native';

// On web, Alert.alert is unreliable — use window.confirm directly instead.
function webConfirmDelete(message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-restricted-globals
    if (confirm(message)) onConfirm();
  } else {
    Alert.alert('Delete', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ]);
  }
}
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, updateFolder } from '@graphite/db';
import type { Folder, Note } from '@graphite/db';
import { useFolderStore } from '../../stores/use-folder-store';
import { useNoteStore } from '../../stores/use-note-store';

// Double-tap window. Long-press fires at 250ms (< this), cancels the pending
// single-tap timer before drag starts — so expand/collapse never fires mid-drag.
const DOUBLE_TAP_MS = 300;

interface FolderTreeProps {
  notebookId: string;
  searchQuery?: string;
}

export default function FolderTree({ notebookId, searchQuery = '' }: FolderTreeProps) {
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder);
  const storeUpdateFolder = useFolderStore((s) => s.updateFolder);
  const loadFolders = useFolderStore((s) => s.loadFolders);
  const reorderFolders = useFolderStore((s) => s.reorderFolders);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const createNewNote = useNoteStore((s) => s.createNewNote);
  const reorderNotes = useNoteStore((s) => s.reorderNotes);

  const notebookFolders = folders
    .filter((f) => f.notebookId === notebookId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Load this notebook's folders on mount (when the notebook row is expanded).
  // loadFolders merges by notebook so it never wipes folders from other open notebooks.
  useEffect(() => {
    async function loadAndExpand() {
      // On web the DB is a no-op — skip so we don't wipe in-memory folders.
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

  const pendingTapRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function handleFolderPress(folderId: string, folderName: string) {
    if (renamingFolderId === folderId) return;

    const pending = pendingTapRef.current.get(folderId);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingTapRef.current.delete(folderId);
      startFolderRename(folderId, folderName);
      return;
    }

    const timer = setTimeout(() => {
      pendingTapRef.current.delete(folderId);

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
    }, DOUBLE_TAP_MS);

    pendingTapRef.current.set(folderId, timer);
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
      await updateFolder(db, folderId, finalName);
      storeUpdateFolder(folderId, { name: finalName });
    } catch (_) {}
  }

  async function handleCreateNewNote(folderId: string) {
    try {
      const db = getDatabase();
      await createNewNote(db, notebookId, folderId);
    } catch (_) {}
  }

  function handleDeleteFolder(folderId: string, folderName: string) {
    webConfirmDelete(
      `Delete "${folderName}" and all its notes? This cannot be undone.`,
      async () => {
        try {
          const db = getDatabase();
          await useFolderStore.getState().deleteFolder(db, folderId);
          if (useFolderStore.getState().activeFolderId === folderId) {
            useFolderStore.getState().setActiveFolder(null);
          }
          const noteStore = useNoteStore.getState();
          const activeNoteInFolder = noteStore.notes.find(
            (n) => n.folderId === folderId && n.id === noteStore.activeNoteId,
          );
          if (activeNoteInFolder) {
            noteStore.setNotes([]);
            noteStore.setActiveNote(null);
          } else {
            noteStore.setNotes(noteStore.notes.filter((n) => n.folderId !== folderId));
          }
        } catch (_) {}
      },
    );
  }

  function renderNote({ item: note, drag, isActive: isDraggingNote }: RenderItemParams<Note>) {
    const isActiveNote = note.id === activeNoteId;
    return (
      <ScaleDecorator>
        <Pressable
          onPress={() => setActiveNote(note.id)}
          onLongPress={() => {
            // Cancel any pending folder single-tap before drag starts
            drag();
          }}
          delayLongPress={250}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: isActiveNote ? 46 : 48,
            paddingRight: 14,
            paddingVertical: 6,
            borderLeftWidth: isActiveNote ? 2 : 0,
            borderLeftColor: tokens.accent,
            backgroundColor: isDraggingNote ? tokens.bgHover : isActiveNote ? '#2A2A2A' : 'transparent',
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
      </ScaleDecorator>
    );
  }

  function renderFolder({ item: folder, drag, isActive: isDragging }: RenderItemParams<Folder>) {
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

    // If searching, auto-expand folders that have matching notes
    const shouldExpand = isExpanded || (q.length > 0 && folderNotes.length > 0);

    return (
      <ScaleDecorator>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              onPress={() => handleFolderPress(folder.id, folder.name)}
              onLongPress={() => {
                if (isRenaming) return;
                const pending = pendingTapRef.current.get(folder.id);
                if (pending !== undefined) {
                  clearTimeout(pending);
                  pendingTapRef.current.delete(folder.id);
                }
                drag();
              }}
              delayLongPress={250}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: isActiveFolder ? 22 : 24,
                paddingRight: 8,
                paddingVertical: 8,
                borderLeftWidth: isActiveFolder ? 2 : 0,
                borderLeftColor: tokens.accent,
                backgroundColor: isDragging ? tokens.bgHover : isActiveFolder ? '#2A2A2A' : 'transparent',
              }}
            >
              <MaterialCommunityIcons
                name={shouldExpand ? 'chevron-down' : 'chevron-right'}
                size={16}
                color={tokens.textHint}
                style={{ marginRight: 6, width: 16 }}
              />

              {isRenaming ? (
                <TextInput
                  autoFocus
                  value={renameValue}
                  onChangeText={setRenameValue}
                  onSubmitEditing={() => commitFolderRename(folder.id, folder.name)}
                  onBlur={() => commitFolderRename(folder.id, folder.name)}
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
              <DraggableFlatList
                data={folderNotes}
                keyExtractor={(note) => note.id}
                renderItem={renderNote}
                onDragEnd={({ data }) => {
                  try {
                    reorderNotes(getDatabase(), data.map((n) => n.id));
                  } catch (_) {}
                }}
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
      </ScaleDecorator>
    );
  }

  return (
    <DraggableFlatList
      data={notebookFolders}
      keyExtractor={(item) => item.id}
      onDragEnd={({ data }) => {
        try {
          reorderFolders(getDatabase(), notebookId, data.map((f) => f.id));
        } catch (_) {}
      }}
      renderItem={renderFolder}
      scrollEnabled={false}
    />
  );
}
