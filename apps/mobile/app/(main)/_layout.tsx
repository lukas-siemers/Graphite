import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  getSetting,
  setSetting,
  seedSampleNotebook,
} from '@graphite/db';
import { tokens } from '@graphite/ui';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';
import { useFolderStore } from '../../stores/use-folder-store';
import { useEditorStore } from '../../stores/use-editor-store';
import Sidebar from '../../components/sidebar/Sidebar';
import NoteList from '../../components/note-list/NoteList';
import Editor from '../../components/editor/Editor';
import { FormattingToolbar } from '../../components/editor/FormattingToolbar';
import WelcomeScreen from '../../components/onboarding/WelcomeScreen';

type PhoneScreen = 'sidebar' | 'list' | 'editor';

function PhoneLayout() {
  const [screen, setScreen] = useState<PhoneScreen>('sidebar');
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const inputMode = useEditorStore((s) => s.inputMode);
  const toggleInputMode = useEditorStore((s) => s.toggleInputMode);

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
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bgBase }}>
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
            <Editor />
            {/* FAB — toggles ink/scroll input mode; iPad/native only */}
            {Platform.OS !== 'web' && <Pressable
              onPress={toggleInputMode}
              style={({ pressed }) => ({
                position: 'absolute',
                bottom: 24,
                right: 24,
                width: 48,
                height: 48,
                borderRadius: 0,
                backgroundColor: pressed ? tokens.accentPressed : (inputMode === 'ink' ? tokens.accentPressed : tokens.accent),
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Text style={{ fontSize: 22, color: '#4D2600' }}>✏</Text>
            </Pressable>}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function IPadLayout() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const inputMode = useEditorStore((s) => s.inputMode);
  const toggleInputMode = useEditorStore((s) => s.toggleInputMode);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: tokens.bgBase }}>
        {/* Sidebar — collapses via width */}
        <View
          style={{
            width: sidebarVisible ? 260 : 0,
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
              height: 52,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: tokens.bgBase,
              borderBottomWidth: 1,
              borderBottomColor: tokens.border,
              paddingLeft: 8,
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
                marginRight: 4,
              }}
            >
              <Text style={{ fontSize: 16, color: tokens.textMuted }}>{'\u2630'}</Text>
            </Pressable>

            {/* Formatting toolbar */}
            <FormattingToolbar
              onToggleDrawing={toggleInputMode}
              drawingOpen={inputMode === 'ink'}
            />
          </View>

          {/* Editor area */}
          <View style={{ flex: 1, position: 'relative' }}>
            <Editor />
            {/* FAB — toggles ink/scroll input mode; iPad/native only */}
            {Platform.OS !== 'web' && <Pressable
              onPress={toggleInputMode}
              style={({ pressed }) => ({
                position: 'absolute',
                bottom: 24,
                right: 24,
                width: 48,
                height: 48,
                borderRadius: 0,
                backgroundColor: pressed ? tokens.accentPressed : (inputMode === 'ink' ? tokens.accentPressed : tokens.accent),
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Text style={{ fontSize: 22, color: '#4D2600' }}>✏</Text>
            </Pressable>}
          </View>
        </View>
      </View>
    </SafeAreaView>
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
  // null = loading, false = show onboarding, true = skip
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  const setNotebooks = useNotebookStore((s) => s.setNotebooks);
  const setActiveNotebook = useNotebookStore((s) => s.setActiveNotebook);
  const setFolders = useFolderStore((s) => s.setFolders);
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder);
  const setNotes = useNoteStore((s) => s.setNotes);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  useEffect(() => {
    initDatabase()
      .then(async (db) => {
        // Check onboarding flag
        const onboardingFlag = await getSetting(db, 'onboarding_completed');
        if (onboardingFlag !== '1') {
          setOnboardingDone(false);
          setDbReady(true);
          return;
        }

        setOnboardingDone(true);
        await loadAppData(db);
        setDbReady(true);
      })
      .catch(console.error);
  }, []);

  async function loadAppData(db: Awaited<ReturnType<typeof initDatabase>>) {
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
  }

  async function handleOnboardingComplete() {
    const db = getDatabase();
    await seedSampleNotebook(db);
    await setSetting(db, 'onboarding_completed', '1');
    setOnboardingDone(true);
    await loadAppData(db);
  }

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

  if (onboardingDone === false) {
    return <WelcomeScreen onComplete={handleOnboardingComplete} />;
  }

  if (isIPad) {
    return <IPadLayout />;
  }

  return <PhoneLayout />;
}
