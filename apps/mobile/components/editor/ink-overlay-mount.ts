/**
 * Pure predicate: should the Skia ink overlay be mounted for this frame?
 *
 * Factored out of `Editor.tsx` so the mount behavior can be unit-tested
 * without pulling the full component tree (which drags in tokens, icons,
 * DrawingCanvas, and any React Native surface a Node-based Vitest cannot
 * resolve). The predicate is also what gates the `React.lazy` fetch of
 * `@shopify/react-native-skia` — a regression here would either leak
 * Skia into the startup path or hide ink from users, so we guard it with
 * tests.
 *
 * The overlay is mounted only when ALL of the following are true:
 *   - the user is not in drawMode (PencilKit owns the surface instead)
 *   - the note has at least one stroke — keeps Skia out of the mount
 *     path for fresh / ink-less notes
 *   - the editor body has been measured (non-zero width AND height)
 *   - the platform is iOS — Android is not a v1.5 target, and web builds
 *     resolve the `.web.tsx` stub anyway
 */
export interface InkOverlayMountArgs {
  drawMode: boolean;
  strokeCount: number;
  layoutWidth: number;
  layoutHeight: number;
  platform: string;
}

export function shouldMountInkOverlay(args: InkOverlayMountArgs): boolean {
  if (args.platform !== 'ios') return false;
  if (args.drawMode) return false;
  if (args.strokeCount <= 0) return false;
  if (args.layoutWidth <= 0 || args.layoutHeight <= 0) return false;
  return true;
}
