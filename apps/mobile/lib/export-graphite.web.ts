// Web / Electron-renderer implementation of .graphite export.
// Triggers a browser download via Blob + anchor click — no filesystem APIs.
import {
  buildGraphiteExport,
  GRAPHITE_MIME_TYPE,
  type GraphiteExportInput,
} from './export-graphite-utils';

export { buildGraphiteExport, GRAPHITE_MIME_TYPE, GRAPHITE_EXTENSION } from './export-graphite-utils';
export type { GraphiteExportInput, GraphiteExportPayload } from './export-graphite-utils';

export async function exportNoteAsGraphite(note: GraphiteExportInput): Promise<void> {
  const { filename, bytes } = await buildGraphiteExport(note);
  // Blob constructor accepts Uint8Array directly; TS expects BlobPart[].
  const blob = new Blob([bytes as BlobPart], { type: GRAPHITE_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
