import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { tokens } from '@graphite/ui';
import { useFolderStore } from '../../stores/use-folder-store';
import { useNoteStore } from '../../stores/use-note-store';
import { getDatabase } from '@graphite/db';

interface FolderTreeProps {
  notebookId: string;
}

export default function FolderTree({ notebookId }: FolderTreeProps) {
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  const notebookFolders = folders.filter((f) => f.notebookId === notebookId);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(notebookFolders.map((f) => f.id)),
  );

  function handleFolderPress(folderId: string) {
    setActiveFolder(folderId);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
    try {
      const db = getDatabase();
      loadNotes(db, notebookId, folderId);
    } catch (_) {
      // db not ready yet
    }
  }

  return (
    <View>
      {notebookFolders.map((folder) => {
        const isActiveFolder = folder.id === activeFolderId;
        const isExpanded = expandedFolders.has(folder.id);
        const folderNotes = notes.filter((n) => n.folderId === folder.id);

        return (
          <View key={folder.id}>
            <Pressable
              onPress={() => handleFolderPress(folder.id)}
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
              <Text
                style={{
                  fontSize: 11,
                  color: tokens.textMuted,
                  marginRight: 4,
                }}
              >
                {isExpanded ? '▼' : '▶'}
              </Text>
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
            </Pressable>

            {isExpanded && folderNotes.map((note) => {
              const isActiveNote = note.id === activeNoteId;
              return (
                <Pressable
                  key={note.id}
                  onPress={() => setActiveNote(note.id)}
                  style={{
                    paddingLeft: isActiveNote ? 42 : 44,
                    paddingRight: 16,
                    paddingVertical: 5,
                    borderLeftWidth: isActiveNote ? 2 : 0,
                    borderLeftColor: tokens.accent,
                    backgroundColor: isActiveNote ? tokens.bgActive : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: isActiveNote ? tokens.accentLight : tokens.textMuted,
                      fontWeight: isActiveNote ? '500' : '400',
                    }}
                    numberOfLines={1}
                  >
                    {note.title || 'Untitled'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
