export { Editor } from './Editor';
export { CanvasRenderer } from './CanvasRenderer';
export type { CanvasRendererProps } from './CanvasRenderer';
export { applyFormat } from './applyFormat';
export type { SelectionRange, FormatResult } from './applyFormat';
export type { FormatCommand } from './types';
export { applyFormatCommand, detectActiveFormats } from './types';
// InkOverlay ships platform-aware: `InkOverlay.tsx` is the Skia iPad
// renderer; `InkOverlay.web.tsx` is a Stage 3 stub that renders `null`
// and gets replaced with a real SVG renderer by Stage 4 (SWE-2). Metro
// + webpack both resolve the right file by platform suffix when
// consumers write `import { InkOverlay } from '@graphite/editor'`, so
// re-exporting here keeps that single import path working in both
// bundles.
export { InkOverlay } from './InkOverlay';
export type { InkOverlayProps } from './InkOverlay';
