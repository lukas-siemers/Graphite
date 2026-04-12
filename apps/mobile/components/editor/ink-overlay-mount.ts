/**
 * Pure predicate: should the ink overlay be mounted for this frame?
 *
 * Factored out of `Editor.tsx` so the mount behavior can be unit-tested
 * without pulling the full component tree (which drags in tokens, icons,
 * DrawingCanvas, and any React Native surface a Node-based Vitest cannot
 * resolve). The predicate also gates the `React.lazy` import chunk that
 * picks up either the Skia-powered `InkOverlay.tsx` (iOS) or the SVG
 * `InkOverlay.web.tsx` (web / Electron) based on platform-suffix
 * resolution. A regression here would either leak Skia into the startup
 * path or hide ink from users, so we guard it with tests.
 *
 * The overlay is mounted only when ALL of the following are true:
 *   - the user is not in drawMode (PencilKit owns the surface instead)
 *   - the note has at least one stroke — keeps Skia out of the mount
 *     path for fresh / ink-less notes, and the web bundle doesn't
 *     render an empty SVG needlessly
 *   - the editor body has been measured (non-zero width AND height)
 *   - the platform is iOS or web — Android is not a v1.5 target. Web
 *     covers both Expo-web dev and the Electron desktop renderer, both
 *     of which bundle `InkOverlay.web.tsx` (no Skia import anywhere).
 */
export interface InkOverlayMountArgs {
  drawMode: boolean;
  strokeCount: number;
  layoutWidth: number;
  layoutHeight: number;
  platform: string;
}

export function shouldMountInkOverlay(args: InkOverlayMountArgs): boolean {
  if (args.platform !== 'ios' && args.platform !== 'web') return false;
  if (args.drawMode) return false;
  if (args.strokeCount <= 0) return false;
  if (args.layoutWidth <= 0 || args.layoutHeight <= 0) return false;
  return true;
}
