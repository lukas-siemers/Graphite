import type { CanvasDocument, InkStroke } from '@graphite/db';
import {
  assignYPositions,
  chunksFromMarkdown,
} from './block-chunking';
import {
  DEFAULT_CANVAS_WIDTH,
  type SpatialCanvasDocument,
  type SpatialInkStroke,
} from './spatial-types';

const LINE_HEIGHT_PX = 24;
const BLOCK_GAP_PX = 16;

function migrateStroke(s: InkStroke): SpatialInkStroke {
  // v1 strokes had only local canvas coordinates (no concept of absolute
  // Y on an infinite page). Preserve the point data as-is; Y=0 is an
  // accurate marker that these came from a pre-spatial document.
  return {
    id: s.id,
    points: s.points.map((p) => ({
      x: p.x,
      y: p.y,
      pressure: p.pressure,
      tilt: p.tilt,
      timestamp: p.timestamp,
    })),
    color: s.color,
    width: s.width,
    opacity: s.opacity,
  };
}

/**
 * Convert a legacy v1 CanvasDocument ({ textContent.body, inkLayer.strokes })
 * into a v2 SpatialCanvasDocument. Body markdown is chunked on blank-line
 * boundaries; each chunk becomes a text block with a sequential Y position.
 */
export function migrateCanvasDocumentToSpatial(
  v1: CanvasDocument,
): SpatialCanvasDocument {
  const chunks = chunksFromMarkdown(v1.textContent?.body ?? '');
  const blocks = assignYPositions(chunks, LINE_HEIGHT_PX, BLOCK_GAP_PX);
  const inkStrokes = (v1.inkLayer?.strokes ?? []).map(migrateStroke);

  return {
    version: 2,
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    blocks,
    inkStrokes,
    assets: { entries: [] },
  };
}
