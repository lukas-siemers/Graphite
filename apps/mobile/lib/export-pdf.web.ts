// Web / Electron-renderer implementation of PDF export.
// Opens a new window containing the styled HTML and triggers the browser's
// native print dialog — the user picks "Save as PDF" from there.
import { buildPdfHtml, type ExportNoteInput } from './export-pdf';

export { buildPdfHtml, escapeHtml, markdownToHtml } from './export-pdf';
export type { ExportNoteInput, PdfPayload } from './export-pdf';

export async function exportNoteAsPdf(note: ExportNoteInput): Promise<void> {
  const { html } = buildPdfHtml(note);
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return; // popup blocked — silent no-op per scope
  win.document.write(html);
  win.document.close();
  win.focus();
  // Small delay so the document renders before the print dialog appears.
  setTimeout(() => {
    try {
      win.print();
    } catch {
      // Print dialog unavailable — leave the window open for the user.
    }
  }, 250);
}
