import { useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, updateFolder } from '@graphite/db';
import { useFolderStore } from '../../stores/use-folder-store';
import { useNoteStore } from '../../stores/use-note-store';

interface FolderTreeProps {
  notebookId: string;
}

export default function FolderTree({ notebookId }: FolderTreeProps) {
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder);
  const storeUpdateFolder = useFolderStore((s) => s.updateFolder);
  const loadFolders = useFolderStore((s) => s.loadFolders);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const createNewNote = useNoteStore((s) => s.createNewNote);

  const notebookFolders = folders.filter((f) => f.notebookId === notebookId);

  // Load this notebook's folders when the tree mounts (i.e. when the notebook
  // row is expanded).  loadFolders merges by notebook so calling it here never
  // wipes folders belonging to other expanded notebooks.
  useEffect(() => {
    try {
      const db = getDatabase();
      loadFolders(db, notebookId);
    } catch (_) {
      // db not ready yet — folders will remain as initialised
    }
  // loadFolders identity is stable (Zustand); notebookId never changes per mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const s = new Set<string>();
    notebookFolders.forEach((f) => s.add(f.id));
    return s;
  });
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function handleFolderPress(folderId: string) {
    const isAlreadyActive = folderId === activeFolderId;
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

  return (
    <View>
      {notebookFolders.map((folder) => {
        const isActiveFolder = folder.id === activeFolderId;
        const isExpanded = expandedFolders.has(folder.id);
        const isRenaming = renamingFolderId === folder.id;
        const folderNotes = notes.filter((n) => n.folderId === folder.id);

        return (
          <View key={folder.id}>
            <Pressable
              onPress={() => {
                if (isRenaming) return;
                handleFolderPress(folder.id);
              }}
              onLongPress={() => {
                if (!isRenaming) startFolderRename(folder.id, folder.name);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: isActiveFolder ? 26 : 28,
                paddingRight: 16,
                paddingVertical: 6,
                borderLeftWidth: isActiveFolder ? 2 : 0,
                borderLeftColor: tokens.accent,
                backgroundColor: isActiveFolder ? tokens.bgActive : 'transparent',
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
            </Pressable>

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
                        backgroundColor: isActiveNote ? tokens.bgActive : 'transparent',
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
        );
      })}
    </View>
  );
}
