import { useEffect, useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import {
  initDatabase,
  getNotebooks,
  getFolders,
  getNotes,
  createNotebook,
  createFolder,
  createNote,
  updateNote,
} from '@graphite/db';
import { tokens } from '@graphite/ui';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';
import { useFolderStore } from '../../stores/use-folder-store';
import Sidebar from '../../components/sidebar/Sidebar';
import NoteList from '../../components/note-list/NoteList';
import Editor from '../../components/editor/Editor';
import { DrawingCanvas } from '../../components/drawing';
import type { Stroke } from '../../components/drawing';

/** In-memory store for drawing strokes keyed by noteId (Phase 1 — no backend). */
const drawingStore = new Map<string, Stroke[]>();

type PhoneScreen = 'sidebar' | 'list' | 'editor';

function PhoneLayout() {
  const [screen, setScreen] = useState<PhoneScreen>('sidebar');
  const [drawingOpen, setDrawingOpen] = useState(false);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  // Navigate to editor when a note is selected
  useEffect(() => {
    if (activeNoteId && screen === 'list') {
      setScreen('editor');
    }
  }, [activeNoteId]);

  function goBack() {
    if (screen === 'editor') {
      setActiveNote(null);
      setScreen('list');
    } else if (screen === 'list') {
      setScreen('sidebar');
    }
  }

  const showBack = screen !== 'sidebar';
  const headerTitle =
    screen === 'sidebar' ? 'Graphite' : screen === 'list' ? 'Notes' : 'Editor';

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      {/* Phone header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 44,
          paddingHorizontal: 16,
          backgroundColor: tokens.bgSidebar,
          borderBottomWidth: 1,
          borderBottomColor: tokens.border,
        }}
      >
        {showBack && (
          <Pressable onPress={goBack} style={{ marginRight: 12 }}>
            <Text style={{ fontSize: 14, color: tokens.accent, fontWeight: '600' }}>
              {'< Back'}
            </Text>
          </Pressable>
        )}
        <Text
          style={{
            fontSize: 16,
            fontWeight: '700',
            color: tokens.textPrimary,
            letterSpacing: -0.3,
          }}
        >
          {headerTitle}
        </Text>
      </View>

      {/* Screen content */}
      <View style={{ flex: 1 }}>
        {screen === 'sidebar' && (
          <View style={{ flex: 1 }}>
            <PhoneSidebarWrapper onNavigate={() => setScreen('list')} />
          </View>
        )}
        {screen === 'list' && (
          <View style={{ flex: 1 }}>
            <NoteList />
          </View>
        )}
        {screen === 'editor' && (
          <View style={{ flex: 1, position: 'relative' }}>
            <Editor
              onToggleDrawing={() => setDrawingOpen((v) => !v)}
              drawingOpen={drawingOpen}
            />
            {/* FAB — tangerine circle, draws over the editor */}
            <Pressable
              onPress={() => setDrawingOpen((v) => !v)}
              style={({ pressed }) => ({
                position: 'absolute',
                bottom: 24,
                right: 24,
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: pressed ? tokens.accentPressed : tokens.accent,
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Text style={{ fontSize: 22, color: '#4D2600' }}>✏</Text>
            </Pressable>
            {drawingOpen && activeNoteId && (
              <DrawingCanvas
                noteId={activeNoteId}
                initialStrokes={drawingStore.get(activeNoteId) ?? []}
                onClose={() => setDrawingOpen(false)}
                onSave={(strokes) => {
                  drawingStore.set(activeNoteId, strokes);
                  setDrawingOpen(false);
                }}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// Wraps Sidebar to trigger navigation on notebook/folder select
function PhoneSidebarWrapper({ onNavigate }: { onNavigate: () => void }) {
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);

  useEffect(() => {
    if (activeNotebookId) {
      onNavigate();
    }
  }, [activeNotebookId]);

  return <Sidebar />;
}

export default function MainLayout() {
  const { width } = useWindowDimensions();
  const isIPad = width >= 768;
  const [dbReady, setDbReady] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);

  const setNotebooks = useNotebookStore((s) => s.setNotebooks);
  const setActiveNotebook = useNotebookStore((s) => s.setActiveNotebook);
  const setFolders = useFolderStore((s) => s.setFolders);
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder);
  const setNotes = useNoteStore((s) => s.setNotes);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);

  useEffect(() => {
    initDatabase()
      .then(async (db) => {
        let notebooks = await getNotebooks(db);

        if (notebooks.length === 0) {
          // Seed default data
          const nb = await createNotebook(db, 'My Notebook');
          const folder = await createFolder(db, nb.id, 'General');
          const note = await createNote(db, nb.id, folder.id);
          await updateNote(db, note.id, {
            title: 'Welcome to Graphite',
            body: '# Welcome\n\nStart writing your notes here.',
          });

          notebooks = await getNotebooks(db);
          const folders = await getFolders(db, nb.id);
          const notes = await getNotes(db, nb.id, folder.id);

          setNotebooks(notebooks);
          setFolders(folders);
          setNotes(notes);
          setActiveNotebook(nb.id);
          setActiveFolder(folder.id);
          if (notes.length > 0) setActiveNote(notes[0].id);
        } else {
          // Load existing data
          const nb = notebooks[0];
          const folders = await getFolders(db, nb.id);
          const activeFolderId = folders.length > 0 ? folders[0].id : undefined;
          const notes = await getNotes(db, nb.id, activeFolderId ?? null);

          setNotebooks(notebooks);
          setFolders(folders);
          setNotes(notes);
          setActiveNotebook(nb.id);
          if (activeFolderId) setActiveFolder(activeFolderId);
          if (notes.length > 0) setActiveNote(notes[0].id);
        }

        setDbReady(true);
      })
      .catch(console.error);
  }, []);

  if (!dbReady) {
    return (
      <View
        style={{ flex: 1, backgroundColor: tokens.bgBase, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: tokens.textPrimary, letterSpacing: -0.5 }}>
          Graphite
        </Text>
      </View>
    );
  }

  if (isIPad) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: tokens.bgBase }}>
        <View
          style={{
            width: 220,
            backgroundColor: tokens.bgSidebar,
            borderRightWidth: 1,
            borderRightColor: tokens.border,
          }}
        >
          <Sidebar />
        </View>
        <View
          style={{
            width: 280,
            backgroundColor: tokens.bgBase,
            borderRightWidth: 1,
            borderRightColor: tokens.border,
          }}
        >
          <NoteList />
        </View>
        <View style={{ flex: 1, backgroundColor: tokens.bgBase, position: 'relative' }}>
          <Editor
            onToggleDrawing={() => setDrawingOpen((v) => !v)}
            drawingOpen={drawingOpen}
          />
          {/* FAB — tangerine circle, draws over the editor */}
          <Pressable
            onPress={() => setDrawingOpen((v) => !v)}
            style={({ pressed }) => ({
              position: 'absolute',
              bottom: 24,
              right: 24,
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: pressed ? tokens.accentPressed : tokens.accent,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Text style={{ fontSize: 22, color: '#4D2600' }}>✏</Text>
          </Pressable>
          {drawingOpen && activeNoteId && (
            <DrawingCanvas
              noteId={activeNoteId}
              initialStrokes={drawingStore.get(activeNoteId) ?? []}
              onClose={() => setDrawingOpen(false)}
              onSave={(strokes) => {
                drawingStore.set(activeNoteId, strokes);
                setDrawingOpen(false);
              }}
            />
          )}
        </View>
      </View>
    );
  }

  return <PhoneLayout />;
}
