// Shared types and pure helpers for .graphite file export.
// Platform-specific implementations live in:
//   - export-graphite.native.ts  (iOS / Android — expo-file-system + expo-sharing)
//   - export-graphite.web.ts     (web / Electron renderer — Blob download)
//
// Metro and the TypeScript "react-native" resolver pick the correct file via
// the .native.ts / .web.ts suffix automatically.

import {
  deserializeFromGraphite,
  migrateCanvasDocumentToSpatial,
  serializeToGraphite,
  type SpatialCanvasDocument,
} from '@graphite/canvas';
import { createEmptyCanvas, type CanvasDocument } from '@graphite/db';
import { slugify } from './export-markdown-utils';

export interface GraphiteExportInput {
  id: string;
  title: string;
  body: string;
  canvasJson: string | null;
  graphiteBlob: Uint8Array | null;
  canvasVersion: number;
}

export interface GraphiteExportPayload {
  filename: string;
  bytes: Uint8Array;
}

export const GRAPHITE_MIME_TYPE = 'application/zip';
export const GRAPHITE_EXTENSION = '.graphite';

/**
 * Produce a SpatialCanvasDocument for `note`. v2 notes deserialize the
 * existing blob if present; otherwise we fabricate a v1 CanvasDocument from
 * whatever text is available (canvasJson > body) and run the v1→v2 migration.
 */
async function resolveSpatialDoc(note: GraphiteExportInput): Promise<SpatialCanvasDocument> {
  if (note.canvasVersion === 2 && note.graphiteBlob) {
    return deserializeFromGraphite(note.graphiteBlob);
  }
  let v1: CanvasDocument;
  if (note.canvasJson) {
    try {
      v1 = JSON.parse(note.canvasJson) as CanvasDocument;
    } catch {
      v1 = createEmptyCanvas();
      v1.textContent.body = note.body;
    }
  } else {
    v1 = createEmptyCanvas();
    v1.textContent.body = note.body;
  }
  return migrateCanvasDocumentToSpatial(v1);
}

/**
 * Build the final `{ filename, bytes }` payload for a `.graphite` export.
 * For v2 notes with a stored blob, the bytes are reused verbatim (no re-zip)
 * so cross-device fidelity is preserved.
 */
export async function buildGraphiteExport(
  note: GraphiteExportInput,
): Promise<GraphiteExportPayload> {
  const slug = slugify(note.title, note.id);
  let bytes: Uint8Array;
  if (note.canvasVersion === 2 && note.graphiteBlob) {
    bytes = note.graphiteBlob;
  } else {
    const spatial = await resolveSpatialDoc(note);
    bytes = await serializeToGraphite(spatial);
  }
  return {
    filename: `${slug}${GRAPHITE_EXTENSION}`,
    bytes,
  };
}
