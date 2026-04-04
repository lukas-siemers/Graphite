export interface Point {
  x: number;
  y: number;
  /** Apple Pencil pressure 0–1; defaults to 0.5 when not available */
  pressure: number;
  /** Apple Pencil altitude angle in degrees 0–90; defaults to 0 */
  tilt: number;
}

export interface Stroke {
  /** nanoid */
  id: string;
  tool: 'pen' | 'eraser';
  /** Hex colour string; default '#FFFFFF' for pen */
  color: string;
  /** Base stroke width 1–8 */
  width: number;
  points: Point[];
}

export interface DrawingCanvasProps {
  noteId: string;
  onClose: () => void;
  initialStrokes?: Stroke[];
  onSave: (strokes: Stroke[]) => void;
}
