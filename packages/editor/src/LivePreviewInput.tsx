/**
 * Platform-dispatched barrel for LivePreviewInput.
 *
 * At bundle time Metro picks `LivePreviewInput.native.tsx` (iOS/Android) or
 * `LivePreviewInput.web.tsx` (web) via the platform-extension resolver. This
 * base file exists only so TypeScript has a consistent type signature to
 * import from `./LivePreviewInput` — the runtime implementation is never
 * loaded from here.
 */
export { LivePreviewInput } from './LivePreviewInput.web';
