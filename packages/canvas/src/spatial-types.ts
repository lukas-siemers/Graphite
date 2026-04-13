// All IDs use nanoid. All timestamps are Unix ms integers.
// Pixel dimensions are in canonical canvas coordinates (816px wide).

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  tilt: number;
  timestamp: number;
}

export interface SpatialInkStroke {
  id: string;
  points: StrokePoint[];
  color: string;
  width: number;
  opacity: number;
}

export type SpatialBlockType = 'text' | 'image';

export interface SpatialBlock {
  id: string;
  type: SpatialBlockType;
  yPosition: number;
  height: number;
  content: string;
}

export interface AssetEntry {
  id: string;
  filename: string;
  mimeType: string;
  width?: number;
  height?: number;
  blockId?: string;
}

export interface AssetManifest {
  entries: AssetEntry[];
}

export interface SpatialCanvasDocument {
  version: 2;
  canvasWidth: number;
  blocks: SpatialBlock[];
  inkStrokes: SpatialInkStroke[];
  assets: AssetManifest;
}

export const DEFAULT_CANVAS_WIDTH = 816;

export function createEmptySpatialCanvas(): SpatialCanvasDocument {
  return {
    version: 2,
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    blocks: [],
    inkStrokes: [],
    assets: { entries: [] },
  };
}
