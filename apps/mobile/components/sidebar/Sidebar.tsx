import { useState, useRef } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, updateNotebook } from '@graphite/db';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';
import { useFolderStore } from '../../stores/use-folder-store';
import FolderTree from './FolderTree';

export default function Sidebar() {
  const notebooks = useNotebookStore((s) => s.notebooks);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const setActiveNotebook = useNotebookStore((s) => s.setActiveNotebook);
  const storeUpdateNotebook = useNotebookStore((s) => s.updateNotebook);
  const createNewNotebook = useNotebookStore((s) => s.createNewNotebook);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const loadFolders = useFolderStore((s) => s.loadFolders);
  const createNewFolder = useFolderStore((s) => s.createNewFolder);
  const createNewNote = useNoteStore((s) => s.createNewNote);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(notebooks.map((n) => n.id)),
  );
  const [newNotePressed, setNewNotePressed] = useState(false);
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<TextInput>(null);

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

  function startRename(notebookId: string, currentName: string) {
    setRenamingNotebookId(notebookId);
    setRenameValue(currentName);
    // Focus happens via autoFocus on the TextInput
  }

  async function commitRename(notebookId: string, originalName: string) {
    const trimmed = renameValue.trim();
    const finalName = trimmed.length > 0 ? trimmed : originalName;
    setRenamingNotebookId(null);
    setRenameValue('');
    if (finalName === originalName) return;
    try {
      const db = getDatabase();
      await updateNotebook(db, notebookId, finalName);
      storeUpdateNotebook(notebookId, { name: finalName });
    } catch (_) {
      // db not ready yet
    }
  }

  async function handleCreateNewNotebook() {
    try {
      const db = getDatabase();
      const notebook = await createNewNotebook(db, 'New Notebook');
      setExpandedIds((prev) => new Set([...prev, notebook.id]));
      startRename(notebook.id, notebook.name);
    } catch (_) {
      // db not ready yet
    }
  }

  async function handleCreateNewFolder(notebookId: string) {
    try {
      const db = getDatabase();
      await createNewFolder(db, notebookId, 'New Folder');
    } catch (_) {
      // db not ready yet
    }
  }

  return (
    <View style={{ flex: 1, flexDirection: 'column', backgroundColor: tokens.bgSidebar }}>
      {/* Header */}
      <View
        style={{
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: tokens.border,
        }}
      >
        <Text style={{ fontSize: 14, color: tokens.accentLight, marginRight: 6 }}>
          {'\u25C6'}
        </Text>
        <Text
          style={{
            fontSize: 15,
            fontWeight: '600',
            color: tokens.textPrimary,
          }}
        >
          Graphite
        </Text>
      </View>

      {/* NOTEBOOKS section label row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingTop: 16,
          paddingBottom: 8,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: '500',
            color: tokens.textMuted,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          NOTEBOOKS
        </Text>
        <Pressable
          onPress={handleCreateNewNotebook}
          hitSlop={8}
          style={{ paddingHorizontal: 4 }}
        >
          <Text style={{ fontSize: 16, color: tokens.textMuted, lineHeight: 18 }}>
            +
          </Text>
        </Pressable>
      </View>

      {/* Notebook list */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {notebooks.map((notebook) => {
          const isActive = notebook.id === activeNotebookId;
          const isExpanded = expandedIds.has(notebook.id);
          const isRenaming = renamingNotebookId === notebook.id;

          return (
            <View key={notebook.id}>
              <Pressable
                onPress={() => {
                  if (isRenaming) return;
                  handleNotebookPress(notebook.id);
                  toggleExpand(notebook.id);
                }}
                onLongPress={() => {
                  if (!isRenaming) startRename(notebook.id, notebook.name);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 6,
                  paddingRight: 8,
                  paddingLeft: isActive ? 6 : 8,
                  borderLeftWidth: isActive ? 2 : 0,
                  borderLeftColor: tokens.accent,
                  backgroundColor: isActive ? tokens.bgActive : 'transparent',
                }}
              >
                {/* Expand/collapse arrow */}
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

                {/* Folder icon */}
                <MaterialCommunityIcons
                  name="folder"
                  size={15}
                  color={isActive ? tokens.accentLight : tokens.textMuted}
                  style={{ marginRight: 6 }}
                />

                {/* Name or rename input */}
                {isRenaming ? (
                  <TextInput
                    ref={renameInputRef}
                    autoFocus
                    value={renameValue}
                    onChangeText={setRenameValue}
                    onSubmitEditing={() => commitRename(notebook.id, notebook.name)}
                    onBlur={() => commitRename(notebook.id, notebook.name)}
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
                      fontWeight: '500',
                      color: isActive ? tokens.textBody : tokens.textMuted,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {notebook.name}
                  </Text>
                )}

                {/* New folder "+" button */}
                {isExpanded && !isRenaming && (
                  <Pressable
                    onPress={() => handleCreateNewFolder(notebook.id)}
                    hitSlop={8}
                    style={{ paddingHorizontal: 4 }}
                  >
                    <Text style={{ fontSize: 14, color: tokens.textMuted, lineHeight: 18 }}>
                      +
                    </Text>
                  </Pressable>
                )}
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
            backgroundColor: newNotePressed ? tokens.accentPressed : tokens.accentTint,
            paddingVertical: 8,
            borderRadius: 0,
            borderWidth: 1,
            borderColor: tokens.accent,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: tokens.accentLight,
              fontWeight: '500',
              fontSize: 13,
            }}
          >
            New Note
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 0,
              backgroundColor: tokens.bgHover,
            }}
          />
          <Text style={{ fontSize: 12, color: tokens.textBody }}>Lukas S.</Text>
        </View>
        <Text style={{ fontSize: 18, color: tokens.textMuted }}>{'\u2699'}</Text>
      </View>
    </View>
  );
}
