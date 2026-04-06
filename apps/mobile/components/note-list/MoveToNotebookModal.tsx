import { View, Text, Pressable, Modal, FlatList } from 'react-native';
import { tokens } from '@graphite/ui';
import { getDatabase } from '@graphite/db';
import type { Notebook } from '@graphite/db';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';

interface MoveToNotebookModalProps {
  visible: boolean;
  noteId: string;
  currentNotebookId: string;
  onClose: () => void;
}

export default function MoveToNotebookModal({
  visible,
  noteId,
  currentNotebookId,
  onClose,
}: MoveToNotebookModalProps) {
  const notebooks = useNotebookStore((s) => s.notebooks);
  const moveNoteToNotebook = useNoteStore((s) => s.moveNoteToNotebook);

  const targets = notebooks.filter((nb) => nb.id !== currentNotebookId);

  async function handleSelect(notebook: Notebook) {
    try {
      const db = getDatabase();
      await moveNoteToNotebook(db, noteId, notebook.id, null);
    } catch {
      // db not ready
    }
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}
      >
        <Pressable
          onPress={() => {}}
          style={{ width: 300, maxHeight: 400, backgroundColor: tokens.bgSidebar, borderWidth: 1, borderColor: tokens.border, borderRadius: 0, padding: 0 }}
        >
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: tokens.border }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.textPrimary, letterSpacing: 0.5 }}>MOVE TO NOTEBOOK</Text>
          </View>
          {targets.length === 0 ? (
            <View style={{ padding: 16 }}>
              <Text style={{ fontSize: 13, color: tokens.textMuted }}>No other notebooks available.</Text>
            </View>
          ) : (
            <FlatList
              data={targets}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelect(item)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    backgroundColor: pressed ? tokens.bgHover : 'transparent',
                    borderLeftWidth: 2,
                    borderLeftColor: pressed ? tokens.accent : 'transparent',
                  })}
                >
                  <Text style={{ fontSize: 14, color: tokens.textBody }}>{item.name}</Text>
                </Pressable>
              )}
            />
          )}
          <Pressable
            onPress={onClose}
            style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: tokens.border }}
          >
            <Text style={{ fontSize: 13, color: tokens.textMuted }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
