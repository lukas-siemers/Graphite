// Shared types and pure helpers for markdown export.
// Platform-specific implementations live in:
//   - export-markdown.native.ts  (iOS / Android — expo-file-system + expo-sharing)
//   - export-markdown.web.ts     (web / Electron renderer — Blob download)
//
// Metro and the TypeScript "react-native" resolver pick the correct file via
// the .native.ts / .web.ts suffix automatically.

export interface ExportNoteInput {
  id: string;
  title: string;
  body: string;
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

// The runtime entry point is overridden by .native.ts / .web.ts.
// This fallback throws so any misconfigured bundler fails loudly instead of
// silently no-op-ing a user action.
export async function exportNoteAsMarkdown(_note: ExportNoteInput): Promise<void> {
  throw new Error(
    'exportNoteAsMarkdown: no platform implementation resolved. ' +
      'Expected export-markdown.native.ts or export-markdown.web.ts to be picked up by the bundler.',
  );
}
