import { useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { nanoid } from 'nanoid';
import { createEmptyCanvas, getDatabase } from '@graphite/db';
import type { Note, InkStroke } from '@graphite/db';
import { useNoteStore } from '../stores/use-note-store';

/**
 * Auto-conversion hook: call this when opening a note.
 *
 * If `note.canvasJson` is already set, this is a no-op.
 *
 * Otherwise:
 *   1. Creates a new CanvasDocument via createEmptyCanvas()
 *   2. Sets textContent.body = note.body
 *   3. If note.drawingAssetId points to an existing JSON file, reads and
 *      parses the legacy stroke array into inkLayer.strokes (best-effort —
 *      failures silently fall back to empty strokes).
 *   4. Persists via updateNoteCanvas so the note is migrated for next open.
 *
 * updatedAt: migration calls updateNoteCanvas with silent=true so neither the
 * DB updated_at column nor the in-memory updatedAt field are touched. The
 * note's position in sort order is preserved. isDirty remains 0 (Phase 1).
 *
 * Note: because migration writes to SQLite the hook must only fire once per
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

      // Attempt to load legacy stroke file
      if (note.drawingAssetId) {
        try {
          const info = await FileSystem.getInfoAsync(note.drawingAssetId);
          if (info.exists) {
            const raw = await FileSystem.readAsStringAsync(note.drawingAssetId);
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              // Convert legacy Stroke[] format → InkStroke[]
              // Legacy strokes have: id, tool, color, width, points[]
              // InkStroke has: id, points (with pressure/tilt/timestamp), color, width, opacity
              const inkStrokes: InkStroke[] = (parsed as any[]).map((s: any) => ({
                id: s.id ?? nanoid(),
                color: s.color ?? '#FFFFFF',
                width: typeof s.width === 'number' ? s.width : 2,
                opacity: 1.0,
                points: Array.isArray(s.points)
                  ? s.points.map((p: any) => ({
                      x: typeof p.x === 'number' ? p.x : 0,
                      y: typeof p.y === 'number' ? p.y : 0,
                      pressure: typeof p.pressure === 'number' ? p.pressure : 0.5,
                      tilt: typeof p.tilt === 'number' ? p.tilt : 0,
                      timestamp: typeof p.timestamp === 'number' ? p.timestamp : Date.now(),
                    }))
                  : [],
              }));
              canvasDoc.inkLayer.strokes = inkStrokes;
            }
          }
        } catch {
          // Parse / IO failure → leave strokes empty, migration still proceeds
        }
      }

      try {
        const db = getDatabase();
        await updateNoteCanvas(db, note.id, canvasDoc, true);
      } catch {
        // Migration failure is non-fatal — the legacy body / drawing are still intact
      }
    }

    migrate();
  }, [note?.id, note?.canvasJson]);
}
