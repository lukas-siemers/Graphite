// Native (iOS / Android) implementation of markdown export.
// Writes the note to the app cache directory and opens the system share sheet.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { buildExport, type ExportNoteInput } from './export-markdown';

export { slugify, buildExport } from './export-markdown';
export type { ExportNoteInput, ExportPayload } from './export-markdown';

export async function exportNoteAsMarkdown(note: ExportNoteInput): Promise<void> {
  const { filename, content } = buildExport(note);
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    throw new Error('exportNoteAsMarkdown: cacheDirectory is unavailable');
  }
  const uri = cacheDir + filename;
  await FileSystem.writeAsStringAsync(uri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'text/markdown',
      dialogTitle: 'Export note',
      UTI: 'net.daringfireball.markdown',
    });
  }
}
