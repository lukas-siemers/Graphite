import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, Alert } from 'react-native';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, updateFolder } from '@graphite/db';
import type { Folder } from '@graphite/db';
import { useFolderStore } from '../../stores/use-folder-store';
import { useNoteStore } from '../../stores/use-note-store';

// Delay before a single tap fires expand/collapse. A second tap within this
// window is treated as a double-tap and triggers rename instead.
const DOUBLE_TAP_MS = 500;

interface FolderTreeProps {
  notebookId: string;
}

export default function FolderTree({ notebookId }: FolderTreeProps) {
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

  const notebookFolders = folders
    .filter((f) => f.notebookId === notebookId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Load this notebook's folders when the tree mounts (i.e. when the notebook
  // row is expanded). loadFolders merges by notebook so calling it here never
  // wipes folders belonging to other expanded notebooks.
  //
  // BUG FIX: expandedFolders is initialised synchronously before loadFolders
  // resolves, so the initial set is empty. After the async load completes, merge
  // the freshly loaded folder IDs into expandedFolders so they appear expanded
  // rather than collapsed.
  useEffect(() => {
    async function loadAndExpand() {
      try {
        const db = getDatabase();
        await loadFolders(db, notebookId);
        // After load resolves the store has updated; read the fresh slice directly.
        const fresh = useFolderStore
          .getState()
          .folders.filter((f) => f.notebookId === notebookId);
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          fresh.forEach((f) => next.add(f.id));
          return next;
        });
      } catch (_) {
        // db not ready yet — folders will remain as initialised
      }
    }
    loadAndExpand();
  // loadFolders identity is stable (Zustand); notebookId never changes per mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Double-tap implementation:
  //   - First tap: schedule the expand/collapse action after DOUBLE_TAP_MS.
  //   - Second tap within DOUBLE_TAP_MS: cancel the scheduled action, fire rename.
  // This prevents expand/collapse from firing at all when a double-tap follows,
  // eliminating the flicker that previously triggered FolderTree remounts.
  const pendingTapRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function handleFolderPress(folderId: string, folderName: string) {
    if (renamingFolderId === folderId) return;

    const pending = pendingTapRef.current.get(folderId);
    if (pending !== undefined) {
      // Second tap within window — cancel single-tap action and rename instead.
      clearTimeout(pending);
      pendingTapRef.current.delete(folderId);
      startFolderRename(folderId, folderName);
      return;
    }

    // First tap — schedule the expand/collapse + active-folder action.
    const timer = setTimeout(() => {
      pendingTapRef.current.delete(folderId);

      const isAlreadyActive = folderId === useFolderStore.getState().activeFolderId;
      // Always toggle expand/collapse
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
        }
        return next;
      });
      // Only reload notes when switching to a different folder —
      // collapsing the active folder must not wipe the note list
      if (isAlreadyActive) return;
      setActiveFolder(folderId);
      try {
        const db = getDatabase();
        loadNotes(db, notebookId, folderId);
      } catch (_) {
        // db not ready yet
      }
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
    } catch (_) {
      // db not ready yet
    }
  }

  async function handleCreateNewNote(folderId: string) {
    try {
      const db = getDatabase();
      await createNewNote(db, notebookId, folderId);
    } catch (_) {
      // db not ready yet
    }
  }

  // Extracted so both the long-press handler and the × button can invoke it.
  function handleDeleteFolder(folderId: string, folderName: string) {
    Alert.alert(
      'Delete Folder',
      `Delete "${folderName}" and all its notes? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
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
                noteStore.setNotes(
                  noteStore.notes.filter((n) => n.folderId !== folderId),
                );
              }
            } catch (_) {
              // db not ready yet
            }
          },
        },
      ],
    );
  }

  function handleFolderLongPress(folderId: string, folderName: string) {
    Alert.alert(
      folderName,
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: () => startFolderRename(folderId, folderName),
        },
        {
          text: 'Delete Folder',
          style: 'destructive',
          onPress: () => handleDeleteFolder(folderId, folderName),
        },
      ],
    );
  }

  function renderFolder({ item: folder, drag }: RenderItemParams<Folder>) {
    const isActiveFolder = folder.id === activeFolderId;
    const isExpanded = expandedFolders.has(folder.id);
    const isRenaming = renamingFolderId === folder.id;
    const folderNotes = notes.filter((n) => n.folderId === folder.id);

    return (
      <ScaleDecorator>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Drag handle */}
            <Pressable
              onLongPress={drag}
              delayLongPress={150}
              hitSlop={4}
              style={{ paddingLeft: 12, paddingRight: 4, paddingVertical: 6 }}
            >
              <Text style={{ fontSize: 13, color: tokens.textHint, lineHeight: 18 }}>
                {'\u2630'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleFolderPress(folder.id, folder.name)}
              onLongPress={() => {
                if (!isRenaming) {
                  handleFolderLongPress(folder.id, folder.name);
                }
              }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: isActiveFolder ? 0 : 2,
                paddingRight: 8,
                paddingVertical: 6,
                borderLeftWidth: isActiveFolder ? 2 : 0,
                borderLeftColor: tokens.accent,
                backgroundColor: isActiveFolder ? tokens.bgHover : 'transparent',
              }}
            >
              {/* Expand/collapse arrow */}
              <Text
                style={{
                  fontSize: 11,
                  color: tokens.textMuted,
                  marginRight: 4,
                }}
              >
                {isExpanded ? '▼' : '▶'}
              </Text>

              {/* Name or rename input */}
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

              {/* Delete × button */}
              {!isRenaming && (
                <Pressable
                  onPress={() => handleDeleteFolder(folder.id, folder.name)}
                  hitSlop={8}
                  style={{ paddingHorizontal: 4 }}
                >
                  {({ pressed }: { pressed: boolean }) => (
                    <Text
                      style={{
                        fontSize: 14,
                        color: pressed ? tokens.accent : tokens.textMuted,
                        lineHeight: 18,
                      }}
                    >
                      ×
                    </Text>
                  )}
                </Pressable>
              )}
            </Pressable>
          </View>

          {isExpanded && (
            <View>
              {folderNotes.map((note) => {
                const isActiveNote = note.id === activeNoteId;
                return (
                  <Pressable
                    key={note.id}
                    onPress={() => setActiveNote(note.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingLeft: isActiveNote ? 42 : 44,
                      paddingRight: 16,
                      paddingVertical: 5,
                      borderLeftWidth: isActiveNote ? 2 : 0,
                      borderLeftColor: tokens.accent,
                      backgroundColor: isActiveNote ? tokens.bgHover : 'transparent',
                    }}
                  >
                    <MaterialCommunityIcons
                      name="file-document-outline"
                      size={13}
                      color={isActiveNote ? tokens.accentLight : tokens.textMuted}
                      style={{ marginRight: 6 }}
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
                );
              })}

              {/* New Note row at the bottom of each folder */}
              <Pressable
                onPress={() => handleCreateNewNote(folder.id)}
                style={{
                  paddingLeft: 44,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: tokens.textHint,
                  }}
                >
                  + New Note
                </Text>
              </Pressable>
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
        } catch (_) {
          // db not ready yet
        }
      }}
      renderItem={renderFolder}
      scrollEnabled={false}
    />
  );
}
