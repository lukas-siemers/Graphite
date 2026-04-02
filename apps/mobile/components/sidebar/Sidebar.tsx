import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { tokens } from '@graphite/ui';
import { getDatabase } from '@graphite/db';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';
import { useFolderStore } from '../../stores/use-folder-store';
import FolderTree from './FolderTree';

export default function Sidebar() {
  const notebooks = useNotebookStore((s) => s.notebooks);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const setActiveNotebook = useNotebookStore((s) => s.setActiveNotebook);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const loadFolders = useFolderStore((s) => s.loadFolders);
  const createNewNote = useNoteStore((s) => s.createNewNote);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(notebooks.map((n) => n.id)),
  );
  const [newNotePressed, setNewNotePressed] = useState(false);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleNotebookPress(notebookId: string) {
    setActiveNotebook(notebookId);
    try {
      const db = getDatabase();
      await loadFolders(db, notebookId);
      await loadNotes(db, notebookId, null);
    } catch (_) {
      // db not ready yet
    }
  }

  async function handleNewNote() {
    if (!activeNotebookId) return;
    try {
      const db = getDatabase();
      await createNewNote(db, activeNotebookId, activeFolderId ?? undefined);
    } catch (_) {
      // db not ready yet
    }
  }

  return (
    <View style={{ flex: 1, flexDirection: 'column', backgroundColor: tokens.bgSidebar }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: 12,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: '700',
            color: tokens.textPrimary,
            letterSpacing: -0.5,
          }}
        >
          Graphite
        </Text>
      </View>

      {/* Notebook list */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {notebooks.map((notebook) => {
          const isActive = notebook.id === activeNotebookId;
          const isExpanded = expandedIds.has(notebook.id);
          return (
            <View key={notebook.id}>
              <Pressable
                onPress={() => {
                  handleNotebookPress(notebook.id);
                  toggleExpand(notebook.id);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingRight: 16,
                  paddingLeft: isActive ? 14 : 16,
                  borderLeftWidth: isActive ? 2 : 0,
                  borderLeftColor: tokens.accent,
                  backgroundColor: isActive ? tokens.bgActive : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    color: tokens.textMuted,
                    marginRight: 6,
                    width: 10,
                  }}
                >
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '500',
                    color: tokens.textBody,
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {notebook.name}
                </Text>
              </Pressable>
              {isExpanded && <FolderTree notebookId={notebook.id} />}
            </View>
          );
        })}
      </ScrollView>

      {/* New Note button */}
      <View style={{ marginHorizontal: 12, marginVertical: 8 }}>
        <Pressable
          onPress={handleNewNote}
          onPressIn={() => setNewNotePressed(true)}
          onPressOut={() => setNewNotePressed(false)}
          style={{
            backgroundColor: newNotePressed ? tokens.accentPressed : tokens.accent,
            paddingVertical: 10,
            borderRadius: 0,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: '#4D2600',
              fontWeight: '600',
              fontSize: 14,
            }}
          >
            + New Note
          </Text>
        </Pressable>
      </View>

      {/* Footer */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: tokens.border,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: tokens.bgHover,
          }}
        />
        <Text style={{ fontSize: 18, color: tokens.textMuted }}>{'\u2699'}</Text>
      </View>
    </View>
  );
}
