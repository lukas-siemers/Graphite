import type { ViewProps } from 'react-native';

/**
 * Matches the InkStroke / StrokePoint shape in packages/db/src/canvas-types.ts.
 * Kept as a structural type here so the native module stays decoupled from
 * the @graphite/db package (the module lives under apps/mobile/modules/ and
 * must be resolvable without going through the monorepo graph).
 */
export interface PencilKitStrokePoint {
  x: number;
  y: number;
  /** 0.0 - 1.0 */
  pressure: number;
  /** degrees */
  tilt: number;
  /** ms, relative to stroke start */
  timestamp: number;
}

export interface PencilKitStroke {
  id: string;
  points: PencilKitStrokePoint[];
  /** Hex color, e.g. "#FFFFFF" */
  color: string;
  width: number;
  /** 0.0 - 1.0 */
  opacity: number;
}

export interface OnStrokesChangedEventPayload {
  strokes: PencilKitStroke[];
}

export interface GraphitePencilKitViewProps extends ViewProps {
  /**
   * Strokes to load on first mount. Subsequent updates to this prop are
   * ignored — the native view only honors the first non-empty load so it
   * never overwrites in-progress edits from a parent re-render.
   */
  initialStrokes?: PencilKitStroke[];
  /**
   * Fires after the user lifts their pencil. The full drawing is re-serialized
   * on every edit (there is no diffing at the bridge layer).
   */
  onStrokesChanged?: (event: { nativeEvent: OnStrokesChangedEventPayload }) => void;
}
