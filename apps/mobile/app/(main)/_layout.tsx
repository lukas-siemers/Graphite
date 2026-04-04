import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, useWindowDimensions } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  initDatabase,
  getDatabase,
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

// ---------------------------------------------------------------------------
// Drawing persistence helpers (Phase 1 — local filesystem via expo-file-system)
// ---------------------------------------------------------------------------

const DRAWINGS_DIR = `${FileSystem.documentDirectory}drawings/`;

async function ensureDrawingsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DRAWINGS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DRAWINGS_DIR, { intermediates: true });
  }
}

function drawingPath(noteId: string): string {
  return `${DRAWINGS_DIR}${noteId}.json`;
}

async function loadStrokes(noteId: string): Promise<Stroke[]> {
  try {
    const path = drawingPath(noteId);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return [];
    const json = await FileSystem.readAsStringAsync(path);
    return JSON.parse(json) as Stroke[];
  } catch {
    return [];
  }
}

async function saveStrokes(noteId: string, strokes: Stroke[]): Promise<string> {
  await ensureDrawingsDir();
  const path = drawingPath(noteId);
  await FileSystem.writeAsStringAsync(path, JSON.stringify(strokes));
  return path;
}

type PhoneScreen = 'sidebar' | 'list' | 'editor';

function PhoneLayout() {
  const [screen, setScreen] = useState<PhoneScreen>('sidebar');
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [initialStrokes, setInitialStrokes] = useState<Stroke[]>([]);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  // Navigate to editor when a note is selected.
  // Handles both the normal path (note picked from list → 'list' screen) and
  // the new-note path (note created from sidebar → 'sidebar' screen).
  useEffect(() => {
    if (activeNoteId && (screen === 'list' || screen === 'sidebar')) {
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
          backgroundColor: tokens.bgBase,
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
            {/* FAB — square tangerine, draws over the editor */}
            <Pressable
              onPress={async () => {
                if (!drawingOpen && activeNoteId) {
                  const strokes = await loadStrokes(activeNoteId);
                  setInitialStrokes(strokes);
                }
                setDrawingOpen((v) => !v);
              }}
              style={({ pressed }) => ({
                position: 'absolute',
                bottom: 24,
                right: 24,
                width: 48,
                height: 48,
                borderRadius: 0,
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
                initialStrokes={initialStrokes}
                onClose={() => setDrawingOpen(false)}
                onSave={async (strokes) => {
                  const path = await saveStrokes(activeNoteId, strokes);
                  const db = getDatabase();
                  await updateNote(db, activeNoteId, { drawingAssetId: path });
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

interface IPadLayoutProps {
  drawingOpen: boolean;
  setDrawingOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeNoteId: string | null;
}

function IPadLayout({ drawingOpen, setDrawingOpen, activeNoteId }: IPadLayoutProps) {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [initialStrokes, setInitialStrokes] = useState<Stroke[]>([]);

  const TOOLBAR_ITEMS = ['B', 'I', 'T', '<>', 'Link', '\u2014'] as const;
  const RIGHT_ICONS = ['\u21BB', '\u2197', '\u2699', '\u22EE'] as const;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: tokens.bgBase }}>
      {/* Sidebar — collapses via width */}
      <View
        style={{
          width: sidebarVisible ? 220 : 0,
          overflow: 'hidden',
          backgroundColor: tokens.bgSidebar,
          borderRightWidth: sidebarVisible ? 1 : 0,
          borderRightColor: tokens.border,
        }}
      >
        <Sidebar />
      </View>

      {/* Editor column */}
      <View style={{ flex: 1, flexDirection: 'column', backgroundColor: tokens.bgBase }}>
        {/* Top nav bar */}
        <View
          style={{
            height: 48,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: tokens.bgBase,
            borderBottomWidth: 1,
            borderBottomColor: tokens.border,
            paddingHorizontal: 8,
          }}
        >
          {/* Sidebar toggle */}
          <Pressable
            onPress={() => setSidebarVisible((v) => !v)}
            style={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 16, color: tokens.textMuted }}>{'\u2630'}</Text>
          </Pressable>

          {/* Vertical divider */}
          <View
            style={{
              width: 1,
              height: 20,
              backgroundColor: tokens.border,
              marginHorizontal: 8,
            }}
          />

          {/* Search input */}
          <View style={{ flex: 1, maxWidth: 380 }}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search Graphite..."
              placeholderTextColor={tokens.textHint}
              style={{
                backgroundColor: tokens.bgSidebar,
                borderWidth: 1,
                borderColor: tokens.border,
                borderRadius: 0,
                paddingTop: 6,
                paddingBottom: 6,
                paddingLeft: 36,
                paddingRight: 12,
                fontSize: 12,
                color: tokens.textBody,
              }}
            />
          </View>

          {/* Formatting buttons */}
          <View style={{ flexDirection: 'row', marginLeft: 8 }}>
            {TOOLBAR_ITEMS.map((label) => (
              <Pressable
                key={label}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? tokens.bgBright : tokens.bgHover,
                  marginRight: 2,
                })}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.textMuted }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Right side icons */}
          <View style={{ flexDirection: 'row', marginLeft: 'auto' }}>
            {RIGHT_ICONS.map((icon) => (
              <Pressable
                key={icon}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 16, color: tokens.textMuted }}>{icon}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Editor area */}
        <View style={{ flex: 1, position: 'relative' }}>
          <Editor
            onToggleDrawing={() => setDrawingOpen((v) => !v)}
            drawingOpen={drawingOpen}
          />
          {/* FAB — square tangerine */}
          <Pressable
            onPress={async () => {
              if (!drawingOpen && activeNoteId) {
                const strokes = await loadStrokes(activeNoteId);
                setInitialStrokes(strokes);
              }
              setDrawingOpen((v) => !v);
            }}
            style={({ pressed }) => ({
              position: 'absolute',
              bottom: 24,
              right: 24,
              width: 48,
              height: 48,
              borderRadius: 0,
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
              initialStrokes={initialStrokes}
              onClose={() => setDrawingOpen(false)}
              onSave={async (strokes) => {
                const path = await saveStrokes(activeNoteId, strokes);
                const db = getDatabase();
                await updateNote(db, activeNoteId, { drawingAssetId: path });
                setDrawingOpen(false);
              }}
            />
          )}
        </View>
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
    return <IPadLayout
      drawingOpen={drawingOpen}
      setDrawingOpen={setDrawingOpen}
      activeNoteId={activeNoteId}
    />;
  }

  return <PhoneLayout />;
}
