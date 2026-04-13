// All IDs use nanoid. All timestamps are Unix ms integers.

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;   // 0.0–1.0
  tilt: number;       // degrees
  timestamp: number;  // Unix ms
}

export interface InkStroke {
  id: string;
  points: StrokePoint[];
  color: string;      // hex e.g. "#FFFFFF"
  width: number;      // base stroke width, scaled by pressure at render time
  opacity: number;    // 0.0–1.0
}

export interface InkLayer {
  strokes: InkStroke[];
}

export interface TextContent {
  body: string;       // markdown source rendered by the live-preview editor
}

export interface CanvasDocument {
  version: number;    // schema version, currently 1
  textContent: TextContent;
  inkLayer: InkLayer;
}

export function createEmptyCanvas(): CanvasDocument {
  return {
    version: 1,
    textContent: { body: '' },
    inkLayer: { strokes: [] },
  };
}
