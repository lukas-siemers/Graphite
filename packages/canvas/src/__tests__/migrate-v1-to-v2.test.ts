import { describe, it, expect } from 'vitest';
import type { CanvasDocument } from '@graphite/db';
import { migrateCanvasDocumentToSpatial } from '../migrate-v1-to-v2';

function makeV1(body: string, strokes: CanvasDocument['inkLayer']['strokes'] = []): CanvasDocument {
  return {
    version: 1,
    textContent: { body },
    inkLayer: { strokes, pkDrawingBase64: null },
  };
}

describe('migrateCanvasDocumentToSpatial', () => {
  it('chunks the body into blocks on blank-line boundaries', () => {
    const v1 = makeV1('alpha\n\nbeta\n\ngamma');
    const out = migrateCanvasDocumentToSpatial(v1);
    expect(out.version).toBe(2);
    expect(out.blocks.map((b) => b.content)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('assigns monotonically-increasing Y positions', () => {
    const v1 = makeV1('one\n\ntwo\n\nthree');
    const out = migrateCanvasDocumentToSpatial(v1);
    const ys = out.blocks.map((b) => b.yPosition);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });

  it('preserves every line of text content', () => {
    const body = '# Heading\n\npara one\n\npara two\nline two';
    const v1 = makeV1(body);
    const out = migrateCanvasDocumentToSpatial(v1);
    const joined = out.blocks.map((b) => b.content).join('\n');
    for (const line of body.split('\n').filter((l) => l.trim() !== '')) {
      expect(joined).toContain(line);
    }
  });

  it('carries over ink strokes unchanged', () => {
    const v1 = makeV1('hello', [
      {
        id: 's1',
        color: '#FFFFFF',
        width: 2,
        opacity: 1,
        points: [{ x: 1, y: 2, pressure: 0.5, tilt: 0, timestamp: 10 }],
      },
    ]);
    const out = migrateCanvasDocumentToSpatial(v1);
    expect(out.inkStrokes).toHaveLength(1);
    expect(out.inkStrokes[0].id).toBe('s1');
    expect(out.inkStrokes[0].points[0]).toMatchObject({ x: 1, y: 2, pressure: 0.5 });
  });

  it('handles an empty canvas', () => {
    const v1 = makeV1('');
    const out = migrateCanvasDocumentToSpatial(v1);
    expect(out.blocks).toEqual([]);
    expect(out.inkStrokes).toEqual([]);
    expect(out.canvasWidth).toBe(816);
  });

  it('defaults canvasWidth to 816', () => {
    const out = migrateCanvasDocumentToSpatial(makeV1('x'));
    expect(out.canvasWidth).toBe(816);
  });

  it('produces text-type blocks', () => {
    const out = migrateCanvasDocumentToSpatial(makeV1('a\n\nb'));
    expect(out.blocks.every((b) => b.type === 'text')).toBe(true);
  });

  it('produces one block per paragraph in a typical note', () => {
    const body = 'para1\n\npara2\n\npara3\n\npara4';
    const out = migrateCanvasDocumentToSpatial(makeV1(body));
    expect(out.blocks).toHaveLength(4);
  });
});
