/**
 * Cross-platform format fidelity test (Phase 3 J2).
 *
 * Guards the contract between `serializeToGraphite` and
 * `deserializeFromGraphite`: given a SpatialCanvasDocument with mixed text
 * blocks + ink strokes at known coordinates, a round-trip through the ZIP
 * format must preserve block IDs, Y positions, content, and every ink point.
 *
 * The same fflate-based code runs on iOS (Hermes), web, and Electron
 * (Node), so a byte-for-byte fidelity guarantee in the pure layer is
 * sufficient to prove cross-device layout parity at the format boundary.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CANVAS_WIDTH,
  deserializeFromGraphite,
  serializeToGraphite,
  type SpatialCanvasDocument,
  type SpatialInkStroke,
} from '../index';

function buildFixtureDocument(): SpatialCanvasDocument {
  const stroke1: SpatialInkStroke = {
    id: 'stroke-alpha',
    color: '#FFFFFF',
    width: 2,
    opacity: 1,
    points: [
      { x: 12.5,  y: 100.0, pressure: 0.25, tilt: 5,  timestamp: 1700000000001 },
      { x: 42.0,  y: 110.5, pressure: 0.55, tilt: 10, timestamp: 1700000000020 },
      { x: 88.75, y: 130.25, pressure: 0.9, tilt: 15, timestamp: 1700000000040 },
    ],
  };
  const stroke2: SpatialInkStroke = {
    id: 'stroke-beta',
    color: '#F28500',
    width: 4,
    opacity: 0.8,
    points: [
      { x: 200, y: 500, pressure: 0.1, tilt: 0, timestamp: 1700000000500 },
      { x: 210, y: 520, pressure: 0.5, tilt: 2, timestamp: 1700000000520 },
    ],
  };

  return {
    version: 2,
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    blocks: [
      { id: 'blk-heading', type: 'text', yPosition: 0,   height: 24, content: '# Title' },
      { id: 'blk-para',    type: 'text', yPosition: 40,  height: 48, content: 'First paragraph.\nWith a soft break.' },
      { id: 'blk-fence',   type: 'text', yPosition: 120, height: 72, content: '```ts\nconst x = 1;\n```' },
    ],
    inkStrokes: [stroke1, stroke2],
    assets: { entries: [] },
  };
}

describe('cross-platform .graphite fidelity', () => {
  it('round-trips block ids, Y positions, content, and ink coordinates exactly', async () => {
    const original = buildFixtureDocument();
    const bytes = await serializeToGraphite(original);
    const restored = await deserializeFromGraphite(bytes);

    expect(restored.version).toBe(2);
    expect(restored.canvasWidth).toBe(original.canvasWidth);

    expect(restored.blocks).toHaveLength(original.blocks.length);
    for (let i = 0; i < original.blocks.length; i++) {
      const src = original.blocks[i];
      const dst = restored.blocks[i];
      expect(dst.id).toBe(src.id);
      expect(dst.yPosition).toBe(src.yPosition);
      expect(dst.type).toBe(src.type);
      expect(dst.content).toBe(src.content);
    }

    expect(restored.inkStrokes).toHaveLength(original.inkStrokes.length);
    for (let s = 0; s < original.inkStrokes.length; s++) {
      const src = original.inkStrokes[s];
      const dst = restored.inkStrokes[s];
      expect(dst.id).toBe(src.id);
      expect(dst.color).toBe(src.color);
      expect(dst.width).toBe(src.width);
      expect(dst.opacity).toBe(src.opacity);
      expect(dst.points).toHaveLength(src.points.length);
      for (let p = 0; p < src.points.length; p++) {
        expect(dst.points[p].x).toBe(src.points[p].x);
        expect(dst.points[p].y).toBe(src.points[p].y);
        expect(dst.points[p].pressure).toBe(src.points[p].pressure);
        expect(dst.points[p].tilt).toBe(src.points[p].tilt);
        expect(dst.points[p].timestamp).toBe(src.points[p].timestamp);
      }
    }
  });

  it('is byte-stable for the same input across two serializations', async () => {
    // fflate's default DEFLATE output is deterministic for the same input,
    // so two serializations of the same doc must produce identical bytes.
    // This is what gives mobile → desktop identical-blob sync parity.
    const doc = buildFixtureDocument();
    const a = await serializeToGraphite(doc);
    const b = await serializeToGraphite(doc);
    expect(a.byteLength).toBe(b.byteLength);
    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`byte ${i} drifts between serializations (a=${a[i]}, b=${b[i]})`);
      }
    }
  });

  it('preserves fidelity through a double round-trip (serialize → deserialize → serialize → deserialize)', async () => {
    const original = buildFixtureDocument();
    const once = await deserializeFromGraphite(await serializeToGraphite(original));
    const twice = await deserializeFromGraphite(await serializeToGraphite(once));

    expect(twice.blocks.map((b) => b.id)).toEqual(original.blocks.map((b) => b.id));
    expect(twice.blocks.map((b) => b.yPosition)).toEqual(original.blocks.map((b) => b.yPosition));
    expect(twice.blocks.map((b) => b.content)).toEqual(original.blocks.map((b) => b.content));
    expect(twice.inkStrokes.map((s) => s.id)).toEqual(original.inkStrokes.map((s) => s.id));
    expect(twice.inkStrokes.flatMap((s) => s.points.map((p) => p.x))).toEqual(
      original.inkStrokes.flatMap((s) => s.points.map((p) => p.x)),
    );
    expect(twice.inkStrokes.flatMap((s) => s.points.map((p) => p.y))).toEqual(
      original.inkStrokes.flatMap((s) => s.points.map((p) => p.y)),
    );
  });
});
