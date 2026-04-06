// Shared types and pure helpers for PDF export.
// Platform-specific implementations live in:
//   - export-pdf.native.ts  (iOS / Android — expo-print + expo-sharing)
//   - export-pdf.web.ts     (web / Electron renderer — window.print popup)
//
// Metro and the TypeScript "react-native" resolver pick the correct file via
// the .native.ts / .web.ts suffix automatically.

import { slugify, type ExportNoteInput } from './export-markdown';

export type { ExportNoteInput } from './export-markdown';

export interface PdfPayload {
  filename: string;
  html: string;
}

// ---------------------------------------------------------------------------
// HTML entity escaping — covers the five characters the HTML5 spec requires.
// ---------------------------------------------------------------------------
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Minimal markdown → HTML converter.
// Covers: fenced code blocks (```), ATX headings (#/##/###), **bold**,
// *italic*, `inline code`, blank-line paragraph splits.
// Everything is HTML-escaped first; only our emitted tags are re-inserted.
// This is intentionally tiny — it is not a full CommonMark parser.
// ---------------------------------------------------------------------------
export function markdownToHtml(md: string): string {
  if (md.length === 0) {
    return '<p></p>';
  }

  // 1. Extract fenced code blocks first so their contents are not touched
  //    by the inline regexes below. Replace each fence with a placeholder,
  //    remember its escaped contents, and re-insert at the end.
  const codeBlocks: string[] = [];
  let working = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(escapeHtml(code.replace(/\n$/, '')));
    return `\u0000CODEBLOCK${idx}\u0000`;
  });

  // 2. Split into paragraphs on blank lines.
  const blocks = working.split(/\n{2,}/);

  const htmlBlocks = blocks.map((raw) => {
    const block = raw.trim();
    if (block.length === 0) return '';

    // Code-block placeholder — replace with <pre><code>…</code></pre>
    const codeMatch = block.match(/^\u0000CODEBLOCK(\d+)\u0000$/);
    if (codeMatch) {
      const idx = Number(codeMatch[1]);
      return `<pre><code>${codeBlocks[idx]}</code></pre>`;
    }

    // Headings
    if (/^###\s+/.test(block)) {
      return `<h3>${applyInline(block.replace(/^###\s+/, ''))}</h3>`;
    }
    if (/^##\s+/.test(block)) {
      return `<h2>${applyInline(block.replace(/^##\s+/, ''))}</h2>`;
    }
    if (/^#\s+/.test(block)) {
      return `<h1>${applyInline(block.replace(/^#\s+/, ''))}</h1>`;
    }

    // Paragraph — escape, apply inline, convert single newlines to <br>.
    return `<p>${applyInline(block).replace(/\n/g, '<br>')}</p>`;
  });

  return htmlBlocks.filter((b) => b.length > 0).join('\n');
}

// Inline formatting applied AFTER HTML escaping.
// Order matters: inline code first (so its contents are not re-processed),
// then bold (`**`), then italic (`*`).
function applyInline(raw: string): string {
  // Escape HTML entities in the raw block first.
  let out = escapeHtml(raw);

  // Inline code — non-greedy, single-line.
  const inlineCodes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(code);
    return `\u0000INLINE${idx}\u0000`;
  });

  // Bold then italic. Bold uses `**…**`, italic uses single `*…*`.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Re-insert inline code.
  out = out.replace(/\u0000INLINE(\d+)\u0000/g, (_m, idx) => {
    return `<code>${inlineCodes[Number(idx)]}</code>`;
  });

  return out;
}

/**
 * Build the final `{ filename, html }` payload for a PDF export.
 * The HTML is a minimal self-contained document styled with Graphite tokens.
 */
export function buildPdfHtml(note: ExportNoteInput): PdfPayload {
  const slug = slugify(note.title, note.id);
  const safeTitle =
    note.title.trim().length === 0 ? 'Untitled' : escapeHtml(note.title);
  const bodyHtml = markdownToHtml(note.body ?? '');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { margin: 24mm; }
  html, body {
    margin: 0;
    padding: 0;
    background: #1E1E1E;
    color: #DCDDDE;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.6;
  }
  body { padding: 32px; }
  h1, h2, h3 {
    color: #FFFFFF;
    font-weight: 700;
    margin: 1.4em 0 0.5em;
    line-height: 1.2;
  }
  h1 { font-size: 28px; border-bottom: 1px solid #333333; padding-bottom: 8px; }
  h2 { font-size: 22px; }
  h3 { font-size: 18px; }
  p  { margin: 0.8em 0; }
  strong { color: #FFFFFF; }
  em { font-style: italic; }
  code {
    font-family: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.9em;
    background: #141414;
    color: #DCDDDE;
    padding: 1px 4px;
  }
  pre {
    background: #141414;
    border: 1px solid #333333;
    padding: 12px 14px;
    overflow-x: auto;
    margin: 1em 0;
  }
  pre code {
    background: transparent;
    padding: 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .graphite-title {
    font-size: 28px;
    font-weight: 700;
    color: #FFFFFF;
    margin: 0 0 24px;
    padding-bottom: 8px;
    border-bottom: 1px solid #333333;
  }
</style>
</head>
<body>
<div class="graphite-title">${safeTitle}</div>
${bodyHtml}
</body>
</html>`;

  return {
    filename: `${slug}.pdf`,
    html,
  };
}

// Runtime entry point — overridden by .native.ts / .web.ts.
export async function exportNoteAsPdf(_note: ExportNoteInput): Promise<void> {
  throw new Error(
    'exportNoteAsPdf: no platform implementation resolved. ' +
      'Expected export-pdf.native.ts or export-pdf.web.ts to be picked up by the bundler.',
  );
}
