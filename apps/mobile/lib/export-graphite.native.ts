// Native (iOS / Android) implementation of .graphite export.
// Writes the ZIP blob to the app cache directory and opens the share sheet.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  buildGraphiteExport,
  GRAPHITE_MIME_TYPE,
  type GraphiteExportInput,
} from './export-graphite-utils';

export { buildGraphiteExport, GRAPHITE_MIME_TYPE, GRAPHITE_EXTENSION } from './export-graphite-utils';
export type { GraphiteExportInput, GraphiteExportPayload } from './export-graphite-utils';

export async function exportNoteAsGraphite(note: GraphiteExportInput): Promise<void> {
  const { filename, bytes } = await buildGraphiteExport(note);
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    throw new Error('exportNoteAsGraphite: cacheDirectory is unavailable');
  }
  const uri = cacheDir + filename;
  // FileSystem.writeAsStringAsync only accepts strings. Encode as base64 so
  // the binary ZIP payload survives the round-trip.
  const base64 = bytesToBase64(bytes);
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: GRAPHITE_MIME_TYPE,
      dialogTitle: 'Export note',
      UTI: 'public.zip-archive',
    });
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Hermes/RN has no Buffer; build base64 in ~1KB chunks using btoa.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  // eslint-disable-next-line no-undef
  return (globalThis as { btoa?: (s: string) => string }).btoa!(binary);
}
