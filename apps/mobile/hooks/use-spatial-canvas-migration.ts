import { useEffect, useRef, useState } from 'react';
import { getDatabase } from '@graphite/db';
import type { Note } from '@graphite/db';
import {
  createEmptySpatialCanvas,
  deserializeFromGraphite,
  migrateCanvasDocumentToSpatial,
  type SpatialCanvasDocument,
} from '@graphite/canvas';
import { useNoteStore } from '../stores/use-note-store';

interface SpatialCanvasMigrationResult {
  spatialDoc: SpatialCanvasDocument | null;
  isReady: boolean;
}

/**
 * Pull the best-available legacy markdown body out of a note. Prefers the
 * canvasJson textContent payload over the flat body column (matching the
 * v1-migrate branch), falling back to the latter when canvasJson is null or
 * malformed. Returns an empty string when nothing is present.
 */
function extractLegacyBody(note: Note): string {
  let body = note.body ?? '';
  if (note.canvasJson) {
    try {
      const parsed = JSON.parse(note.canvasJson) as {
        textContent?: { body?: string };
      };
      if (typeof parsed.textContent?.body === 'string') {
        body = parsed.textContent.body;
      }
    } catch {
      // Malformed canvasJson — fall back to the already-assigned legacy body.
    }
  }
  return body;
}

/**
 * Pure resolution logic used by the hook. Exported so tests can exercise the
 * three branches (v2-with-blob, v2-empty-rescue, v1-migrate) without needing a
 * React renderer.
 *
 * Returns `{ doc, didMigrate }` where `didMigrate` signals that the caller
 * should persist `doc` via updateNoteSpatialCanvas(silent=true).
 */
export async function resolveSpatialDoc(
  note: Note,
): Promise<{ doc: SpatialCanvasDocument; didMigrate: boolean }> {
  if (note.canvasVersion === 2 && note.graphiteBlob) {
    const doc = await deserializeFromGraphite(note.graphiteBlob);
    return { doc, didMigrate: false };
  }
  if (note.canvasVersion === 2) {
    // v2 note with no graphiteBlob yet. Belt-and-suspenders: if any code path
    // wrote legacy content to this row (pre-Build-80 fallback races, stray
    // v1 writes, etc.), rescue that content by migrating it forward instead
    // of returning an empty canvas and silently discarding the user's text.
    const legacyBody = extractLegacyBody(note);
    if (legacyBody.length > 0) {
      const migrated = migrateCanvasDocumentToSpatial({
        version: 1,
        textContent: { body: legacyBody },
        inkLayer: { strokes: [] },
      });
      return { doc: migrated, didMigrate: true };
    }
    return { doc: createEmptySpatialCanvas(), didMigrate: false };
  }
  const v1Body = extractLegacyBody(note);
  const v1Doc = {
    version: 1,
    textContent: { body: v1Body },
    inkLayer: { strokes: [] },
  };
  const migrated = migrateCanvasDocumentToSpatial(v1Doc);
  return { doc: migrated, didMigrate: true };
}

/**
 * Resolves the SpatialCanvasDocument for a note, auto-migrating legacy v1
 * notes on first open.
 *
 * Branches:
 *   1. v2 + blob        — deserialize graphiteBlob, no write.
 *   2. v2 + no blob     — freshly-created v2 note; hand back an empty
 *                         spatial doc without touching SQLite.
 *   3. v1 / null        — build a v1 CanvasDocument from canvasJson (or the
 *                         legacy body), run migrateCanvasDocumentToSpatial,
 *                         persist via updateNoteSpatialCanvas(silent=true)
 *                         so sort order is preserved, hand back the v2 doc.
 *
 * Ref guard keys on note.id and prevents the migration from running twice
 * for the same note across re-renders within a single mount lifecycle.
 */
export function useSpatialCanvasMigration(
  note: Note | null,
): SpatialCanvasMigrationResult {
  const updateNoteSpatialCanvas = useNoteStore(
    (s) => s.updateNoteSpatialCanvas,
  );
  const [spatialDoc, setSpatialDoc] = useState<SpatialCanvasDocument | null>(
    null,
  );
  const [isReady, setIsReady] = useState(false);
  const processedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!note) {
      setSpatialDoc(null);
      setIsReady(false);
      processedRef.current = null;
      return;
    }
    if (processedRef.current === note.id) return;
    processedRef.current = note.id;

    setIsReady(false);
    setSpatialDoc(null);

    let cancelled = false;

    async function run() {
      if (!note) return;
      try {
        const { doc, didMigrate } = await resolveSpatialDoc(note);
        if (didMigrate) {
          try {
            const db = getDatabase();
            await updateNoteSpatialCanvas(db, note.id, doc, true);
          } catch {
            // Migration failure is non-fatal — the v1 data is still intact
            // and the in-memory spatial doc is valid.
          }
        }
        if (cancelled) return;
        setSpatialDoc(doc);
        setIsReady(true);
      } catch {
        if (cancelled) return;
        // Any unexpected failure: fall back to an empty canvas so the editor
        // can still mount. The underlying DB row is untouched.
        setSpatialDoc(createEmptySpatialCanvas());
        setIsReady(true);
      }
    }

    run().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [note?.id, note?.canvasVersion, note?.graphiteBlob, updateNoteSpatialCanvas]);

  return { spatialDoc, isReady };
}
