/**
 * Unit tests for `ink-paths.ts` — the pure path-command builder used by
 * the Skia `InkOverlay` renderer on iPad.
 *
 * These tests intentionally do NOT import `InkOverlay.tsx`. That file
 * binds to `@shopify/react-native-skia`, which is a native-only module
 * and cannot resolve inside Vitest's Node environment. Keeping the
 * geometry in its own module lets us guard Stage 3 against schema drift,
 * anchor filtering regressions, and smoothing math changes without
 * building the whole renderer.
 */
import { describe, it, expect } from 'vitest';
import { CanvasSchemaV1 } from '@graphite/db';
import {
  buildPaths,
  buildStrokeCommands,
  filterRenderableStrokes,
} from '../ink-paths';

type InkStroke = CanvasSchemaV1.InkStroke;
type StrokePoint = CanvasSchemaV1.StrokePoint;

function mkPoint(
  x: number,
  y: number,
  pressure: number = 0.5,
  timeOffset: number = 0,
): StrokePoint {
  return { x, y, pressure, timeOffset };
}

function mkStroke(overrides: Partial<InkStroke> = {}): InkStroke {
  return {
    id: 'stroke-1',
    points: [mkPoint(0, 0), mkPoint(10, 10)],
    color: '#FFFFFF',
    width: 2,
    tool: 'pen',
    anchor: { type: 'absolute', x: 0, y: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterRenderableStrokes — anchor discriminated union policy
// ---------------------------------------------------------------------------

describe('filterRenderableStrokes', () => {
  it('keeps absolute-anchored strokes', () => {
    const s = mkStroke({ anchor: { type: 'absolute', x: 10, y: 20 } });
    expect(filterRenderableStrokes([s])).toEqual([s]);
  });

  it('drops paragraph-anchored strokes (reserved for future stages)', () => {
    const abs = mkStroke({ id: 'abs' });
    const para = mkStroke({
      id: 'para',
      anchor: { type: 'paragraph', paragraphId: 'p1', offsetX: 0, offsetY: 0 },
    });
    const out = filterRenderableStrokes([abs, para]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('abs');
  });

  it('does not throw on an unknown anchor — it silently skips', () => {
    // Simulate a future anchor variant landing in the wild before the
    // renderer knows about it. The TS cast is deliberate; at runtime we
    // need the filter to tolerate the drift, not crash.
    const weird = {
      ...mkStroke(),
      anchor: { type: 'grid', row: 0, col: 0 },
    } as unknown as InkStroke;
    expect(() => filterRenderableStrokes([weird])).not.toThrow();
    expect(filterRenderableStrokes([weird])).toHaveLength(0);
  });

  it('returns an empty array for an empty input', () => {
    expect(filterRenderableStrokes([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildStrokeCommands — smoothing algorithm
// ---------------------------------------------------------------------------

describe('buildStrokeCommands', () => {
  it('returns no commands for an empty point array', () => {
    expect(buildStrokeCommands([])).toEqual([]);
  });

  it('emits only a moveTo for a single point', () => {
    expect(buildStrokeCommands([mkPoint(5, 7)])).toEqual([
      { type: 'moveTo', x: 5, y: 7 },
    ]);
  });

  it('emits moveTo + lineTo for exactly two points (no interior curves possible)', () => {
    expect(buildStrokeCommands([mkPoint(0, 0), mkPoint(10, 10)])).toEqual([
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 10, y: 10 },
    ]);
  });

  it('uses quadratic midpoint smoothing for 3+ points', () => {
    const cmds = buildStrokeCommands([
      mkPoint(0, 0),
      mkPoint(10, 10),
      mkPoint(20, 0),
    ]);
    // moveTo anchors the start, quadTo curves through p1 to the midpoint
    // between p1 and p2, and a trailing lineTo terminates exactly at the
    // final sample so users never lose their last pixel.
    expect(cmds).toEqual([
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'quadTo', cx: 10, cy: 10, x: 15, y: 5 },
      { type: 'lineTo', x: 20, y: 0 },
    ]);
  });

  it('preserves stroke length (start + end always reachable) with dense samples', () => {
    const pts = [0, 1, 2, 3, 4, 5].map((i) => mkPoint(i, i * 2));
    const cmds = buildStrokeCommands(pts);
    const first = cmds[0]!;
    const last = cmds[cmds.length - 1]!;
    expect(first.type).toBe('moveTo');
    if (first.type === 'moveTo') {
      expect(first.x).toBe(0);
      expect(first.y).toBe(0);
    }
    expect(last.type).toBe('lineTo');
    if (last.type === 'lineTo') {
      expect(last.x).toBe(5);
      expect(last.y).toBe(10);
    }
  });
});

// ---------------------------------------------------------------------------
// buildPaths — integration of filter + smoothing + width scaling
// ---------------------------------------------------------------------------

describe('buildPaths', () => {
  it('returns empty for no strokes', () => {
    expect(buildPaths([])).toEqual([]);
  });

  it('returns empty when strokes exist but none are renderable', () => {
    const para = mkStroke({
      anchor: { type: 'paragraph', paragraphId: 'p', offsetX: 0, offsetY: 0 },
    });
    expect(buildPaths([para])).toEqual([]);
  });

  it('skips strokes with zero points', () => {
    const good = mkStroke({ id: 'good' });
    const empty = mkStroke({ id: 'empty', points: [] });
    const out = buildPaths([good, empty]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('good');
  });

  it('preserves id and color passthrough', () => {
    const s = mkStroke({ id: 'abc', color: '#FFB347' });
    const [built] = buildPaths([s]);
    expect(built!.id).toBe('abc');
    expect(built!.color).toBe('#FFB347');
  });

  it('scales width by average pressure and clamps into [0.25, 1.5]x', () => {
    const soft = mkStroke({
      id: 'soft',
      width: 4,
      points: [mkPoint(0, 0, 0.1), mkPoint(1, 1, 0.1)],
    });
    const hard = mkStroke({
      id: 'hard',
      width: 4,
      points: [mkPoint(0, 0, 2), mkPoint(1, 1, 2)],
    });
    const zero = mkStroke({
      id: 'zero',
      width: 4,
      points: [mkPoint(0, 0, 0), mkPoint(1, 1, 0)],
    });
    const out = buildPaths([soft, hard, zero]);
    // 0.1 avg clamps to 0.25 → 1
    expect(out[0]!.width).toBeCloseTo(1, 6);
    // 2 avg clamps to 1.5 → 6
    expect(out[1]!.width).toBeCloseTo(6, 6);
    // 0 avg defaults to 1 → unscaled base width
    expect(out[2]!.width).toBe(4);
  });

  it('emits the expected moveTo / quadTo / lineTo sequence for a 3-point stroke', () => {
    const s = mkStroke({
      id: 'curve',
      points: [mkPoint(0, 0), mkPoint(5, 5), mkPoint(10, 0)],
    });
    const [built] = buildPaths([s]);
    expect(built!.commands).toEqual([
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'quadTo', cx: 5, cy: 5, x: 7.5, y: 2.5 },
      { type: 'lineTo', x: 10, y: 0 },
    ]);
  });

  it('renders only absolute strokes when a mixed batch is supplied', () => {
    const strokes: InkStroke[] = [
      mkStroke({ id: 'absolute-one' }),
      mkStroke({
        id: 'paragraph-one',
        anchor: { type: 'paragraph', paragraphId: 'p1', offsetX: 0, offsetY: 0 },
      }),
      mkStroke({ id: 'absolute-two' }),
    ];
    const out = buildPaths(strokes);
    expect(out.map((b) => b.id)).toEqual(['absolute-one', 'absolute-two']);
  });
});
