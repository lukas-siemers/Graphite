// ---------------------------------------------------------------------------
// Pure ink-path helpers — runs in Node (Vitest) so the stroke-outline math
// can be unit tested without a native Skia runtime.
//
// The native CanvasRenderer pipes every committed + in-flight InkStroke
// through strokeToOutlinePath() to produce an SVG path string that Skia
// renders as a filled polygon. perfect-freehand handles pressure, smoothing
// and tapering — we only own the InkStroke -> SVG string translation.
// ---------------------------------------------------------------------------

import { getStroke } from 'perfect-freehand';
import type { StrokeOptions } from 'perfect-freehand';
import type { InkStroke } from '@graphite/db';

/**
 * Default perfect-freehand options used for every Graphite stroke.
 *
 * `simulatePressure` is off because Apple Pencil gives us real pressure
 * values. `taper: 0` keeps the cap flat — we're drawing notes, not
 * calligraphy — and `cap: true` makes sure tiny taps still render as dots.
 */
export const PERFECT_FREEHAND_OPTIONS: StrokeOptions = {
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  start: { taper: 0, cap: true },
  end: { taper: 0, cap: true },
  simulatePressure: false,
};

/**
 * Convert an InkStroke into a closed SVG path string describing the
 * filled polygon that perfect-freehand generates around the input points.
 *
 * Returns an empty string when the stroke has too few points to produce
 * a meaningful outline — callers should skip rendering in that case.
 */
export function strokeToOutlinePath(stroke: InkStroke): string {
  if (stroke.points.length === 0) return '';

  const inputPoints: [number, number, number][] = stroke.points.map((p) => [
    p.x,
    p.y,
    p.pressure,
  ]);

  const outline = getStroke(inputPoints, {
    ...PERFECT_FREEHAND_OPTIONS,
    size: stroke.width,
    last: true,
  });

  if (outline.length === 0) return '';

  const [first, ...rest] = outline;
  const [x0, y0] = first;
  if (rest.length === 0) {
    return `M ${x0} ${y0} Z`;
  }
  const tail = rest.map(([x, y]) => `L ${x} ${y}`).join(' ');
  return `M ${x0} ${y0} ${tail} Z`;
}
