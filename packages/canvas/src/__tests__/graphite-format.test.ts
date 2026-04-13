import { describe, it, expect } from 'vitest';
import { unzip } from 'fflate';
import {
  deserializeFromGraphite,
  extractSearchableText,
  serializeToGraphite,
} from '../graphite-format';
import {
  createEmptySpatialCanvas,
  type SpatialCanvasDocument,
  type SpatialInkStroke,
} from '../spatial-types';

function listZipEntries(data: Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => {
      if (err) reject(err);
      else resolve(Object.keys(files).sort());
    });
  });
}

function makeDoc(): SpatialCanvasDocument {
  return {
    version: 2,
    canvasWidth: 816,
    blocks: [
      { id: 'blk-1', type: 'text', yPosition: 0, height: 24, content: '# Heading' },
      { id: 'blk-2', type: 'text', yPosition: 60, height: 48, content: 'para one\npara two' },
    ],
    inkStrokes: [
      {
        id: 'stroke-1',
        color: '#FFFFFF',
        width: 2,
        opacity: 1,
        points: [
          { x: 10, y: 100, pressure: 0.5, tilt: 0, timestamp: 1 },
          { x: 20, y: 110, pressure: 0.7, tilt: 5, timestamp: 2 },
        ],
      },
    ],
    assets: { entries: [] },
  };
}

describe('serializeToGraphite / deserializeFromGraphite', () => {
  it('writes the expected file layout', async () => {
    const blob = await serializeToGraphite(makeDoc());
    const entries = await listZipEntries(blob);
    expect(entries).toEqual(['content.md', 'ink.json', 'manifest.json']);
  });

  it('round-trips a text + ink document', async () => {
    const doc = makeDoc();
    const blob = await serializeToGraphite(doc);
    const out = await deserializeFromGraphite(blob);

    expect(out.version).toBe(2);
    expect(out.canvasWidth).toBe(doc.canvasWidth);

    expect(out.blocks).toHaveLength(doc.blocks.length);
    for (let i = 0; i < doc.blocks.length; i++) {
      expect(out.blocks[i].id).toBe(doc.blocks[i].id);
      expect(out.blocks[i].yPosition).toBe(doc.blocks[i].yPosition);
      expect(out.blocks[i].content).toBe(doc.blocks[i].content);
    }

    expect(out.inkStrokes).toEqual(doc.inkStrokes);
  });

  it('round-trips an empty document', async () => {
    const doc = createEmptySpatialCanvas();
    const blob = await serializeToGraphite(doc);
    const out = await deserializeFromGraphite(blob);
    expect(out.blocks).toEqual([]);
    expect(out.inkStrokes).toEqual([]);
    expect(out.canvasWidth).toBe(doc.canvasWidth);
  });

  it('round-trips an ink-only document', async () => {
    const stroke: SpatialInkStroke = {
      id: 'only',
      color: '#F28500',
      width: 3,
      opacity: 0.8,
      points: [{ x: 1, y: 2, pressure: 0.3, tilt: 1, timestamp: 0 }],
    };
    const doc: SpatialCanvasDocument = {
      ...createEmptySpatialCanvas(),
      inkStrokes: [stroke],
    };
    const out = await deserializeFromGraphite(await serializeToGraphite(doc));
    expect(out.blocks).toEqual([]);
    expect(out.inkStrokes).toEqual([stroke]);
  });

  it('round-trips a text-only document', async () => {
    const doc: SpatialCanvasDocument = {
      ...createEmptySpatialCanvas(),
      blocks: [
        { id: 'x', type: 'text', yPosition: 0, height: 24, content: 'hello' },
        { id: 'y', type: 'text', yPosition: 40, height: 24, content: 'world' },
      ],
    };
    const out = await deserializeFromGraphite(await serializeToGraphite(doc));
    expect(out.blocks.map((b) => b.content)).toEqual(['hello', 'world']);
    expect(out.blocks.map((b) => b.id)).toEqual(['x', 'y']);
    expect(out.blocks.map((b) => b.yPosition)).toEqual([0, 40]);
  });

  it('round-trips content containing blank lines inside a block', async () => {
    // Fenced code blocks can contain blank lines — the delimiter-parser must
    // not treat them as block separators.
    const doc: SpatialCanvasDocument = {
      ...createEmptySpatialCanvas(),
      blocks: [
        {
          id: 'fence',
          type: 'text',
          yPosition: 0,
          height: 24 * 5,
          content: '```js\nconst a = 1;\n\nconst b = 2;\n```',
        },
      ],
    };
    const out = await deserializeFromGraphite(await serializeToGraphite(doc));
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0].content).toBe(
      '```js\nconst a = 1;\n\nconst b = 2;\n```',
    );
  });
});

describe('extractSearchableText', () => {
  it('concatenates text-block content with newlines', () => {
    const doc: SpatialCanvasDocument = {
      ...createEmptySpatialCanvas(),
      blocks: [
        { id: 'a', type: 'text', yPosition: 0, height: 24, content: 'alpha' },
        { id: 'b', type: 'text', yPosition: 40, height: 24, content: 'beta' },
      ],
    };
    expect(extractSearchableText(doc)).toBe('alpha\nbeta');
  });

  it('ignores non-text blocks', () => {
    const doc: SpatialCanvasDocument = {
      ...createEmptySpatialCanvas(),
      blocks: [
        { id: 'a', type: 'text', yPosition: 0, height: 24, content: 'keep' },
        { id: 'b', type: 'image', yPosition: 40, height: 120, content: 'asset:img-1' },
      ],
    };
    expect(extractSearchableText(doc)).toBe('keep');
  });

  it('returns empty string for empty doc', () => {
    expect(extractSearchableText(createEmptySpatialCanvas())).toBe('');
  });
});
