import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase } from '@graphite/db';
import type { CanvasDocument } from '@graphite/db';
import { CanvasRenderer } from '@graphite/editor';
import { exportNoteAsMarkdown } from '../../lib/export-markdown';
import { computeReadingTime } from '../../lib/reading-time';
import { exportNoteAsPdf } from '../../lib/export-pdf';
import { useNoteStore } from '../../stores/use-note-store';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useFolderStore } from '../../stores/use-folder-store';
import { useEditorStore } from '../../stores/use-editor-store';
import { useNoteCanvasMigration } from '../../hooks/use-note-canvas-migration';
import { usePencilDetection } from '../../hooks/use-pencil-detection';

type SaveStatus = 'Saved' | 'Saving...';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface EditorProps {
  onToggleDrawing?: () => void;
  drawingOpen?: boolean;
}

export default function Editor({ onToggleDrawing: _onToggleDrawing, drawingOpen: _drawingOpen }: EditorProps) {
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const saveNote = useNoteStore((s) => s.saveNote);
  const updateNoteCanvas = useNoteStore((s) => s.updateNoteCanvas);
  const deleteIfEmpty = useNoteStore((s) => s.deleteIfEmpty);

  const notebooks = useNotebookStore((s) => s.notebooks);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  const { width: windowWidth } = useWindowDimensions();
  const { inputMode, handleTouchStart } = usePencilDetection();

  const pendingCommand = useEditorStore((s) => s.pendingCommand);
  const clearCommand = useEditorStore((s) => s.clearCommand);
  const setActiveFormats = useEditorStore((s) => s.setActiveFormats);

  const [localTitle, setLocalTitle] = useState('');
  const [localBody, setLocalBody] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('Saved');

  const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref keeps activeNoteId current inside debounce callbacks (avoids stale closure)
  const activeNoteIdRef = useRef<string | null>(activeNoteId ?? null);
  useEffect(() => { activeNoteIdRef.current = activeNoteId ?? null; }, [activeNoteId]);
  // Ref keeps the latest canvasJson current inside debounce callbacks
  const canvasJsonRef = useRef<string | null>(activeNote?.canvasJson ?? null);
  useEffect(() => { canvasJsonRef.current = activeNote?.canvasJson ?? null; }, [activeNote?.canvasJson]);

  // Task 6 — auto-migrate legacy notes to CanvasDocument on open
  useNoteCanvasMigration(activeNote);

  // Auto-delete empty notes when the user navigates away.
  // Track the previous activeNoteId across renders; when it changes, run
  // deleteIfEmpty against the previous id exactly once per transition.
  const prevActiveNoteIdRef = useRef<string | null>(activeNoteId ?? null);
  useEffect(() => {
    const prevId = prevActiveNoteIdRef.current;
    const nextId = activeNoteId ?? null;
    if (prevId && prevId !== nextId) {
      try {
        const db = getDatabase();
        void deleteIfEmpty(db, prevId);
      } catch (_) {
        // Best-effort cleanup — must not break navigation.
      }
    }
    prevActiveNoteIdRef.current = nextId;
  }, [activeNoteId, deleteIfEmpty]);

  // On unmount (editor closed / app backgrounded), clean up the last active note.
  useEffect(() => {
    return () => {
      const prevId = prevActiveNoteIdRef.current;
      if (!prevId) return;
      try {
        const db = getDatabase();
        void deleteIfEmpty(db, prevId);
      } catch (_) {
        // Best-effort cleanup.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync local state when active note changes
  useEffect(() => {
    if (activeNote) {
      setLocalTitle(activeNote.title);
      // Prefer canvas body if migrated, fall back to legacy body
      const displayBody = activeNote.canvasJson
        ? (() => {
            try {
              const doc = JSON.parse(activeNote.canvasJson) as CanvasDocument;
              return doc.textContent.body;
            } catch {
              return activeNote.body;
            }
          })()
        : activeNote.body;
      setLocalBody(displayBody);
      setSaveStatus('Saved');
    }
  }, [activeNoteId]);

  const persistSave = useCallback(
    async (patch: { title?: string; body?: string }) => {
      if (!activeNoteId) return;
      setSaveStatus('Saving...');
      try {
        const db = getDatabase();
        await saveNote(db, activeNoteId, patch);
        setSaveStatus('Saved');
      } catch (_) {
        setSaveStatus('Saved');
      }
    },
    [activeNoteId, saveNote],
  );

  function handleTitleChange(text: string) {
    setLocalTitle(text);
    setSaveStatus('Saving...');
    if (titleDebounce.current) clearTimeout(titleDebounce.current);
    titleDebounce.current = setTimeout(() => {
      persistSave({ title: text });
    }, 500);
  }

  /**
   * Called when the CanvasRenderer text layer emits a new body string.
   * CanvasTextInput already debounces — this fires at most once per 500ms.
   * Reads note ID and canvasJson from refs so the closure is never stale.
   */
  async function handleCanvasTextChange(text: string) {
    const noteId = activeNoteIdRef.current;
    if (!noteId) return;
    setLocalBody(text);
    setSaveStatus('Saving...');
    try {
      const db = getDatabase();
      await saveNote(db, noteId, { body: text });
      let currentDoc: CanvasDocument;
      const currentJson = canvasJsonRef.current;
      if (currentJson) {
        try { currentDoc = JSON.parse(currentJson) as CanvasDocument; }
        catch { const { createEmptyCanvas } = await import('@graphite/db'); currentDoc = createEmptyCanvas(); }
      } else {
        const { createEmptyCanvas } = await import('@graphite/db');
        currentDoc = createEmptyCanvas();
      }
      currentDoc.textContent.body = text;
      await updateNoteCanvas(db, noteId, currentDoc);
      setSaveStatus('Saved');
    } catch (_) {
      setSaveStatus('Saved');
    }
  }

  function handleBodyChange(text: string) {
    setLocalBody(text);
    setSaveStatus('Saving...');
    if (bodyDebounce.current) clearTimeout(bodyDebounce.current);
    bodyDebounce.current = setTimeout(() => {
      persistSave({ body: text });
    }, 500);
  }

  const activeNotebook = notebooks.find((n) => n.id === activeNotebookId);
  const activeFolder = folders.find((f) => f.id === activeFolderId);

  const breadcrumb = [activeNotebook?.name, activeFolder?.name]
    .filter(Boolean)
    .join(' \u203A ');

  const wordCount = countWords(localBody);

  // Derive the CanvasDocument to pass to CanvasRenderer
  let activeCanvasDoc: CanvasDocument | null = null;
  if (activeNote?.canvasJson) {
    try {
      activeCanvasDoc = JSON.parse(activeNote.canvasJson) as CanvasDocument;
    } catch {
      activeCanvasDoc = null;
    }
  }

  // Canvas column width: full width minus sidebar/padding on iPad, full width on phone
  const canvasWidth = Math.min(windowWidth, 680);

  if (!activeNote) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.bgBase,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 14, color: tokens.textHint }}>
          Select a note
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.bgBase }}
      onStartShouldSetResponder={handleTouchStart}
    >
      {/* Title area */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 20,
          paddingBottom: 4,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <TextInput
          value={localTitle}
          onChangeText={handleTitleChange}
          placeholder="Untitled"
          placeholderTextColor={tokens.textHint}
          editable={inputMode !== 'ink'}
          style={{
            flex: 1,
            fontSize: 28,
            fontWeight: '700',
            color: tokens.textPrimary,
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
          }}
        />
        <Pressable
          onPress={() => {
            if (!activeNote) return;
            void exportNoteAsMarkdown({
              id: activeNote.id,
              title: localTitle,
              body: localBody,
            });
          }}
          accessibilityLabel="Export note as markdown"
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            marginLeft: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? tokens.bgHover : 'transparent',
          })}
        >
          <MaterialCommunityIcons
            name="download-outline"
            size={18}
            color={tokens.textMuted}
          />
        </Pressable>
        <Pressable
          onPress={() => {
            if (!activeNote) return;
            void exportNoteAsPdf({
              id: activeNote.id,
              title: localTitle,
              body: localBody,
            });
          }}
          accessibilityLabel="Export note as PDF"
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            marginLeft: 4,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? tokens.bgHover : 'transparent',
          })}
        >
          <MaterialCommunityIcons
            name="file-pdf-box"
            size={18}
            color={tokens.textMuted}
          />
        </Pressable>
      </View>

      {/* Breadcrumb */}
      {breadcrumb.length > 0 && (
        <View style={{ paddingHorizontal: 24, paddingBottom: 12 }}>
          <Text style={{ fontSize: 12, color: tokens.textMuted }}>
            {breadcrumb}
          </Text>
        </View>
      )}

      {/* Content area — live-preview canvas is always on */}
      {activeCanvasDoc !== null ? (
        /* ── Primary surface — always open for writing ── */
        <View style={{ flex: 1 }}>
          <CanvasRenderer
            canvasDoc={activeCanvasDoc}
            width={canvasWidth}
            onTextChange={handleCanvasTextChange}
            onInkChange={(inkLayer) => {
              if (!activeNote) return;
              // Object.assign instead of spread — avoids Hermes GC crash on iOS 26
              const updated: CanvasDocument = Object.assign({}, activeCanvasDoc, { inkLayer });
              const db = getDatabase();
              updateNoteCanvas(db, activeNote.id, updated);
            }}
            inputMode={inputMode}
            pendingCommand={pendingCommand}
            onCommandApplied={clearCommand}
            onActiveFormatsChange={setActiveFormats}
          />
        </View>
      ) : (
        /* ── Fallback while canvas migration runs ── */
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={localBody}
            onChangeText={handleBodyChange}
            multiline
            placeholder="Start writing..."
            placeholderTextColor={tokens.textHint}
            style={{
              fontSize: 16,
              lineHeight: 24,
              color: tokens.textBody,
              backgroundColor: 'transparent',
              borderWidth: 0,
              padding: 24,
              minHeight: 300,
              textAlignVertical: 'top',
              ...(Platform.OS === 'web' ? { outlineWidth: 0, outlineStyle: 'none', resize: 'none', boxShadow: 'none' } as any : {}),
            }}
          />
        </ScrollView>
      )}

      {/* Status bar */}
      <View
        style={{
          flexDirection: 'row',
          height: 32,
          paddingHorizontal: 16,
          borderTopWidth: 1,
          borderTopColor: tokens.border,
          backgroundColor: tokens.bgBase,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontSize: 11,
            color: tokens.textHint,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {wordCount} WORDS {'\u00B7'} {computeReadingTime(wordCount).toUpperCase()} {'\u00B7'} {saveStatus.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}
