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

  const notebookFolders = folders.filter((f) => f.notebookId === notebookId);

  function handleFolderPress(folderId: string) {
    setActiveFolder(folderId);
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
        const isActive = folder.id === activeFolderId;
        return (
          <Pressable
            key={folder.id}
            onPress={() => handleFolderPress(folder.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: isActive ? 26 : 28,
              paddingRight: 16,
              paddingVertical: 6,
              borderLeftWidth: isActive ? 2 : 0,
              borderLeftColor: tokens.accent,
              backgroundColor: isActive ? tokens.bgActive : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                color: isActive ? tokens.textBody : tokens.textMuted,
                fontWeight: isActive ? '500' : '400',
              }}
              numberOfLines={1}
            >
              {folder.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
