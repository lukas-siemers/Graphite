/**
 * Unit tests for the pure helpers that drive SpatialCanvasRenderer.
 *
 * These are intentionally shallow — no CodeMirror, no iframe, no React.
 * The renderer is a thin shell around three pure functions:
 *
 *   1. isBlockHeightsMessage  — guards the postMessage payload shape
 *   2. recomputeBlockPositions — maps measured heights back onto blocks
 *   3. computeCanvasHeight    — sizes the outer scroll container
 *
 * Everything else (ScrollView, transform scale, focus routing) is
 * React Native plumbing that is better covered by the manual QA smoke in
 * Phase 4.
 */

import { describe, it, expect } from 'vitest';
import {
  isBlockHeightsMessage,
  recomputeBlockPositions,
  computeCanvasHeight,
} from '../spatial-block-layout';
import type { SpatialBlock, SpatialCanvasDocument } from '@graphite/canvas';

function block(id: string, content: string, y: number, height: number): SpatialBlock {
  return { id, type: 'text', yPosition: y, height, content };
}

describe('isBlockHeightsMessage', () => {
  it('accepts a well-formed message', () => {
    expect(
      isBlockHeightsMessage({
        type: 'block-heights',
        blocks: [{ lineStart: 1, lineEnd: 1, height: 24 }],
      }),
    ).toBe(true);
  });

  it('accepts an empty blocks array', () => {
    expect(isBlockHeightsMessage({ type: 'block-heights', blocks: [] })).toBe(true);
  });

  it('rejects the wrong type discriminator', () => {
    expect(
      isBlockHeightsMessage({ type: 'change', blocks: [] }),
    ).toBe(false);
  });

  it('rejects missing blocks property', () => {
    expect(isBlockHeightsMessage({ type: 'block-heights' })).toBe(false);
  });

  it('rejects non-numeric entries', () => {
    expect(
      isBlockHeightsMessage({
        type: 'block-heights',
        blocks: [{ lineStart: '1', lineEnd: 1, height: 24 }],
      }),
    ).toBe(false);
  });

  it('rejects null and primitive values', () => {
    expect(isBlockHeightsMessage(null)).toBe(false);
    expect(isBlockHeightsMessage(undefined)).toBe(false);
    expect(isBlockHeightsMessage('block-heights')).toBe(false);
    expect(isBlockHeightsMessage(42)).toBe(false);
  });
});

describe('recomputeBlockPositions', () => {
  it('is a no-op for an empty block array', () => {
    expect(recomputeBlockPositions([], [], 16)).toEqual([]);
  });

  it('assigns yPosition = 0 to the first block regardless of incoming height', () => {
    const blocks = [block('a', 'hello', 999, 50)];
    const out = recomputeBlockPositions(
      blocks,
      [{ lineStart: 1, lineEnd: 1, height: 24 }],
      16,
    );
    expect(out[0].yPosition).toBe(0);
    expect(out[0].height).toBe(24);
  });

  it('stacks blocks top-down separated by blockGapPx', () => {
    const blocks = [
      block('a', 'a', 0, 24),
      block('b', 'b', 100, 24),
      block('c', 'c', 200, 24),
    ];
    const measured = [
      { lineStart: 1, lineEnd: 1, height: 30 },
      { lineStart: 2, lineEnd: 3, height: 50 },
      { lineStart: 4, lineEnd: 5, height: 40 },
    ];
    const out = recomputeBlockPositions(blocks, measured, 16);
    expect(out.map((b) => b.yPosition)).toEqual([
      0,
      30 + 16,
      30 + 16 + 50 + 16,
    ]);
    expect(out.map((b) => b.height)).toEqual([30, 50, 40]);
  });

  it('shifts later blocks when an earlier block grows', () => {
    const blocks = [
      block('a', 'a', 0, 24),
      block('b', 'b', 40, 24),
    ];
    // Block "a" doubled in height; "b" should move down by the delta.
    const out = recomputeBlockPositions(
      blocks,
      [
        { lineStart: 1, lineEnd: 1, height: 48 },
        { lineStart: 2, lineEnd: 2, height: 24 },
      ],
      16,
    );
    expect(out[0].height).toBe(48);
    expect(out[0].yPosition).toBe(0);
    expect(out[1].yPosition).toBe(48 + 16);
    expect(out[1].height).toBe(24);
  });

  it('preserves id/type/content and only touches yPosition + height', () => {
    const blocks = [block('stable-id', '# Heading', 999, 9999)];
    const [out] = recomputeBlockPositions(
      blocks,
      [{ lineStart: 1, lineEnd: 1, height: 28 }],
      16,
    );
    expect(out.id).toBe('stable-id');
    expect(out.type).toBe('text');
    expect(out.content).toBe('# Heading');
  });

  it('falls back to existing height when measured array is shorter', () => {
    const blocks = [
      block('a', 'a', 0, 24),
      block('b', 'b', 40, 60),
    ];
    const out = recomputeBlockPositions(
      blocks,
      [{ lineStart: 1, lineEnd: 1, height: 30 }],
      16,
    );
    expect(out[0].height).toBe(30);
    // "b" has no measurement — its original height is preserved.
    expect(out[1].height).toBe(60);
    expect(out[1].yPosition).toBe(30 + 16);
  });

  it('ignores measured entries with zero or negative height', () => {
    const blocks = [block('a', 'a', 0, 24)];
    const out = recomputeBlockPositions(
      blocks,
      [{ lineStart: 1, lineEnd: 1, height: 0 }],
      16,
    );
    expect(out[0].height).toBe(24);
  });
});

describe('computeCanvasHeight', () => {
  const emptyDoc = (overrides: Partial<SpatialCanvasDocument>): SpatialCanvasDocument => ({
    version: 2,
    canvasWidth: 816,
    blocks: [],
    inkStrokes: [],
    assets: { entries: [] },
    ...overrides,
  });

  it('returns bottomPadding for an empty doc', () => {
    expect(computeCanvasHeight(emptyDoc({}), 100)).toBe(100);
  });

  it('uses the last block bottom when no ink', () => {
    const doc = emptyDoc({
      blocks: [block('a', 'a', 0, 24), block('b', 'b', 40, 60)],
    });
    // last block bottom = 40 + 60 = 100, plus padding
    expect(computeCanvasHeight(doc, 50)).toBe(150);
  });

  it('extends for ink that reaches below the last block', () => {
    const doc = emptyDoc({
      blocks: [block('a', 'a', 0, 24)],
      inkStrokes: [
        {
          id: 's',
          color: '#fff',
          width: 2,
          opacity: 1,
          points: [
            { x: 0, y: 10, pressure: 0.5, tilt: 0, timestamp: 0 },
            { x: 0, y: 500, pressure: 0.5, tilt: 0, timestamp: 0 },
          ],
        },
      ],
    });
    // max(text bottom = 24, ink bottom = 500) + 100
    expect(computeCanvasHeight(doc, 100)).toBe(600);
  });

  it('uses text bottom when ink is above it', () => {
    const doc = emptyDoc({
      blocks: [block('a', 'a', 0, 24), block('b', 'b', 40, 600)],
      inkStrokes: [
        {
          id: 's',
          color: '#fff',
          width: 2,
          opacity: 1,
          points: [{ x: 0, y: 50, pressure: 0.5, tilt: 0, timestamp: 0 }],
        },
      ],
    });
    // text bottom = 640, ink bottom = 50, padding = 10 → 650
    expect(computeCanvasHeight(doc, 10)).toBe(650);
  });
});
