/**
 * Platform-dispatched barrel for InkOverlay.
 *
 * At bundle time Metro picks `InkOverlay.native.tsx` (iOS/Android) or
 * `InkOverlay.web.tsx` (web) via the platform-extension resolver. This base
 * file exists only so TypeScript has a consistent type signature to import
 * from `./InkOverlay` — the runtime implementation is never loaded from here.
 */
export { InkOverlay } from './InkOverlay.web';
export type { InkOverlayProps } from './InkOverlay.web';
