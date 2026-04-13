import { nanoid } from 'nanoid/non-secure';
import type { SpatialBlock } from './spatial-types';

export interface MarkdownChunk {
  id: string;
  content: string;
}

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}#{1,6}\s/;

function isFenceOpen(line: string): { marker: string; indent: string } | null {
  const m = line.match(FENCE_RE);
  if (!m) return null;
  return { indent: m[1], marker: m[2] };
}

function isFenceClose(line: string, openMarker: string): boolean {
  const m = line.match(FENCE_RE);
  if (!m) return false;
  // Closing fence must use the same character and at least as many as the opener.
  const openChar = openMarker[0];
  return m[2][0] === openChar && m[2].length >= openMarker.length;
}

/**
 * Split a markdown string into chunks. Rules:
 *   - Blank lines separate chunks.
 *   - Headings (#, ##, ...) always start a new chunk.
 *   - Fenced code blocks (``` / ~~~) are never split; the whole fence is one chunk.
 */
export function chunksFromMarkdown(md: string): MarkdownChunk[] {
  if (md === '') return [];

  const lines = md.split('\n');
  const chunks: MarkdownChunk[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  const flush = () => {
    if (current.length === 0) return;
    // Trim trailing blank lines that may have accumulated in the buffer.
    while (current.length > 0 && current[current.length - 1] === '') {
      current.pop();
    }
    if (current.length === 0) return;
    chunks.push({ id: nanoid(), content: current.join('\n') });
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inFence) {
      current.push(line);
      if (isFenceClose(line, fenceMarker)) {
        inFence = false;
        fenceMarker = '';
        flush();
      }
      continue;
    }

    const fence = isFenceOpen(line);
    if (fence) {
      // Start of a new fenced block. If anything is pending, flush it first.
      flush();
      inFence = true;
      fenceMarker = fence.marker;
      current.push(line);
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    if (HEADING_RE.test(line)) {
      // Headings always start a new chunk.
      flush();
      current.push(line);
      // Heading is a single-line chunk by convention — flush immediately so the
      // next non-blank line becomes a separate block.
      flush();
      continue;
    }

    current.push(line);
  }

  // End-of-input flush — if we were still in a fence, emit whatever we have
  // so malformed input round-trips rather than being dropped.
  if (inFence || current.length > 0) {
    flush();
  }

  return chunks;
}

/** Join chunks back into markdown with blank-line separators. */
export function markdownFromChunks(chunks: MarkdownChunk[]): string {
  return chunks.map((c) => c.content).join('\n\n');
}

/**
 * Assign yPosition + height to each chunk based on its line count.
 * Height is `lineCount * lineHeightPx`; the next block's yPosition is the
 * previous block's (yPosition + height + blockGapPx).
 */
export function assignYPositions(
  chunks: MarkdownChunk[],
  lineHeightPx: number,
  blockGapPx: number,
): SpatialBlock[] {
  const out: SpatialBlock[] = [];
  let y = 0;
  for (const c of chunks) {
    const lineCount = c.content.split('\n').length;
    const height = lineCount * lineHeightPx;
    out.push({
      id: c.id,
      type: 'text',
      yPosition: y,
      height,
      content: c.content,
    });
    y += height + blockGapPx;
  }
  return out;
}

/**
 * Shift every block whose yPosition >= insertionY by deltaY. Returns a new
 * array — input is not mutated.
 */
export function shiftBlocksBelow(
  blocks: SpatialBlock[],
  insertionY: number,
  deltaY: number,
): SpatialBlock[] {
  return blocks.map((b) =>
    b.yPosition >= insertionY ? { ...b, yPosition: b.yPosition + deltaY } : b,
  );
}
