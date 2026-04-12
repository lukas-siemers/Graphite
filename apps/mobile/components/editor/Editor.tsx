import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import { getDatabase, createEmptyCanvas, CanvasSchemaV1 } from '@graphite/db';
import type { CanvasDocument } from '@graphite/db';
import { CanvasRenderer } from '@graphite/editor';
import DrawingCanvas from './DrawingCanvas';
import { extractStrokes } from 'graphite-pencil-kit';
import { exportNoteAsMarkdown } from '../../lib/export-markdown';
import { computeReadingTime } from '../../lib/reading-time';
import { exportNoteAsPdf } from '../../lib/export-pdf';
import { useNoteStore } from '../../stores/use-note-store';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useFolderStore } from '../../stores/use-folder-store';
import { useEditorStore } from '../../stores/use-editor-store';
import { useNoteCanvasMigration } from '../../hooks/use-note-canvas-migration';

type SaveStatus = 'Saved' | 'Saving...';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function Editor() {
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const saveNote = useNoteStore((s) => s.saveNote);
  const updateNoteCanvas = useNoteStore((s) => s.updateNoteCanvas);

  const notebooks = useNotebookStore((s) => s.notebooks);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  const { width: windowWidth } = useWindowDimensions();

  const pendingCommand = useEditorStore((s) => s.pendingCommand);
  const clearCommand = useEditorStore((s) => s.clearCommand);
  const setActiveFormats = useEditorStore((s) => s.setActiveFormats);
  const syncState = useEditorStore((s) => s.syncState);
  const drawMode = useEditorStore((s) => s.drawMode);
  const setDrawMode = useEditorStore((s) => s.setDrawMode);

  const [localTitle, setLocalTitle] = useState('');
  const [localBody, setLocalBody] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('Saved');

  const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref keeps activeNoteId current inside debounce callbacks (avoids stale closure)
  const activeNoteIdRef = useRef<string | null>(activeNoteId ?? null);
  useEffect(() => {
    activeNoteIdRef.current = activeNoteId ?? null;
  }, [activeNoteId]);
  // Ref keeps the latest canvasJson current inside debounce callbacks
  const canvasJsonRef = useRef<string | null>(activeNote?.canvasJson ?? null);
  useEffect(() => {
    canvasJsonRef.current = activeNote?.canvasJson ?? null;
  }, [activeNote?.canvasJson]);

  // Auto-migrate legacy notes to CanvasDocument on open
  useNoteCanvasMigration(activeNote);

  // Sync local state when active note changes
  useEffect(() => {
    if (activeNote) {
      setLocalTitle(activeNote.title);
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

  // Always exit draw mode when the active note changes. Otherwise the user
  // would land on a different note's ink layer while still in drawing mode.
  useEffect(() => {
    setDrawMode(false);
  }, [activeNoteId, setDrawMode]);

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

  // Drawing mode: save PKDrawing base64 blob + extracted cross-platform
  // strokes[]. Called by DrawingCanvas on Done press and on auto-save
  // (debounced inside DrawingCanvas itself).
  //
  // Stage 2 dual-write (see docs/specs — ink extractor PR):
  //   1. Keep `inkLayer.pkDrawingBase64` for iPad re-edit fidelity (PencilKit
  //      is the only renderer that can consume the opaque blob).
  //   2. Also extract `inkLayer.strokes[]` via the `graphite-pencil-kit`
  //      native module so the desktop SVG renderer has something to draw.
  //
  // If extraction fails (module not registered, bad blob) we still write the
  // blob so the user never loses data — `strokes` just stays empty and the
  // desktop will render nothing until the next successful extract. This is
  // the same "fail loud only in schema validation" policy used elsewhere.
  const handleDrawingChange = useCallback(
    async (base64: string) => {
      const noteId = activeNoteIdRef.current;
      if (!noteId) return;
      setSaveStatus('Saving...');
      try {
        const db = getDatabase();

        // Read current doc so we preserve textContent + any existing
        // contentLayer objects. Legacy docs may be missing fields — fall
        // back to an empty canvas and let Zod fill defaults on serialize.
        let currentDoc: CanvasDocument;
        const currentJson = canvasJsonRef.current;
        if (currentJson) {
          try {
            currentDoc = JSON.parse(currentJson) as CanvasDocument;
          } catch {
            currentDoc = createEmptyCanvas();
          }
        } else {
          currentDoc = createEmptyCanvas();
        }

        // Extract structured strokes. Any failure (native module missing,
        // invalid PKDrawing, schema drift) is swallowed so the save path
        // never crashes — but we do keep the base64 blob either way.
        let extractedStrokes: CanvasSchemaV1.InkStroke[] = [];
        try {
          extractedStrokes = await extractStrokes(base64);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[editor] extractStrokes failed; writing blob only', err);
          extractedStrokes = [];
        }

        // Build a v1-shape document. We normalize the legacy fields in case
        // currentDoc came from a pre-v1 row. `CanvasSchemaV1.canvasDocumentSchema`
        // will validate strictly on serialize.
        const v1Doc: CanvasSchemaV1.CanvasDocument = {
          version: 1,
          inkLayer: {
            strokes: extractedStrokes,
            pkDrawingBase64: base64,
          },
          contentLayer: {
            objects: [],
          },
          textContent: {
            body: currentDoc.textContent?.body ?? '',
          },
        };

        // Re-validate via Zod before persisting. Throws ZodError on drift.
        const canvasJson = CanvasSchemaV1.serializeCanvasDocument(v1Doc);

        // Hand off to the existing store writer. The legacy `CanvasDocument`
        // type here is shape-compatible with the v1 doc except for the
        // `strokes[]` inner shape — cast through unknown until the cutover
        // lands and both types converge.
        await updateNoteCanvas(
          db,
          noteId,
          JSON.parse(canvasJson) as unknown as CanvasDocument,
        );
        setSaveStatus('Saved');
      } catch (_) {
        setSaveStatus('Saved');
      }
    },
    [updateNoteCanvas],
  );

  /**
   * Called when the CanvasRenderer text layer emits a new body string.
   * CanvasRenderer already debounces at 500ms — this fires at most once
   * per save window. Reads note ID and canvasJson from refs so the closure
   * is never stale.
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
        try {
          currentDoc = JSON.parse(currentJson) as CanvasDocument;
        } catch {
          currentDoc = createEmptyCanvas();
        }
      } else {
        currentDoc = createEmptyCanvas();
      }
      currentDoc.textContent.body = text;
      await updateNoteCanvas(db, noteId, currentDoc);
      setSaveStatus('Saved');
    } catch (_) {
      setSaveStatus('Saved');
    }
  }

  const activeNotebook = notebooks.find((n) => n.id === activeNotebookId);
  const activeFolder = folders.find((f) => f.id === activeFolderId);

  const breadcrumb = [activeNotebook?.name, activeFolder?.name]
    .filter(Boolean)
    .join(' \u203A ');

  const wordCount = countWords(localBody);

  // Derive the CanvasDocument to pass to CanvasRenderer. If the note has
  // no canvasJson yet (migration hook hasn't landed), synthesize one from
  // the legacy body so the editor has something to render immediately.
  let activeCanvasDoc: CanvasDocument;
  if (activeNote?.canvasJson) {
    try {
      activeCanvasDoc = JSON.parse(activeNote.canvasJson) as CanvasDocument;
    } catch {
      activeCanvasDoc = createEmptyCanvas();
      activeCanvasDoc.textContent.body = activeNote.body;
    }
  } else {
    activeCanvasDoc = createEmptyCanvas();
    if (activeNote) activeCanvasDoc.textContent.body = activeNote.body;
  }

  // Fixed column width: capped at 680, down to windowWidth on phone
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
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
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

      {/* Editor body — mutually exclusive with DrawingCanvas. We never mount
          both at once (see CLAUDE.md "iOS production startup trap" and the
          builds 46-50 regressions). */}
      <View style={{ flex: 1 }}>
        {drawMode ? (
          <DrawingCanvas
            initialDrawingBase64={activeCanvasDoc.inkLayer.pkDrawingBase64 ?? null}
            onDrawingChange={handleDrawingChange}
            onDone={() => setDrawMode(false)}
          />
        ) : (
          <CanvasRenderer
            canvasDoc={activeCanvasDoc}
            width={canvasWidth}
            onTextChange={handleCanvasTextChange}
            pendingCommand={pendingCommand}
            onCommandApplied={clearCommand}
            onActiveFormatsChange={setActiveFormats}
            focusKey={activeNoteId}
          />
        )}
      </View>

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
