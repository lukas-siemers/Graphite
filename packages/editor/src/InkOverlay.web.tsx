/**
 * InkOverlay — web / Electron stub (Stage 3).
 *
 * Metro and webpack both resolve `.web.tsx` ahead of `.tsx` when bundling
 * for the web target, so desktop and Expo-web builds pick up THIS file
 * instead of the Skia-powered native variant. That's important: pulling
 * `@shopify/react-native-skia` into a non-native bundle would fail at
 * module load.
 *
 * Stage 3 ships this file as a no-op renderer — the iPad overlay is the
 * only surface that needs ink visible for the v1.5 canvas cutover. Stage
 * 4 (owned by SWE-2) replaces this stub with a real SVG renderer so
 * notes round-trip from iPad to desktop with ink intact. The
 * `InkOverlayProps` contract is kept identical on both platforms so the
 * parent editor never has to branch on platform.
 */

import type { CanvasSchemaV1 } from '@graphite/db';

export interface InkOverlayProps {
  strokes: CanvasSchemaV1.InkStroke[];
  width: number;
  height: number;
}

export function InkOverlay(_props: InkOverlayProps) {
  return null;
}
