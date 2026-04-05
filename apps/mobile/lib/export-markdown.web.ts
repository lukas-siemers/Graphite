// Web / Electron-renderer implementation of markdown export.
// Triggers a browser download via Blob + anchor click — no filesystem APIs.
import { buildExport, type ExportNoteInput } from './export-markdown';

export { slugify, buildExport } from './export-markdown';
export type { ExportNoteInput, ExportPayload } from './export-markdown';

export async function exportNoteAsMarkdown(note: ExportNoteInput): Promise<void> {
  const { filename, content } = buildExport(note);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
