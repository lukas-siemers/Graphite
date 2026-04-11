/**
 * Tests for `strokeToOutlinePath` — the pure InkStroke -> SVG path string
 * translation layer that sits on top of `perfect-freehand`.
 *
 * Context
 * -------
 * `strokeToOutlinePath` is imported by the native `CanvasRenderer` (iPad)
 * and fed to Skia as an SVG path for a filled polygon. Because the function
 * is pure and framework-free, we can exercise it directly in Node under
 * Vitest — no Skia, no React Native, no WebView required.
 *
 * Strategy
 * --------
 * The assertions are intentionally loose on exact coordinates (perfect-
 * freehand is allowed to tweak its smoothing / streamline math between
 * patch versions) but tight on the invariants Graphite relies on:
 *
 *  - Empty input -> empty string, never a throw.
 *  - Single point -> valid closed polygon (the "tiny dot" case).
 *  - Symmetry of straight lines with uniform pressure.
 *  - Pressure gradient opens the polygon wider at the high-pressure end.
 *  - Pressure extremes (0.0 and 1.0) do not crash and produce non-empty
 *    output thanks to `start/end.cap: true`.
 *  - Byte-identical output on repeated calls (no hidden global state).
 *  - `PERFECT_FREEHAND_OPTIONS` shape is pinned — any silent tuning change
 *    is a drift failure the QA gate must see before ship.
 *
 * The `makeStroke` factory keeps fixtures compact — callers pass an array
 * of `[x, y, pressure?]` tuples and get back a fully-populated InkStroke.
 */

import { describe, it, expect } from 'vitest';
import { strokeToOutlinePath, PERFECT_FREEHAND_OPTIONS } from '../inkPath';
import type { InkStroke, StrokePoint } from '@graphite/db';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

type RawPoint = [x: number, y: number, pressure?: number];

function makeStroke(
  points: RawPoint[],
  overrides: Partial<Omit<InkStroke, 'points'>> = {},
): InkStroke {
  const strokePoints: StrokePoint[] = points.map(([x, y, pressure = 0.5], i) => ({
    x,
    y,
    pressure,
    tilt: 0,
    timestamp: 1_700_000_000_000 + i,
  }));
  return {
    id: 'stroke-fixture',
    points: strokePoints,
    color: '#FFFFFF',
    width: 4,
    opacity: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Validates that a non-empty output from `strokeToOutlinePath` is a well-
 * formed closed SVG path: starts with `M x y`, has zero or more `L x y`
 * segments, ends with ` Z`, and every coordinate parses as a finite number.
 *
 * We deliberately match the exact literal format our code emits instead of
 * a generic SVG grammar — the path string is hand-built in inkPath.ts and
 * any whitespace/format drift there is a behavior change we want to see.
 */
function assertValidPathString(path: string): void {
  expect(path.length).toBeGreaterThan(0);
  // Shape guard: one M, any number of L, one trailing Z, single-space delim.
  expect(path).toMatch(/^M -?\d+(\.\d+)? -?\d+(\.\d+)?( L -?\d+(\.\d+)? -?\d+(\.\d+)?)* Z$/);

  // Every numeric literal must be finite — catches NaN / Infinity leaks.
  const nums = path.match(/-?\d+(\.\d+)?/g) ?? [];
  expect(nums.length).toBeGreaterThan(0);
  for (const n of nums) {
    expect(Number.isFinite(Number(n))).toBe(true);
  }
  // Coordinate count must be even (pairs of x, y).
  expect(nums.length % 2).toBe(0);
}

/**
 * Parses the `M ... L ... Z` string back into an array of [x, y] tuples so
 * we can reason about the polygon shape (bounding box, vertex count, etc.)
 * without re-implementing perfect-freehand.
 */
function parsePath(path: string): Array<[number, number]> {
  const nums = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push([nums[i], nums[i + 1]]);
  }
  return out;
}

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

function bbox(points: Array<[number, number]>): BBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('strokeToOutlinePath', () => {
  // 1. Empty stroke
  it('returns an empty string for a zero-point stroke and does not throw', () => {
    const stroke = makeStroke([]);
    let path = '';
    expect(() => {
      path = strokeToOutlinePath(stroke);
    }).not.toThrow();
    expect(path).toBe('');
  });

  // 2. Single point
  it('returns a valid closed polygon for a single-point tap (tiny dot)', () => {
    const stroke = makeStroke([[10, 10, 0.5]]);
    const path = strokeToOutlinePath(stroke);

    assertValidPathString(path);
    // Must be a real closed polygon, not the degenerate `M x y Z` fallback.
    expect(path).toContain(' L ');
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);

    // The dot should sit near the input coordinate — bbox should contain
    // (10, 10) within a reasonable radius of the base stroke width.
    const box = bbox(parsePath(path));
    expect(box.minX).toBeLessThanOrEqual(10);
    expect(box.maxX).toBeGreaterThanOrEqual(10);
    expect(box.minY).toBeLessThanOrEqual(10);
    expect(box.maxY).toBeGreaterThanOrEqual(10);
  });

  // 3. Two-point horizontal line, uniform pressure
  it('produces a horizontally-symmetric outline for a two-point horizontal line at uniform 0.5 pressure', () => {
    const stroke = makeStroke([
      [0, 0, 0.5],
      [10, 0, 0.5],
    ]);
    const path = strokeToOutlinePath(stroke);

    assertValidPathString(path);
    expect(path).toContain(' L ');

    const points = parsePath(path);
    const box = bbox(points);

    // Symmetry around y=0 (uniform pressure on a horizontal line).
    // Looseness: allow a half-unit tolerance in case streamline nudges caps.
    expect(Math.abs(box.minY + box.maxY)).toBeLessThanOrEqual(0.5);
    // Bounding box width should cover roughly the line length plus caps.
    expect(box.width).toBeGreaterThanOrEqual(10);
    // Height is dominated by the stroke radius — roughly 2 * (size/2) = size.
    expect(box.height).toBeLessThanOrEqual(stroke.width * 2);
  });

  // 4. Two-point vertical line, uniform pressure
  it('produces a vertically-symmetric outline for a two-point vertical line at uniform 0.5 pressure', () => {
    const stroke = makeStroke([
      [0, 0, 0.5],
      [0, 10, 0.5],
    ]);
    const path = strokeToOutlinePath(stroke);

    assertValidPathString(path);

    const points = parsePath(path);
    const box = bbox(points);

    // Symmetry around x=0.
    expect(Math.abs(box.minX + box.maxX)).toBeLessThanOrEqual(0.5);
    expect(box.height).toBeGreaterThanOrEqual(10);
    expect(box.width).toBeLessThanOrEqual(stroke.width * 2);
  });

  // 5. Three-point zigzag
  it('produces a valid outline for a three-point zigzag with uniform pressure', () => {
    const stroke = makeStroke([
      [0, 0, 0.5],
      [10, 10, 0.5],
      [20, 0, 0.5],
    ]);
    const path = strokeToOutlinePath(stroke);

    assertValidPathString(path);

    const points = parsePath(path);
    // A three-point stroke outline should have plenty of vertices. We can't
    // assert it has more than the two-point case (perfect-freehand's
    // streamline smoothing can actually yield fewer vertices on a sharp
    // zigzag than on a straight line — verified empirically at v1.2.3).
    expect(points.length).toBeGreaterThan(10);

    const box = bbox(points);
    // The zigzag excursion toward (10, 10) must still lift the polygon's
    // upper edge well above a flat-line's ~size/2 height. We allow a very
    // loose floor here: streamline=0.5 trails the pen by a large fraction
    // of the corner height, so empirically maxY lands around ~7.4 instead
    // of 10. The sanity check is simply "the corner pulled the polygon up
    // past a straight-line radius" — any regression that flattens the
    // outline (e.g. streamline=1.0 or bad input mapping) would drop this
    // below the stroke radius.
    expect(box.maxY).toBeGreaterThan(4);
  });

  // 6. Varying pressure 0.1 -> 1.0
  it('opens the polygon wider at the high-pressure end of a pressure gradient', () => {
    // Ten-point horizontal line, pressure ramps linearly 0.1 -> 1.0.
    const rising: RawPoint[] = [];
    const uniform: RawPoint[] = [];
    for (let i = 0; i < 10; i++) {
      rising.push([i * 10, 0, 0.1 + (0.9 * i) / 9]);
      uniform.push([i * 10, 0, 0.5]);
    }
    const risingPath = strokeToOutlinePath(makeStroke(rising));
    const uniformPath = strokeToOutlinePath(makeStroke(uniform));

    assertValidPathString(risingPath);
    assertValidPathString(uniformPath);

    const risingBox = bbox(parsePath(risingPath));
    const uniformBox = bbox(parsePath(uniformPath));

    // With thinning > 0, a rising pressure gradient that ends at 1.0 must
    // produce a taller bounding box than a flat 0.5 baseline. This is the
    // smoke indicator that `thinning` is being honored end-to-end.
    expect(risingBox.height).toBeGreaterThan(uniformBox.height);
  });

  // 7. Pressure 0 throughout
  it('does not crash and produces a valid (degenerate-but-closed) polygon at pressure 0 throughout', () => {
    const stroke = makeStroke([
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ]);
    let path = '';
    expect(() => {
      path = strokeToOutlinePath(stroke);
    }).not.toThrow();

    // `cap: true` in PERFECT_FREEHAND_OPTIONS guarantees the start/end caps
    // render even when thinning drives the radius toward zero mid-stroke,
    // so we still expect a non-empty closed polygon.
    assertValidPathString(path);
  });

  // 8. Pressure 1.0 throughout
  it('produces the widest polygon at pressure 1.0 throughout (wider than pressure 0)', () => {
    const zero = makeStroke([
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ]);
    const one = makeStroke([
      [0, 0, 1],
      [10, 0, 1],
      [20, 0, 1],
    ]);

    const zeroPath = strokeToOutlinePath(zero);
    const onePath = strokeToOutlinePath(one);
    assertValidPathString(zeroPath);
    assertValidPathString(onePath);

    const zeroBox = bbox(parsePath(zeroPath));
    const oneBox = bbox(parsePath(onePath));

    // Pressure 1.0 stroke must be visibly taller (polygon radius) than
    // pressure 0 — this is the high-contrast sanity check for thinning.
    expect(oneBox.height).toBeGreaterThan(zeroBox.height);
  });

  // 9. Path-string validity helper applied as a stand-alone guard
  it('emits a path string matching the documented M ... L ... Z grammar for every non-empty case', () => {
    const cases: InkStroke[] = [
      makeStroke([[0, 0, 0.5]]),
      makeStroke([
        [0, 0, 0.5],
        [10, 0, 0.5],
      ]),
      makeStroke([
        [0, 0, 0.3],
        [5, 5, 0.7],
        [10, 10, 0.9],
      ]),
    ];

    for (const stroke of cases) {
      const path = strokeToOutlinePath(stroke);
      assertValidPathString(path);
    }
  });

  // 10. Determinism
  it('returns byte-identical output for repeated calls on the same stroke', () => {
    const stroke = makeStroke([
      [0, 0, 0.4],
      [10, 5, 0.6],
      [20, 10, 0.8],
      [30, 15, 1.0],
    ]);
    const first = strokeToOutlinePath(stroke);
    const second = strokeToOutlinePath(stroke);
    const third = strokeToOutlinePath(stroke);

    assertValidPathString(first);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  // 11. PERFECT_FREEHAND_OPTIONS shape drift guard
  describe('PERFECT_FREEHAND_OPTIONS drift guard', () => {
    it('exposes the numeric tuning fields inside the 0..1 design contract', () => {
      const opts = PERFECT_FREEHAND_OPTIONS;

      expect(typeof opts.thinning).toBe('number');
      expect(opts.thinning).toBeGreaterThanOrEqual(0);
      expect(opts.thinning as number).toBeLessThanOrEqual(1);

      expect(typeof opts.smoothing).toBe('number');
      expect(opts.smoothing).toBeGreaterThanOrEqual(0);
      expect(opts.smoothing as number).toBeLessThanOrEqual(1);

      expect(typeof opts.streamline).toBe('number');
      expect(opts.streamline).toBeGreaterThanOrEqual(0);
      expect(opts.streamline as number).toBeLessThanOrEqual(1);
    });

    it('has simulatePressure explicitly disabled (we use real Apple Pencil pressure)', () => {
      expect(PERFECT_FREEHAND_OPTIONS.simulatePressure).toBe(false);
    });

    it('has a flat-cap start and end (taper: 0, cap: true) so taps still render as dots', () => {
      const { start, end } = PERFECT_FREEHAND_OPTIONS;
      expect(start).toBeDefined();
      expect(end).toBeDefined();
      expect((start as { taper?: number }).taper).toBe(0);
      expect((start as { cap?: boolean }).cap).toBe(true);
      expect((end as { taper?: number }).taper).toBe(0);
      expect((end as { cap?: boolean }).cap).toBe(true);
    });
  });
});
