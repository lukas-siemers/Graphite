// Shared types and pure helpers for markdown export.
// Platform-specific implementations live in:
//   - export-markdown.native.ts  (iOS / Android — expo-file-system + expo-sharing)
//   - export-markdown.web.ts     (web / Electron renderer — Blob download)
//
// Metro and the TypeScript "react-native" resolver pick the correct file via
// the .native.ts / .web.ts suffix automatically.

import { deserializeFromGraphite, markdownFromChunks } from '@graphite/canvas';

export interface ExportNoteInput {
  id: string;
  title: string;
  body: string;
  // Optional v2 fields — when present and canvasVersion === 2, the body is
  // derived from the spatial blocks inside graphiteBlob so block-level
  // formatting (headings, fences) is preserved across export.
  canvasVersion?: number;
  graphiteBlob?: Uint8Array | null;
}

export interface ExportPayload {
  filename: string;
  content: string;
}

/**
 * Convert a note title into a kebab-case filename slug.
 *
 * Rules:
 *  - lowercase
 *  - every run of non-alphanumeric characters becomes a single `-`
 *  - leading/trailing `-` are trimmed
 *  - if the result is empty OR equals "untitled", fall back to
 *    `untitled-<first 8 chars of id>`
 */
export function slugify(title: string, id = ''): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (base.length === 0 || base === 'untitled') {
    const suffix = id.slice(0, 8);
    return `untitled-${suffix}`;
  }
  return base;
}

/**
 * Build the final `{ filename, content }` payload for a note export.
 * Output format is plain markdown — no frontmatter, no metadata.
 *
 *     # <title>
 *
 *     <body>
 *
 * A trailing newline is always present at EOF.
 * Empty title falls back to the heading "Untitled".
 */
export function buildExport(note: ExportNoteInput): ExportPayload {
  const slug = slugify(note.title, note.id);
  const headingTitle = note.title.trim().length === 0 ? 'Untitled' : note.title;
  const content = `# ${headingTitle}\n\n${note.body}\n`;
  return {
    filename: `${slug}.md`,
    content,
  };
}

/**
 * Async export builder for v2 (canvasVersion === 2) notes. Deserializes the
 * `.graphite` blob and joins its text blocks back into markdown via
 * `markdownFromChunks`, preserving block-level formatting (headings, fences,
 * paragraphs). Falls back to the synchronous `buildExport` path for v1 notes
 * or when no blob is present.
 */
export async function buildExportAsync(note: ExportNoteInput): Promise<ExportPayload> {
  if (note.canvasVersion === 2 && note.graphiteBlob) {
    const doc = await deserializeFromGraphite(note.graphiteBlob);
    const body = markdownFromChunks(
      doc.blocks
        .filter((b) => b.type === 'text')
        .map((b) => ({ id: b.id, content: b.content })),
    );
    return buildExport({ ...note, body });
  }
  return buildExport(note);
}
