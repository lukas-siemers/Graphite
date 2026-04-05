// Native (iOS / Android) implementation of PDF export.
// Renders the note HTML into a PDF via expo-print and opens the share sheet.
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildPdfHtml, type ExportNoteInput } from './export-pdf';

export { buildPdfHtml, escapeHtml, markdownToHtml } from './export-pdf';
export type { ExportNoteInput, PdfPayload } from './export-pdf';

export async function exportNoteAsPdf(note: ExportNoteInput): Promise<void> {
  const { filename, html } = buildPdfHtml(note);
  const { uri } = await Print.printToFileAsync({ html });
  // printToFileAsync writes to a cache file with a generated name; renaming
  // across platforms is unreliable, so hand it to the share sheet as-is with
  // a descriptive dialogTitle carrying the slug.
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Export ${filename}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
