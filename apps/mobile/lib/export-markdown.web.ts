// Web / Electron-renderer implementation of markdown export.
// Triggers a browser download via Blob + anchor click — no filesystem APIs.
import { buildExportAsync, type ExportNoteInput } from './export-markdown-utils';

export { slugify, buildExport, buildExportAsync } from './export-markdown-utils';
export type { ExportNoteInput, ExportPayload } from './export-markdown-utils';

export async function exportNoteAsMarkdown(note: ExportNoteInput): Promise<void> {
  const { filename, content } = await buildExportAsync(note);
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
