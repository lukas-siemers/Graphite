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
import { exportNoteAsMarkdown } from '../../lib/export-markdown';
import { computeReadingTime } from '../../lib/reading-time';
import { exportNoteAsPdf } from '../../lib/export-pdf';
import { useNoteStore } from '../../stores/use-note-store';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useFolderStore } from '../../stores/use-folder-store';
import { useEditorStore } from '../../stores/use-editor-store';
import { useNoteCanvasMigration } from '../../hooks/use-note-canvas-migration';

type SaveStatus = 'Saved' | 'Saving...';

interface CanvasRendererProps {
  canvasDoc: CanvasDocument;
  width?: number;
  onInkChange?: (inkLayer: CanvasDocument['inkLayer']) => void;
  onTextChange?: (text: string) => void;
  inputMode?: 'ink' | 'scroll';
  pendingCommand?: string | null;
  onCommandApplied?: () => void;
  onActiveFormatsChange?: (formats: any[]) => void;
}

type CanvasRendererComponent = (props: CanvasRendererProps) => JSX.Element;

let cachedCanvasRenderer: CanvasRendererComponent | null | undefined;
let cachedCanvasRendererError: string | null = null;

function loadCanvasRenderer(): CanvasRendererComponent | null {
  if (typeof cachedCanvasRenderer !== 'undefined') {
    return cachedCanvasRenderer;
  }

  try {
    const editorModule = require('../../../../packages/editor/src/CanvasRenderer') as {
      CanvasRenderer?: CanvasRendererComponent;
    };
    cachedCanvasRenderer = editorModule.CanvasRenderer ?? null;

    if (!cachedCanvasRenderer) {
      cachedCanvasRendererError = 'Canvas renderer export was not available.';
    }
  } catch (error) {
    cachedCanvasRenderer = null;
    cachedCanvasRendererError =
      error instanceof Error ? error.message : String(error);
  }

  return cachedCanvasRenderer;
}

function getCanvasRendererError(): string | null {
  return cachedCanvasRendererError;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function Editor() {
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
  const inputMode = useEditorStore((s) => s.inputMode);
  const setInputMode = useEditorStore((s) => s.setInputMode);

  const pendingCommand = useEditorStore((s) => s.pendingCommand);
  const clearCommand = useEditorStore((s) => s.clearCommand);
  const setActiveFormats = useEditorStore((s) => s.setActiveFormats);
  const syncState = useEditorStore((s) => s.syncState);

  const [localTitle, setLocalTitle] = useState('');
  const [localBody, setLocalBody] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('Saved');
  const [AdvancedCanvasRenderer, setAdvancedCanvasRenderer] =
    useState<CanvasRendererComponent | null>(null);
  const [advancedEditorError, setAdvancedEditorError] = useState<string | null>(null);

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

  function handleFallbackBodyChange(text: string) {
    setLocalBody(text);
    setSaveStatus('Saving...');
    if (bodyDebounce.current) clearTimeout(bodyDebounce.current);
    bodyDebounce.current = setTimeout(() => {
      if (activeCanvasDoc) {
        void handleCanvasTextChange(text);
        return;
      }
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

  useEffect(() => {
    if (!activeCanvasDoc) {
      setAdvancedCanvasRenderer(null);
      setAdvancedEditorError(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const renderer = loadCanvasRenderer();
      if (cancelled) return;

      if (renderer) {
        setAdvancedCanvasRenderer(() => renderer);
        setAdvancedEditorError(null);
        return;
      }

      setAdvancedCanvasRenderer(null);
      setAdvancedEditorError(
        getCanvasRendererError() ?? 'The advanced editor could not be loaded.',
      );
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeCanvasDoc]);

  const loadingAdvancedEditor =
    activeCanvasDoc !== null &&
    AdvancedCanvasRenderer === null &&
    advancedEditorError === null;

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
      onStartShouldSetResponder={(evt) => {
        const native = evt.nativeEvent as any;
        const isStylus = native.touchType === 2 || native.touchType === 'stylus';
        if (isStylus) {
          setInputMode('ink');
        } else {
          const majorRadius: number = native.majorRadius ?? 0;
          if (!(inputMode === 'ink' && majorRadius > 20)) {
            setInputMode('scroll');
          }
        }
        return false;
      }}
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
      {activeCanvasDoc !== null && AdvancedCanvasRenderer ? (
        /* ── Primary surface — always open for writing ── */
        <View style={{ flex: 1 }}>
          <AdvancedCanvasRenderer
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
      ) : loadingAdvancedEditor ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tokens.bgBase,
          }}
        >
          <Text style={{ fontSize: 12, color: tokens.textMuted }}>
            Loading editor...
          </Text>
        </View>
      ) : (
        /* ── Fallback while canvas migration runs ── */
        <View style={{ flex: 1 }}>
          {advancedEditorError && (
            <View
              style={{
                paddingHorizontal: 24,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: tokens.border,
                backgroundColor: tokens.bgHover,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: tokens.accentLight }}>
                Advanced editor unavailable in this build
              </Text>
              <Text style={{ marginTop: 4, fontSize: 12, color: tokens.textMuted }}>
                Graphite switched to plain text so the app can keep running.
              </Text>
              <Text style={{ marginTop: 6, fontSize: 11, color: tokens.textHint }}>
                {advancedEditorError}
              </Text>
            </View>
          )}
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <TextInput
              value={localBody}
              onChangeText={activeCanvasDoc ? handleFallbackBodyChange : handleBodyChange}
              multiline
              placeholder="Start writing..."
              placeholderTextColor={tokens.textHint}
              editable={inputMode !== 'ink'}
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
        </View>
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
        {syncState !== 'disabled' && (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                marginRight: 4,
                backgroundColor:
                  syncState === 'idle'
                    ? '#4CAF50'
                    : syncState === 'syncing'
                      ? tokens.accent
                      : tokens.textMuted,
              }}
            />
            <Text
              style={{
                fontSize: 11,
                color: tokens.textHint,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              {syncState === 'idle'
                ? 'SYNCED'
                : syncState === 'syncing'
                  ? 'SYNCING'
                  : syncState === 'error'
                    ? 'SYNC ERROR'
                    : 'OFFLINE'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
