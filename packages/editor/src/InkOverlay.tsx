/**
 * InkOverlay — read-only Skia rendering of v1.5 canvas ink strokes.
 *
 * Renders above the text editor surface with `pointerEvents='none'` so the
 * text input receives every touch. This is the mobile-native variant;
 * `InkOverlay.web.tsx` stubs out to `null` until the desktop SVG renderer
 * lands in Stage 4.
 *
 * Startup safety (see CLAUDE.md "iOS production startup trap"):
 *   The `@shopify/react-native-skia` import is intentionally kept at module
 *   scope inside THIS file, but this file must only be imported via
 *   `React.lazy(() => import('@graphite/editor/.../InkOverlay'))` from the
 *   mobile app, and the caller must mount `<InkOverlay>` only when there is
 *   at least one stroke to render. If a future caller imports this file
 *   eagerly at startup, Skia will re-enter the production startup path and
 *   risk the builds 46-50 black-screen regression.
 *
 * Stage 3 is read-only: no touch handlers, no editing, no animation loop.
 * Strokes are rendered once from props and re-rendered whenever `strokes`
 * changes identity (parent re-serializes canvas_json).
 */

import * as React from 'react';
import { StyleSheet, View } from 'react-native';
// STARTUP-TRAP NOTE: this native Skia import is safe only because this
// file is loaded via React.lazy from apps/mobile/components/editor/Editor.tsx
// behind a `strokes.length > 0` guard. Do NOT import InkOverlay at module
// scope from a startup-path file — see CLAUDE.md "iOS production startup
// trap" and the builds 46-50 incident in the CanvasRenderer comment header.
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import type { CanvasSchemaV1 } from '@graphite/db';
import { buildPaths, type BuiltStrokePath } from './ink-paths';

export interface InkOverlayProps {
  /** Canvas ink strokes in v1 schema shape. Safe to pass an empty array,
   *  but the parent should avoid mounting the component at all in that
   *  case to keep Skia out of the mount path when there's nothing to
   *  draw. */
  strokes: CanvasSchemaV1.InkStroke[];
  /** Overlay width in px — full viewport width, not the 680px text column.
   *  Ink at x > 680 must still render outside the text column. */
  width: number;
  /** Overlay height in px — as tall as the scroll content so strokes at
   *  any y coordinate are visible without clipping. */
  height: number;
}

/**
 * Convert a single `BuiltStrokePath` into a Skia `SkPath`. Split out so
 * the hook can memoize per-stroke without rebuilding the whole list when
 * a single stroke changes identity.
 */
function toSkiaPath(built: BuiltStrokePath) {
  const path = Skia.Path.Make();
  for (const cmd of built.commands) {
    if (cmd.type === 'moveTo') {
      path.moveTo(cmd.x, cmd.y);
    } else if (cmd.type === 'lineTo') {
      path.lineTo(cmd.x, cmd.y);
    } else {
      path.quadTo(cmd.cx, cmd.cy, cmd.x, cmd.y);
    }
  }
  return path;
}

export function InkOverlay({ strokes, width, height }: InkOverlayProps) {
  const built = React.useMemo(() => buildPaths(strokes), [strokes]);
  const skPaths = React.useMemo(
    () => built.map((b) => ({ built: b, path: toSkiaPath(b) })),
    [built],
  );

  // Nothing renderable — return an empty View rather than a null so the
  // parent's layout doesn't shift if strokes transition in/out.
  if (skPaths.length === 0) {
    return <View pointerEvents="none" style={[styles.overlay, { width, height }]} />;
  }

  return (
    <View pointerEvents="none" style={[styles.overlay, { width, height }]}>
      <Canvas style={{ width, height }}>
        {skPaths.map(({ built: b, path }) => (
          <Path
            key={b.id}
            path={path}
            color={b.color}
            style="stroke"
            strokeWidth={b.width}
            strokeCap="round"
            strokeJoin="round"
          />
        ))}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
