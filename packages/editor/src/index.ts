export { CanvasRenderer } from './CanvasRenderer';
export type { CanvasRendererProps } from './CanvasRenderer';
export { SpatialCanvasRenderer } from './SpatialCanvasRenderer';
export type { SpatialCanvasRendererProps } from './SpatialCanvasRenderer';
export { applyFormat } from './applyFormat';
export type { SelectionRange, FormatResult } from './applyFormat';
export type { FormatCommand } from './types';
export { InkOverlay } from './InkOverlay';
export type { InkOverlayProps } from './InkOverlay';
export type { SpatialInkStroke, StrokePoint } from './ink-types';
export {
  isBlockHeightsMessage,
  recomputeBlockPositions,
  computeCanvasHeight,
} from './spatial-block-layout';
export type {
  MeasuredBlockHeight,
  BlockHeightsMessage,
} from './spatial-block-layout';
