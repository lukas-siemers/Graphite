/**
 * Pure-function helpers for SpatialCanvasRenderer.
 *
 * Kept outside the React component so they can be unit-tested without mounting
 * a CodeMirror iframe. The renderer feeds these the doc + the iframe's
 * measured block heights and receives new SpatialBlock[] back.
 */
import type { SpatialBlock, SpatialCanvasDocument } from '@graphite/canvas';

/**
 * Shape of a single entry in the `block-heights` message posted by the
 * editor iframe / WebView. Line numbers are 1-based and refer to the
 * concatenated markdown fed into the editor.
 */
export interface MeasuredBlockHeight {
  lineStart: number;
  lineEnd: number;
  height: number;
}

export interface BlockHeightsMessage {
  type: 'block-heights';
  blocks: MeasuredBlockHeight[];
}

export function isBlockHeightsMessage(value: unknown): value is BlockHeightsMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as { type?: unknown; blocks?: unknown };
  if (v.type !== 'block-heights') return false;
  if (!Array.isArray(v.blocks)) return false;
  return v.blocks.every(
    (b) =>
      b &&
      typeof b === 'object' &&
      typeof (b as MeasuredBlockHeight).lineStart === 'number' &&
      typeof (b as MeasuredBlockHeight).lineEnd === 'number' &&
      typeof (b as MeasuredBlockHeight).height === 'number',
  );
}

/**
 * Recompute yPosition + height for each SpatialBlock using a per-block measured
 * height. Blocks keep their original identity (id, type, content) — only
 * yPosition and height change. Blocks are laid out top-down with `blockGapPx`
 * between them.
 *
 * Measured heights are applied positionally: measured[i] -> blocks[i]. When
 * the measured array is shorter than the block array (e.g. the iframe only
 * measured what's in its visible range), later blocks fall back to their
 * existing `height`.
 */
export function recomputeBlockPositions(
  blocks: SpatialBlock[],
  measured: MeasuredBlockHeight[],
  blockGapPx: number,
): SpatialBlock[] {
  const out: SpatialBlock[] = [];
  let y = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const m = measured[i];
    const height = m && m.height > 0 ? m.height : b.height;
    out.push({ ...b, yPosition: y, height });
    y += height + blockGapPx;
  }
  return out;
}

/**
 * Total scrollable canvas height = max(bottom edge of last block, bottom edge
 * of lowest ink stroke point) + bottomPadding. Used to size the outer scroll
 * container so ink that extends below the text is still reachable.
 */
export function computeCanvasHeight(
  doc: SpatialCanvasDocument,
  bottomPadding: number,
): number {
  let textBottom = 0;
  for (const b of doc.blocks) {
    const bottom = b.yPosition + b.height;
    if (bottom > textBottom) textBottom = bottom;
  }
  let inkBottom = 0;
  for (const s of doc.inkStrokes) {
    for (const p of s.points) {
      if (p.y > inkBottom) inkBottom = p.y;
    }
  }
  return Math.max(textBottom, inkBottom) + bottomPadding;
}
