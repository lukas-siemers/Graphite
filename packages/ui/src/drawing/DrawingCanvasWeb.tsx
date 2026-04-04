/**
 * Tldraw-based drawing canvas for Electron / web.
 * Implements the same DrawingCanvasProps interface as the native Skia canvas.
 *
 * Serialization: tldraw stores its own shape graph. On save, we call
 * editor.store.getSnapshot() and pass the JSON string via onSaveSnapshot.
 * On load, we restore it via editor.store.loadSnapshot().
 * The Stroke[] path (onSave) is left unused on web — callers should prefer
 * onSaveSnapshot when targeting desktop.
 */
import React, { useCallback, useRef } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { tokens } from '../tokens';
import type { DrawingCanvasProps } from './drawing-types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DrawingCanvasWebProps extends DrawingCanvasProps {
  /** Serialized tldraw snapshot (JSON string) to restore on open. */
  initialSnapshot?: string;
  /** Called with a full tldraw store snapshot on save — use instead of onSave on desktop. */
  onSaveSnapshot?: (snapshot: string) => void;
}

export default function DrawingCanvasWeb({
  initialSnapshot,
  onSaveSnapshot,
  onSave,
  onClose,
}: DrawingCanvasWebProps) {
  const editorRef = useRef<Editor | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      editor.updateInstanceState({ isDebugMode: false });

      // Restore a previously saved snapshot if available
      if (initialSnapshot) {
        try {
          const snapshot = JSON.parse(initialSnapshot);
          editor.store.loadSnapshot(snapshot);
        } catch {
          // Corrupt snapshot — start with a blank canvas
        }
      }
    },
    [initialSnapshot],
  );

  const handleDone = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      onClose();
      return;
    }

    const snapshot = editor.store.getSnapshot();
    const snapshotJson = JSON.stringify(snapshot);

    if (onSaveSnapshot) {
      onSaveSnapshot(snapshotJson);
    } else {
      // Fallback: signal save with empty strokes array so callers
      // that only handle onSave don't silently skip the callback.
      onSave([]);
    }
    onClose();
  }, [onSave, onSaveSnapshot, onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: `${tokens.bgBase}F7`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
      }}
    >
      {/* Tldraw canvas */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Tldraw onMount={handleMount} />
      </div>

      {/* Bottom action bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 12,
          padding: '12px 16px',
          backgroundColor: tokens.bgSidebar,
          borderTop: `1px solid ${tokens.border}`,
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '8px 16px',
            backgroundColor: tokens.bgHover,
            color: tokens.textBody,
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleDone}
          style={{
            padding: '8px 16px',
            backgroundColor: 'transparent',
            color: tokens.accent,
            border: 'none',
            cursor: 'pointer',
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
