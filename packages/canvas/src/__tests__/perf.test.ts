import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CANVAS_WIDTH,
  deserializeFromGraphite,
  serializeToGraphite,
  type SpatialCanvasDocument,
} from '../index';

function build10KbDocument(): SpatialCanvasDocument {
  // Roughly 10KB of natural prose split across 40 blocks (~250 chars each)
  // plus one 200-point ink stroke. Target range matches a medium-length note
  // with some sketching.
  const blocks: SpatialCanvasDocument['blocks'] = [];
  const chunk =
    'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! Sphinx of black quartz, judge my vow. ';
  for (let i = 0; i < 40; i++) {
    blocks.push({
      id: `blk-${i}`,
      type: 'text',
      yPosition: i * 40,
      height: 24,
      content: chunk + `paragraph ${i}.`,
    });
  }

  const points = [];
  for (let i = 0; i < 200; i++) {
    points.push({
      x: 10 + i,
      y: 20 + i * 2,
      pressure: 0.5 + (i % 10) / 20,
      tilt: i % 45,
      timestamp: 1_700_000_000_000 + i,
    });
  }

  return {
    version: 2,
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    blocks,
    inkStrokes: [
      { id: 'stroke-1', color: '#FFFFFF', width: 2, opacity: 1, points },
    ],
    assets: { entries: [] },
  };
}

describe('graphite ZIP performance', () => {
  it('serializes then deserializes a 10KB document in under 50ms average', async () => {
    const doc = build10KbDocument();

    // Warm-up to JIT-stabilize.
    for (let i = 0; i < 5; i++) {
      const bytes = await serializeToGraphite(doc);
      await deserializeFromGraphite(bytes);
    }

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const bytes = await serializeToGraphite(doc);
      await deserializeFromGraphite(bytes);
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;

    const bytes = await serializeToGraphite(doc);
    console.log(
      `[perf] doc blocks=${doc.blocks.length} strokes=${doc.inkStrokes.length} ` +
        `zipBytes=${bytes.byteLength} ` +
        `serialize+deserialize avg=${avgMs.toFixed(3)}ms total=${totalMs.toFixed(1)}ms over ${iterations} iterations`,
    );

    expect(avgMs).toBeLessThan(50);
  });

  it('reports uncompressed-vs-compressed size for a 10KB document', async () => {
    const doc = build10KbDocument();
    const uncompressedBytes =
      JSON.stringify(doc).length + JSON.stringify(doc.inkStrokes).length;
    const compressed = await serializeToGraphite(doc);
    console.log(
      `[perf] uncompressedJSON=${uncompressedBytes}B zip=${compressed.byteLength}B ratio=${(
        compressed.byteLength / uncompressedBytes
      ).toFixed(3)}`,
    );
    expect(compressed.byteLength).toBeGreaterThan(0);
  });
});
