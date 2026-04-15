import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, Pressable, useWindowDimensions } from 'react-native';
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
import {
  assignYPositions,
  chunksFromMarkdown,
  createEmptySpatialCanvas,
  extractSearchableText,
  serializeToGraphite,
} from '@graphite/canvas';
import { tokens } from '@graphite/ui';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useNoteStore } from '../../stores/use-note-store';
import { useFolderStore } from '../../stores/use-folder-store';
import { useSyncEngine } from '../../hooks/use-sync-engine';
import { getCurrentSession } from '../../components/auth/AuthGate';
import Sidebar from '../../components/sidebar/Sidebar';
import NoteList from '../../components/note-list/NoteList';
import Editor from '../../components/editor/Editor';
import { FormattingToolbar } from '../../components/editor/FormattingToolbar';
import WelcomeScreen from '../../components/onboarding/WelcomeScreen';

type PhoneScreen = 'sidebar' | 'list' | 'editor';

function useCreateNoteAction(onCreated?: () => void) {
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);
  const createNewNote = useNoteStore((s) => s.createNewNote);

  return useCallback(async () => {
    if (!activeNotebookId) return;
    try {
      const db = getDatabase();
      await createNewNote(db, activeNotebookId, activeFolderId ?? undefined);
      onCreated?.();
    } catch (error) {
      Alert.alert(
        'Could not create note',
        error instanceof Error ? error.message : 'Graphite could not create a new markdown note.',
      );
    }
  }, [activeFolderId, activeNotebookId, createNewNote, onCreated]);
}

function PhoneLayout() {
  const [screen, setScreen] = useState<PhoneScreen>('sidebar');
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const handleCreateNote = useCreateNoteAction(() => setScreen('editor'));

  useEffect(() => {
    if (activeNoteId && (screen === 'list' || screen === 'sidebar')) {
      setScreen('editor');
    }
  }, [activeNoteId, screen]);

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
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bgBase }} edges={['top', 'left', 'right']}>
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
            flex: 1,
            fontSize: 16,
            fontWeight: '700',
            color: tokens.textPrimary,
            letterSpacing: -0.3,
          }}
        >
          {headerTitle}
        </Text>
        <Pressable
          onPress={handleCreateNote}
          hitSlop={10}
          style={{
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 20, color: tokens.textMuted, lineHeight: 20 }}>+</Text>
        </Pressable>
      </View>

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
            {/* Phone toolbar row — mounts FormattingToolbar so iPhone users
                reach Bold/Italic/Code/Link/Pencil. The iPad branch renders
                the same component inline in its chrome row; phone puts it
                just below the header and above the editor body. */}
            <View
              style={{
                height: 44,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: tokens.bgBase,
              }}
            >
              <FormattingToolbar />
            </View>
            <View style={{ flex: 1, position: 'relative' }}>
              <Editor />
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function IPadLayout() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const handleCreateNote = useCreateNoteAction();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bgBase }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: tokens.bgBase }}>
        <View
          style={{
            width: sidebarVisible ? 260 : 0,
            overflow: 'hidden',
            backgroundColor: tokens.bgSidebar,
          }}
        >
          <Sidebar />
        </View>

        <View style={{ flex: 1, flexDirection: 'column', backgroundColor: tokens.bgBase }}>
          <View
            style={{
              height: 52,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: tokens.bgBase,
              paddingLeft: 8,
            }}
          >
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

            <FormattingToolbar />
            <Pressable
              onPress={handleCreateNote}
              hitSlop={10}
              style={{
                width: 36,
                height: 36,
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 4,
                marginRight: 10,
              }}
            >
              <Text style={{ fontSize: 20, color: tokens.textMuted, lineHeight: 20 }}>+</Text>
            </Pressable>
          </View>

          <View style={{ flex: 1, position: 'relative' }}>
            <Editor />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function PhoneSidebarWrapper({ onNavigate }: { onNavigate: () => void }) {
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);

  useEffect(() => {
    if (activeNotebookId) {
      onNavigate();
    }
  }, [activeNotebookId, onNavigate]);

  return <Sidebar />;
}

export default function MainAppShell() {
  const { width } = useWindowDimensions();
  const isIPad = width >= 768;
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [startupStage, setStartupStage] = useState('main-shell-mounted');

  const setNotebooks = useNotebookStore((s) => s.setNotebooks);
  const setActiveNotebook = useNotebookStore((s) => s.setActiveNotebook);
  const setFolders = useFolderStore((s) => s.setFolders);
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder);
  const setNotes = useNoteStore((s) => s.setNotes);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  useSyncEngine(
    userId,
    process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  );

  useEffect(() => {
    setStartupStage('session-read');
    getCurrentSession()
      .then((session) => {
        setUserId(session?.user?.id ?? null);
        setStartupStage('session-ready');
      })
      .catch(() => {
        setStartupStage('session-failed');
      });
  }, []);

  useEffect(() => {
    let mounted = true;
    setStartupStage('db-init');

    initDatabase()
      .then(async (db) => {
        if (!mounted) return;
        setStartupStage('db-settings-read');
        const onboardingFlag = await getSetting(db, 'onboarding_completed');
        if (onboardingFlag !== '1') {
          setOnboardingDone(false);
          setStartupStage('db-ready-onboarding');
          setDbReady(true);
          return;
        }

        setOnboardingDone(true);
        setStartupStage('db-data-load');
        await loadAppData(db);
        setStartupStage('db-ready');
        setDbReady(true);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setDbError(error instanceof Error ? error.message : String(error));
        setStartupStage('db-failed');
        setDbReady(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function loadAppData(db: Awaited<ReturnType<typeof initDatabase>>) {
    let notebooks = await getNotebooks(db);

    if (notebooks.length === 0) {
      const nb = await createNotebook(db, 'My Notebook');
      const folder = await createFolder(db, nb.id, 'General');
      const note = await createNote(db, nb.id, folder.id);

      // Seed the welcome note as a v2 SpatialCanvasDocument so the v2
      // migration hook (v2 + no blob = empty canvas) doesn't silently drop
      // the welcome text. Build the blocks via the same block-chunking
      // helper the editor uses, serialize via serializeToGraphite, and
      // persist blob + ftsBody together so search works on day one.
      const welcomeBody = '# Welcome\n\nStart writing your notes here.';
      const spatialDoc = createEmptySpatialCanvas();
      spatialDoc.blocks = assignYPositions(
        chunksFromMarkdown(welcomeBody),
        24,
        16,
      );
      const graphiteBlob = await serializeToGraphite(spatialDoc);
      const ftsBody = extractSearchableText(spatialDoc);
      await updateNote(db, note.id, {
        title: 'Welcome to Graphite',
        graphiteBlob,
        ftsBody,
        canvasVersion: 2,
        body: '',
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
    setStartupStage('onboarding-seed');
    const db = getDatabase();
    await seedSampleNotebook(db);
    await setSetting(db, 'onboarding_completed', '1');
    setOnboardingDone(true);
    setStartupStage('db-data-load');
    await loadAppData(db);
    setStartupStage('db-ready');
  }

  if (!dbReady || dbError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.bgBase,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: tokens.textPrimary, letterSpacing: -0.5 }}>
          {dbError ? 'Graphite could not open your local notebook' : 'Graphite'}
        </Text>
        <Text
          style={{
            marginTop: 10,
            paddingHorizontal: 24,
            textAlign: 'center',
            fontSize: 12,
            color: tokens.textMuted,
          }}
        >
          Stage: {startupStage}
        </Text>
        {dbError && (
          <Text
            style={{
              marginTop: 12,
              paddingHorizontal: 24,
              textAlign: 'center',
              fontSize: 12,
              color: tokens.textMuted,
            }}
          >
            {dbError}
          </Text>
        )}
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
