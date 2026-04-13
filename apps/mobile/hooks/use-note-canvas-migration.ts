import { useEffect, useRef } from 'react';
import { createEmptyCanvas, getDatabase } from '@graphite/db';
import type { Note } from '@graphite/db';
import { useNoteStore } from '../stores/use-note-store';

/**
 * Auto-conversion hook: call this when opening a note.
 *
 * If `note.canvasJson` is already set, this is a no-op.
 *
 * Otherwise:
 *   1. Creates a new CanvasDocument via createEmptyCanvas()
 *   2. Sets textContent.body = note.body
 *   3. Persists via updateNoteCanvas so the note is migrated for next open.
 *
 * v1 note (post-ink rewrite): the ink layer migration branch was removed.
 * Legacy `drawing_asset_id` files are ignored; `inkLayer.strokes` stays
 * empty. The drawing stack comes back as a separate slice later.
 *
 * updatedAt: migration calls updateNoteCanvas with silent=true so neither
 * the DB updated_at column nor the in-memory updatedAt field are touched.
 * The note's position in sort order is preserved. isDirty remains 0
 * (Phase 1).
 *
 * Because migration writes to SQLite, the hook must only fire once per
 * note ID. A ref guard prevents re-runs when the parent re-renders.
 */
export function useNoteCanvasMigration(note: Note | null): void {
  const updateNoteCanvas = useNoteStore((s) => s.updateNoteCanvas);
  const migratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!note) return;
    // Already migrated — canvasJson present
    if (note.canvasJson !== null) return;
    // Guard against double-run within the same mount lifecycle
    if (migratedRef.current === note.id) return;
    migratedRef.current = note.id;

    async function migrate() {
      if (!note) return;

      const canvasDoc = createEmptyCanvas();
      canvasDoc.textContent.body = note.body;

      try {
        const db = getDatabase();
        await updateNoteCanvas(db, note.id, canvasDoc, true);
      } catch {
        // Migration failure is non-fatal — the legacy body is still intact
      }
    }

    // .catch swallows any unhandled rejection — see Editor.tsx for the
    // RCTFatal / SIGABRT rationale. Migration failures are non-fatal.
    migrate().catch(() => {});
  }, [note?.id, note?.canvasJson]);
}
