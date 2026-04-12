/**
 * Unit tests for the desktop / web SVG ink overlay.
 *
 * These live in the editor package so they run under the same Vitest
 * project as `applyFormat.test.ts` — pure logic only, no DOM. We test:
 *
 *   - the pure `commandsToD` translator from the shared PathCommand list
 *     into an SVG `d` attribute
 *   - that the React element tree produced by `<InkOverlay>` only
 *     includes renderable strokes (via the shared `ink-paths.ts` filter)
 *     and emits well-formed SVG `<path>` props
 *
 * The geometry itself (midpoint smoothing, pressure -> width, anchor
 * filtering) is already covered by `ink-paths.test.ts`, so we don't
 * duplicate those assertions here — we only test the web-specific
 * concerns: command-list -> `d` string and React prop shape.
 *
 * The Vitest env is 'node' so we inspect `React.createElement` output
 * directly instead of mounting the component.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { InkOverlay, commandsToD } from '../InkOverlay.web';
import type { PathCommand } from '../ink-paths';
import { CanvasSchemaV1 } from '@graphite/db';

// The InkOverlay props model consumes the v1 canvas_json schema —
// NOT the legacy CanvasDocument shape in `canvas-types.ts`. Alias them
// here so the tests read cleanly.
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
// commandsToD — shared PathCommand list -> SVG `d` string
// ---------------------------------------------------------------------------

describe('commandsToD', () => {
  it('returns empty string for an empty command list', () => {
    expect(commandsToD([])).toBe('');
  });

  it('emits an M command for moveTo', () => {
    const cmds: PathCommand[] = [{ type: 'moveTo', x: 5, y: 7 }];
    expect(commandsToD(cmds)).toBe('M 5 7');
  });

  it('emits an L command for lineTo', () => {
    const cmds: PathCommand[] = [
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 10, y: 10 },
    ];
    expect(commandsToD(cmds)).toBe('M 0 0 L 10 10');
  });

  it('emits a Q command for quadTo', () => {
    const cmds: PathCommand[] = [
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'quadTo', cx: 5, cy: 5, x: 10, y: 0 },
    ];
    expect(commandsToD(cmds)).toBe('M 0 0 Q 5 5 10 0');
  });

  it('composes a full stroke path (M + Q* + L)', () => {
    // The shape `buildPaths` emits for a 3-point stroke: M + Q + L.
    const cmds: PathCommand[] = [
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'quadTo', cx: 5, cy: 5, x: 7.5, y: 2.5 },
      { type: 'lineTo', x: 10, y: 0 },
    ];
    expect(commandsToD(cmds)).toBe('M 0 0 Q 5 5 7.5 2.5 L 10 0');
  });

  it('strips trailing zeros from floating-point coords', () => {
    // Guard against emitting '7.500' / '2.500' and bloating dense
    // stroke paths. (10+5)/2 = 7.5 must render as '7.5'.
    const cmds: PathCommand[] = [{ type: 'moveTo', x: 7.5, y: 2.5 }];
    expect(commandsToD(cmds)).toBe('M 7.5 2.5');
  });

  it('truncates to 3 decimals for very long fractions', () => {
    const cmds: PathCommand[] = [{ type: 'moveTo', x: 0.123456789, y: 1 }];
    expect(commandsToD(cmds)).toBe('M 0.123 1');
  });

  it('produces a parseable SVG path (starts with M, only allowed tokens)', () => {
    const cmds: PathCommand[] = [
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'quadTo', cx: 1, cy: 1, x: 2, y: 0 },
      { type: 'quadTo', cx: 3, cy: -1, x: 4, y: 0 },
      { type: 'lineTo', x: 5, y: 0 },
    ];
    const d = commandsToD(cmds);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toMatch(/^[MLQ][A-Z0-9 .\-]+( [MLQ] [A-Z0-9 .\-]+)*$/);
  });
});

// ---------------------------------------------------------------------------
// InkOverlay React element tree
// ---------------------------------------------------------------------------

// Walk the React element tree and collect every rendered <path> prop bag.
function collectPathProps(node: React.ReactNode): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  React.Children.forEach(node as React.ReactElement, (child) => {
    if (!child || typeof child !== 'object') return;
    const el = child as React.ReactElement<Record<string, unknown>>;
    if (el.type === 'path') {
      out.push(el.props as Record<string, unknown>);
    }
    const childChildren = (el.props as { children?: React.ReactNode }).children;
    if (childChildren) {
      out.push(...collectPathProps(childChildren));
    }
  });
  return out;
}

describe('InkOverlay', () => {
  it('renders one <path> per absolute-anchored stroke', () => {
    const strokes: InkStroke[] = [
      mkStroke({ id: 'a' }),
      mkStroke({ id: 'b' }),
      mkStroke({ id: 'c' }),
    ];
    const element = InkOverlay({ strokes, width: 680, height: 400 });
    const paths = collectPathProps(element);
    expect(paths).toHaveLength(3);
  });

  it('skips strokes anchored to a paragraph (shared filter)', () => {
    // The shared `ink-paths.buildPaths` drops non-absolute anchors before
    // the overlay even sees them, so the SVG should contain only the two
    // absolute strokes.
    const strokes: InkStroke[] = [
      mkStroke({ id: 'absolute-one' }),
      mkStroke({
        id: 'paragraph-one',
        anchor: { type: 'paragraph', paragraphId: 'p1', offsetX: 0, offsetY: 0 },
      }),
      mkStroke({ id: 'absolute-two' }),
    ];
    const element = InkOverlay({ strokes, width: 680, height: 400 });
    const paths = collectPathProps(element);
    expect(paths).toHaveLength(2);
  });

  it('skips strokes with zero points', () => {
    const strokes: InkStroke[] = [
      mkStroke({ id: 'real' }),
      mkStroke({ id: 'empty', points: [] }),
    ];
    const element = InkOverlay({ strokes, width: 100, height: 100 });
    const paths = collectPathProps(element);
    expect(paths).toHaveLength(1);
  });

  it('emits a valid d attribute on each path', () => {
    const strokes: InkStroke[] = [
      mkStroke({
        id: 's1',
        points: [mkPoint(0, 0), mkPoint(5, 5), mkPoint(10, 0)],
      }),
    ];
    const element = InkOverlay({ strokes, width: 100, height: 100 });
    const paths = collectPathProps(element);
    expect(paths[0].d).toBe('M 0 0 Q 5 5 7.5 2.5 L 10 0');
    expect(paths[0].fill).toBe('none');
    expect(paths[0].stroke).toBe('#FFFFFF');
    expect(paths[0].strokeLinecap).toBe('round');
    expect(paths[0].strokeLinejoin).toBe('round');
  });

  it('scales strokeWidth via the shared helper', () => {
    // The shared `ink-paths.ts` clamps avg pressure into [0.25, 1.5]
    // (zero-pressure strokes become 1×). We don't re-test that curve
    // here — we just assert that the props reflect the shared helper's
    // output.
    const strokes: InkStroke[] = [
      mkStroke({
        id: 'neutral',
        width: 4,
        points: [mkPoint(0, 0, 0.5), mkPoint(1, 1, 0.5)],
      }),
      mkStroke({
        id: 'hard',
        width: 4,
        points: [mkPoint(0, 0, 1), mkPoint(1, 1, 1)],
      }),
    ];
    const element = InkOverlay({ strokes, width: 100, height: 100 });
    const paths = collectPathProps(element);
    // 4 × 0.5 = 2, 4 × 1 = 4 (clamped in [0.25, 1.5])
    expect(paths[0].strokeWidth).toBe(2);
    expect(paths[1].strokeWidth).toBe(4);
  });

  it('sets the SVG container size and pointer-events', () => {
    const element = InkOverlay({ strokes: [], width: 680, height: 400 });
    const svgProps = (element as React.ReactElement).props as Record<string, unknown>;
    expect(svgProps.width).toBe(680);
    expect(svgProps.height).toBe(400);
    expect(svgProps.viewBox).toBe('0 0 680 400');
    const style = svgProps.style as React.CSSProperties;
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(0);
    expect(style.left).toBe(0);
    expect(style.pointerEvents).toBe('none');
  });

  it('renders nothing when there are no strokes', () => {
    const element = InkOverlay({ strokes: [], width: 100, height: 100 });
    const paths = collectPathProps(element);
    expect(paths).toHaveLength(0);
  });
});
