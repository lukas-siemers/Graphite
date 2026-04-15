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
import { getDatabase, createEmptyCanvas } from '@graphite/db';
import type { CanvasDocument } from '@graphite/db';
// Deep-path import: avoid the @graphite/editor barrel so SpatialCanvasRenderer
// (and its transitive @shopify/react-native-skia import) stays out of the
// startup module graph. Skia is lazy-required below when a v2 note opens.
import { CanvasRenderer } from '@graphite/editor/src/CanvasRenderer';
import type { SpatialCanvasRenderer as SpatialCanvasRendererType } from '@graphite/editor';
import {
  chunksFromMarkdown,
  assignYPositions,
  createEmptySpatialCanvas,
  extractSearchableText,
  type SpatialCanvasDocument,
  type SpatialInkStroke,
} from '@graphite/canvas';
import { exportNoteAsMarkdown } from '../../lib/export-markdown';
import { exportNoteAsGraphite } from '../../lib/export-graphite';
import { computeReadingTime } from '../../lib/reading-time';
import { exportNoteAsPdf } from '../../lib/export-pdf';
import { useNoteStore } from '../../stores/use-note-store';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useFolderStore } from '../../stores/use-folder-store';
import { useEditorStore } from '../../stores/use-editor-store';
import { useNoteCanvasMigration } from '../../hooks/use-note-canvas-migration';
import { useSpatialCanvasMigration } from '../../hooks/use-spatial-canvas-migration';

type SaveStatus = 'Saved' | 'Saving...';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function Editor() {
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const saveNote = useNoteStore((s) => s.saveNote);
  const updateNoteCanvas = useNoteStore((s) => s.updateNoteCanvas);
  const updateNoteSpatialCanvas = useNoteStore(
    (s) => s.updateNoteSpatialCanvas,
  );

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
  const inkMode = useEditorStore((s) => s.inkMode);
  const setInkMode = useEditorStore((s) => s.setInkMode);
  const setSpatialReadyForInk = useEditorStore((s) => s.setSpatialReadyForInk);

  const [localTitle, setLocalTitle] = useState('');
  const [localBody, setLocalBody] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('Saved');

  // SpatialCanvasRenderer pulls in @shopify/react-native-skia. Lazy-require it
  // only when a v2 note is first opened — this mirrors the startup-trap
  // mitigation pattern in app/_layout.tsx and keeps Skia off the startup path.
  const [SpatialCanvasRendererModule, setSpatialCanvasRendererModule] =
    useState<typeof SpatialCanvasRendererType | null>(null);
  // Captures any failure during the lazy-require so the UI can surface the
  // error instead of rendering an empty view. Build 75-77 shipped a silent
  // failure path here that left users staring at a blank editor body.
  const [spatialLoadError, setSpatialLoadError] = useState<string | null>(null);

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

  // Auto-migrate legacy notes to CanvasDocument on open (v1 path)
  useNoteCanvasMigration(activeNote);

  useEffect(() => {
    if (activeNote?.canvasVersion !== 2) return;
    if (SpatialCanvasRendererModule) return;
    // Lazy-require: keep Skia out of the startup path per iOS production trap
    // (CLAUDE.md iOS startup trap section). The require() runs only after a v2
    // note is opened, well past initial route render.
    //
    // Wrapped in try/catch so a Skia/Hermes init failure doesn't silently
    // leave the renderer null. Failures are surfaced to the UI via
    // spatialLoadError below instead of collapsing to an empty view.
    try {
      const mod = require('@graphite/editor') as {
        SpatialCanvasRenderer: typeof SpatialCanvasRendererType;
      };
      setSpatialCanvasRendererModule(() => mod.SpatialCanvasRenderer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSpatialLoadError(message);
      // eslint-disable-next-line no-console
      console.error('[Editor] Failed to lazy-load @graphite/editor:', err);
    }
  }, [activeNote?.canvasVersion, SpatialCanvasRendererModule]);

  // v2 spatial canvas migration: resolves the SpatialCanvasDocument for the
  // active note, auto-upgrading v1 notes to v2 on first open.
  const { spatialDoc, isReady: spatialReady } =
    useSpatialCanvasMigration(activeNote);

  // v2 save pipeline — debounced 500ms to match CanvasRenderer save cadence.
  const spatialSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spatialDocRef = useRef<SpatialCanvasDocument | null>(spatialDoc);
  useEffect(() => {
    spatialDocRef.current = spatialDoc;
  }, [spatialDoc]);

  useEffect(() => {
    return () => {
      if (spatialSaveTimer.current) clearTimeout(spatialSaveTimer.current);
    };
  }, []);

  const scheduleSpatialSave = useCallback(
    (next: SpatialCanvasDocument) => {
      const noteId = activeNoteIdRef.current;
      if (!noteId) return;
      spatialDocRef.current = next;
      setSaveStatus('Saving...');
      if (spatialSaveTimer.current) clearTimeout(spatialSaveTimer.current);
      spatialSaveTimer.current = setTimeout(async () => {
        try {
          const db = getDatabase();
          await updateNoteSpatialCanvas(db, noteId, next);
          setSaveStatus('Saved');
        } catch {
          setSaveStatus('Saved');
        }
      }, 500);
    },
    [updateNoteSpatialCanvas],
  );

  const handleSpatialTextChange = useCallback(
    (markdown: string) => {
      const current = spatialDocRef.current;
      if (!current) return;
      setLocalBody(markdown);
      const chunks = chunksFromMarkdown(markdown);
      const blocks = assignYPositions(chunks, 24, 16);
      const next: SpatialCanvasDocument = {
        ...current,
        blocks,
      };
      scheduleSpatialSave(next);
    },
    [scheduleSpatialSave],
  );

  /**
   * Fallback path for v2 notes while the SpatialCanvasRenderer is still
   * loading (lazy-require not fired, or useSpatialCanvasMigration still
   * resolving). Typing in the CanvasRenderer stand-in used to route through
   * handleCanvasTextChange and write to legacy body / canvasJson — when the
   * v2 renderer took over it read graphiteBlob (empty) and the user's text
   * vanished. Routing the fallback through scheduleSpatialSave lands typed
   * text directly on the graphiteBlob so the handoff is seamless.
   */
  const handleFallbackV2TextChange = useCallback(
    (text: string) => {
      setLocalBody(text);
      const current = spatialDocRef.current ?? createEmptySpatialCanvas();
      const chunks = chunksFromMarkdown(text);
      const blocks = assignYPositions(chunks, 24, 16);
      const next: SpatialCanvasDocument = {
        ...current,
        blocks,
      };
      scheduleSpatialSave(next);
    },
    [scheduleSpatialSave],
  );

  const handleSpatialInkChange = useCallback(
    (strokes: SpatialInkStroke[]) => {
      const current = spatialDocRef.current;
      if (!current) return;
      const next: SpatialCanvasDocument = {
        ...current,
        inkStrokes: strokes,
      };
      scheduleSpatialSave(next);
    },
    [scheduleSpatialSave],
  );

  // Reset ink mode when the active note changes so the toggle doesn't leak
  // between notes.
  useEffect(() => {
    setInkMode(false);
  }, [activeNote?.id, setInkMode]);

  // Build 114: thread SpatialCanvasRenderer readiness into the store so the
  // formatting toolbar can gate the pencil/ink button. Ink only works when
  // SpatialCanvasRenderer is actually live — the toolbar must not show a
  // button that flips state nothing can honor.
  useEffect(() => {
    const ready =
      activeNote?.canvasVersion === 2 &&
      spatialReady &&
      spatialDoc !== null &&
      SpatialCanvasRendererModule !== null;
    setSpatialReadyForInk(!!ready);
  }, [
    activeNote?.canvasVersion,
    spatialReady,
    spatialDoc,
    SpatialCanvasRendererModule,
    setSpatialReadyForInk,
  ]);

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

  // When the spatial doc becomes ready for a v2 note, seed the local body from
  // it so the word-count footer reflects v2 content. Subsequent edits route
  // through handleSpatialTextChange which keeps localBody in sync.
  useEffect(() => {
    if (!spatialReady || !spatialDoc) return;
    if (activeNote?.canvasVersion !== 2) return;
    setLocalBody(extractSearchableText(spatialDoc));
  }, [spatialReady, spatialDoc, activeNote?.canvasVersion]);

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
              canvasVersion: activeNote.canvasVersion,
              graphiteBlob: activeNote.graphiteBlob,
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
            void exportNoteAsGraphite({
              id: activeNote.id,
              title: localTitle,
              body: localBody,
              canvasJson: activeNote.canvasJson,
              graphiteBlob: activeNote.graphiteBlob,
              canvasVersion: activeNote.canvasVersion,
            });
          }}
          accessibilityLabel="Export note as .graphite"
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
            name="package-variant-closed"
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

      {/* Editor body — v2 spatial canvas for canvasVersion===2, v1 canvas
          renderer as a fallback during the dual-render window. */}
      <View style={{ flex: 1 }}>
        {activeNote.canvasVersion === 2 ? (
          spatialReady && spatialDoc && SpatialCanvasRendererModule ? (
            <SpatialCanvasRendererModule
              spatialDoc={spatialDoc}
              canvasWidth={canvasWidth}
              onTextChange={handleSpatialTextChange}
              onInkChange={handleSpatialInkChange}
              pendingCommand={pendingCommand}
              onCommandApplied={clearCommand}
              onActiveFormatsChange={setActiveFormats}
              focusKey={activeNoteId}
              inkMode={inkMode}
            />
          ) : spatialLoadError ? (
            <View
              style={{
                padding: 16,
                backgroundColor: tokens.accentTint,
              }}
            >
              <Text
                style={{
                  color: tokens.accentLight,
                  fontFamily: 'JetBrainsMono',
                  fontSize: 12,
                }}
              >
                Spatial renderer failed to load: {spatialLoadError}
              </Text>
            </View>
          ) : (
            // Build 114: NO MORE silent CanvasRenderer fallback for v2 notes.
            // Prior builds fell back to CanvasRenderer while the spatial
            // pipeline finished loading, which silently hid every failure
            // mode in the spatial path (lazy require, spatial migration
            // hook, Skia bridge). User ended up typing into a renderer that
            // didn't support ink and had no idea why pencil did nothing.
            //
            // Now: spatial is the only v2 renderer. If it's still loading
            // we show a visible "Loading canvas..." state, which makes any
            // hang immediately obvious. If it errors, the spatialLoadError
            // branch above fires. Failing loudly > failing silently.
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tokens.bgBase,
              }}
            >
              <Text
                style={{
                  color: tokens.textMuted,
                  fontFamily: 'JetBrainsMono',
                  fontSize: 12,
                  letterSpacing: 0.5,
                }}
              >
                {`Loading canvas... · mod:${SpatialCanvasRendererModule ? 'loaded' : 'null'} · ready:${spatialReady ? 'true' : 'false'} · doc:${spatialDoc ? 'set' : 'null'}`}
              </Text>
            </View>
          )
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
