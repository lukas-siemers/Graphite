/**
 * Pure helpers for building ink stroke path data from CanvasSchemaV1 strokes.
 *
 * Extracted from `InkOverlay.tsx` so the geometry can be unit-tested in Node
 * without pulling in `@shopify/react-native-skia` (which is native-only and
 * cannot load in Vitest).
 *
 * Stage 3 scope:
 *   - Only `anchor.type === 'absolute'` strokes are emitted. Paragraph-anchored
 *     strokes are reserved for a later stage and silently skipped per
 *     project_stroke_anchor_schema — we never throw on them.
 *   - Path shape uses quadratic curves through consecutive midpoints so
 *     dense PencilKit samples render smoothly instead of as jagged polylines.
 *   - Per-stroke width is the base `stroke.width` scaled by the stroke's
 *     average pressure across its points. A single uniform width is good
 *     enough for the read-only overlay; per-segment pressure taper is a
 *     future enhancement once desktop SVG parity lands.
 */

import type { CanvasSchemaV1 } from '@graphite/db';

type InkStroke = CanvasSchemaV1.InkStroke;
type StrokePoint = CanvasSchemaV1.StrokePoint;

/** A single SVG-style path command, shape used by the pure tests and by
 *  the Skia renderer to translate into `path.moveTo` / `path.quadTo`. */
export type PathCommand =
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'quadTo'; cx: number; cy: number; x: number; y: number };

export interface BuiltStrokePath {
  /** Stroke id — preserved so the renderer can key each <Path>. */
  id: string;
  /** Hex color passed through unchanged. */
  color: string;
  /** Final rendered stroke width (base width scaled by avg pressure). */
  width: number;
  /** Ordered path commands starting with a single moveTo. */
  commands: PathCommand[];
}

/**
 * Drop strokes we cannot render yet. v1.5 only emits `absolute`, but the
 * schema admits `paragraph` for future stages — if one ever lands in the
 * wild we silently ignore it instead of crashing the overlay.
 */
export function filterRenderableStrokes(strokes: InkStroke[]): InkStroke[] {
  return strokes.filter((s) => s.anchor.type === 'absolute');
}

/** Average pressure across the stroke. Defaults to 1 if the points carry
 *  no meaningful pressure (desktop-authored strokes may have pressure=0). */
function averagePressure(points: StrokePoint[]): number {
  if (points.length === 0) return 1;
  let sum = 0;
  for (const p of points) sum += p.pressure;
  const avg = sum / points.length;
  // Clamp into [0.25, 1.5] so a zero-pressure stroke still renders and a
  // runaway outlier can't produce a hairline-wide path.
  if (avg <= 0) return 1;
  return Math.min(1.5, Math.max(0.25, avg));
}

/**
 * Build the quadratic-curve command list for a single stroke's points.
 *
 * Algorithm: anchor at the first point with `moveTo`, then for each interior
 * point use it as a control point and the midpoint with the next point as
 * the curve endpoint. The final point is added via a trailing `lineTo`.
 * This is the standard "midpoint smoothing" used by Skia examples and
 * looks much smoother than straight `lineTo` between dense samples.
 *
 * Edge cases:
 *   - 0 points → no commands (caller should skip the stroke)
 *   - 1 point  → single moveTo (renders as a dot via Skia's cap style)
 *   - 2 points → moveTo + lineTo (no midpoint smoothing possible)
 */
export function buildStrokeCommands(points: StrokePoint[]): PathCommand[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  const cmds: PathCommand[] = [{ type: 'moveTo', x: first.x, y: first.y }];
  if (points.length === 1) return cmds;
  if (points.length === 2) {
    const p = points[1]!;
    cmds.push({ type: 'lineTo', x: p.x, y: p.y });
    return cmds;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const ctrl = points[i]!;
    const next = points[i + 1]!;
    const midX = (ctrl.x + next.x) / 2;
    const midY = (ctrl.y + next.y) / 2;
    cmds.push({ type: 'quadTo', cx: ctrl.x, cy: ctrl.y, x: midX, y: midY });
  }
  const last = points[points.length - 1]!;
  cmds.push({ type: 'lineTo', x: last.x, y: last.y });
  return cmds;
}

/**
 * Produce the data the renderer needs per stroke. Strokes with
 * non-absolute anchors or empty point lists are dropped — the renderer
 * iterates the returned array and never has to branch.
 */
export function buildPaths(strokes: InkStroke[]): BuiltStrokePath[] {
  const out: BuiltStrokePath[] = [];
  for (const stroke of filterRenderableStrokes(strokes)) {
    if (stroke.points.length === 0) continue;
    const commands = buildStrokeCommands(stroke.points);
    if (commands.length === 0) continue;
    out.push({
      id: stroke.id,
      color: stroke.color,
      width: stroke.width * averagePressure(stroke.points),
      commands,
    });
  }
  return out;
}
