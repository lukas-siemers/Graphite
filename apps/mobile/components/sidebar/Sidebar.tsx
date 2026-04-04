import { useState, useRef } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Image, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, updateNotebook } from '@graphite/db';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';
import { useFolderStore } from '../../stores/use-folder-store';
import FolderTree from './FolderTree';

// Delay before a single tap fires expand/collapse. A second tap within this
// window is treated as a double-tap and triggers rename instead.
const DOUBLE_TAP_MS = 500;

export default function Sidebar() {
  const notebooks = useNotebookStore((s) => s.notebooks);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const setActiveNotebook = useNotebookStore((s) => s.setActiveNotebook);
  const storeUpdateNotebook = useNotebookStore((s) => s.updateNotebook);
  const createNewNotebook = useNotebookStore((s) => s.createNewNotebook);
  const moveNotebookUp = useNotebookStore((s) => s.moveNotebookUp);
  const moveNotebookDown = useNotebookStore((s) => s.moveNotebookDown);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNewFolder = useFolderStore((s) => s.createNewFolder);
  const createNewNote = useNoteStore((s) => s.createNewNote);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const s = new Set<string>();
    notebooks.forEach((n) => s.add(n.id));
    return s;
  });
  const [newNotePressed, setNewNotePressed] = useState(false);
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [reorderMode, setReorderMode] = useState(false);
  const renameInputRef = useRef<TextInput>(null);

  // Double-tap implementation:
  //   - First tap: schedule the expand/collapse (and active-notebook switch) after
  //     DOUBLE_TAP_MS. Store the timer ID keyed by notebookId.
  //   - Second tap within DOUBLE_TAP_MS: cancel the scheduled action, fire rename.
  // This prevents expand/collapse from firing at all when a double-tap follows.
  const pendingTapRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function handleNotebookPress(notebookId: string, notebookName: string) {
    if (renamingNotebookId === notebookId) return;

    const pending = pendingTapRef.current.get(notebookId);
    if (pending !== undefined) {
      // Second tap within window — cancel single-tap action and rename instead.
      clearTimeout(pending);
      pendingTapRef.current.delete(notebookId);
      startRename(notebookId, notebookName);
      return;
    }

    // First tap — schedule the expand/collapse + active-notebook switch.
    const timer = setTimeout(() => {
      pendingTapRef.current.delete(notebookId);

      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(notebookId)) {
          next.delete(notebookId);
        } else {
          next.add(notebookId);
        }
        return next;
      });

      // Only reload data when switching to a different notebook.
      // Toggling expand/collapse on the active notebook must not wipe the note
      // list (especially on web where loadNotes returns empty).
      if (notebookId === activeNotebookId) return;
      setActiveNotebook(notebookId);
      // Do NOT call loadFolders here — each FolderTree loads its own folders on
      // mount. Calling loadFolders with the new notebook's ID replaces the
      // entire folder store, which makes the previously-expanded notebook's
      // FolderTree render empty while it is still visible.
      try {
        const db = getDatabase();
        loadNotes(db, notebookId, null);
      } catch (_) {
        // db not ready yet
      }
    }, DOUBLE_TAP_MS);

    pendingTapRef.current.set(notebookId, timer);
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

  // Extracted so both the long-press handler and the × button can invoke it.
  function handleDeleteNotebook(notebookId: string, notebookName: string) {
    Alert.alert(
      'Delete Notebook',
      `Delete "${notebookName}" and all its contents? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = getDatabase();
              await useNotebookStore.getState().deleteNotebook(db, notebookId);
              useFolderStore.getState().setFolders([]);
              useFolderStore.getState().setActiveFolder(null);
              useNoteStore.getState().setNotes([]);
              useNoteStore.getState().setActiveNote(null);
            } catch (_) {
              // db not ready yet
            }
          },
        },
      ],
    );
  }

  function handleNotebookLongPress(notebookId: string, notebookName: string) {
    Alert.alert(
      notebookName,
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: () => startRename(notebookId, notebookName),
        },
        {
          text: 'Delete Notebook',
          style: 'destructive',
          onPress: () => handleDeleteNotebook(notebookId, notebookName),
        },
      ],
    );
  }

  async function handleMoveUp(notebookId: string) {
    try {
      const db = getDatabase();
      await moveNotebookUp(db, notebookId);
    } catch (_) {
      // db not ready yet
    }
  }

  async function handleMoveDown(notebookId: string) {
    try {
      const db = getDatabase();
      await moveNotebookDown(db, notebookId);
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
        <Image
          source={require('../../assets/icon.png')}
          style={{ width: 22, height: 22, marginRight: 8 }}
          resizeMode="contain"
        />
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
        {/* Reorder toggle button */}
        <Pressable
          onPress={() => setReorderMode((v) => !v)}
          hitSlop={8}
          style={{ paddingHorizontal: 6 }}
        >
          <Text
            style={{
              fontSize: 11,
              color: reorderMode ? tokens.accent : tokens.textHint,
              fontWeight: '500',
            }}
          >
            Reorder
          </Text>
        </Pressable>
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
        {notebooks.map((notebook, index) => {
          const isActive = notebook.id === activeNotebookId;
          const isExpanded = expandedIds.has(notebook.id);
          const isRenaming = renamingNotebookId === notebook.id;
          const isFirst = index === 0;
          const isLast = index === notebooks.length - 1;

          return (
            <View key={notebook.id}>
              <Pressable
                onPress={() => {
                  if (reorderMode) return;
                  handleNotebookPress(notebook.id, notebook.name);
                }}
                onLongPress={() => {
                  if (!isRenaming && !reorderMode) {
                    handleNotebookLongPress(notebook.id, notebook.name);
                  }
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
                {/* Expand/collapse arrow — hidden in reorder mode */}
                {!reorderMode && (
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
                )}

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

                {/* Reorder ▲▼ buttons — shown only in reorder mode */}
                {reorderMode && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Pressable
                      onPress={() => !isFirst && handleMoveUp(notebook.id)}
                      hitSlop={6}
                      style={{ paddingHorizontal: 4, paddingVertical: 2 }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: isFirst ? tokens.textHint : tokens.textMuted,
                        }}
                      >
                        ▲
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => !isLast && handleMoveDown(notebook.id)}
                      hitSlop={6}
                      style={{ paddingHorizontal: 4, paddingVertical: 2 }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: isLast ? tokens.textHint : tokens.textMuted,
                        }}
                      >
                        ▼
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* New folder "+" button — hidden in reorder mode */}
                {isExpanded && !isRenaming && !reorderMode && (
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

                {/* Delete × button — shown next to "+" when expanded, or always
                    visible when collapsed, so the user can delete a closed notebook */}
                {!isRenaming && !reorderMode && (
                  <Pressable
                    onPress={() => handleDeleteNotebook(notebook.id, notebook.name)}
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

              {isExpanded && !reorderMode && (
                <FolderTree notebookId={notebook.id} reorderMode={false} />
              )}
              {isExpanded && reorderMode && (
                <FolderTree notebookId={notebook.id} reorderMode={true} />
              )}
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
