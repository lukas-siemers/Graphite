import { describe, it, expect } from 'vitest';
import {
  canvasDocumentSchema,
  emptyCanvasDocument,
  parseCanvasDocument,
  serializeCanvasDocument,
  type CanvasDocument,
} from '../canvas-schema';

describe('canvas-schema v1', () => {
  it('round-trips the empty document', () => {
    const doc = emptyCanvasDocument();
    const json = serializeCanvasDocument(doc);
    const reparsed = parseCanvasDocument(json);
    expect(reparsed).toEqual(doc);
  });

  it('round-trips a populated document with an absolute-anchored stroke and a text content object', () => {
    const doc: CanvasDocument = {
      version: 1,
      inkLayer: {
        strokes: [
          {
            id: 'stroke-abc',
            color: '#FFFFFF',
            width: 2,
            tool: 'pen',
            anchor: { type: 'absolute', x: 100, y: 200 },
            points: [
              { x: 0, y: 0, pressure: 0.5, timeOffset: 0 },
              {
                x: 10,
                y: 12,
                pressure: 0.8,
                timeOffset: 16,
                azimuth: 1.2,
                altitude: 0.7,
              },
            ],
          },
        ],
      },
      contentLayer: {
        objects: [
          {
            type: 'text',
            id: 'text-1',
            x: 50,
            y: 60,
            width: 680,
            body: 'hello world',
          },
        ],
      },
      textContent: { body: '# Heading\n\nBody text.' },
    };

    const json = serializeCanvasDocument(doc);
    const reparsed = parseCanvasDocument(json);
    expect(reparsed).toEqual(doc);
  });

  it('rejects a stroke whose anchor.type is unknown', () => {
    const bad = {
      version: 1,
      inkLayer: {
        strokes: [
          {
            id: 's1',
            color: '#000000',
            width: 1,
            tool: 'pen',
            anchor: { type: 'unknown', x: 0, y: 0 },
            points: [],
          },
        ],
      },
      contentLayer: { objects: [] },
      textContent: { body: '' },
    };
    expect(() => canvasDocumentSchema.parse(bad)).toThrow();
  });

  it('parseCanvasDocument(null) returns the empty default without throwing', () => {
    const doc = parseCanvasDocument(null);
    expect(doc).toEqual(emptyCanvasDocument());
  });

  it('parseCanvasDocument(undefined) and empty string also return the empty default', () => {
    expect(parseCanvasDocument(undefined)).toEqual(emptyCanvasDocument());
    expect(parseCanvasDocument('')).toEqual(emptyCanvasDocument());
  });

  it('rejects documents with version !== 1 (future migration hook)', () => {
    const futureDoc = {
      version: 2,
      inkLayer: { strokes: [] },
      contentLayer: { objects: [] },
      textContent: { body: '' },
    };
    expect(() => canvasDocumentSchema.parse(futureDoc)).toThrow();
  });

  it('parses a stroke without pkDrawingBase64 (desktop-authored case)', () => {
    const desktopStroke = {
      version: 1,
      inkLayer: {
        strokes: [
          {
            id: 'desktop-stroke',
            color: '#F28500',
            width: 3,
            tool: 'marker',
            anchor: { type: 'absolute', x: 0, y: 0 },
            points: [{ x: 0, y: 0, pressure: 1, timeOffset: 0 }],
            // no pkDrawingBase64
          },
        ],
      },
      contentLayer: { objects: [] },
      textContent: { body: '' },
    };
    const parsed = canvasDocumentSchema.parse(desktopStroke);
    expect(parsed.inkLayer.strokes[0].pkDrawingBase64).toBeUndefined();
  });

  it('parses a stroke WITH pkDrawingBase64 (iPad round-trip case)', () => {
    const ipadStroke = {
      version: 1,
      inkLayer: {
        strokes: [
          {
            id: 'ipad-stroke',
            color: '#FFFFFF',
            width: 2,
            tool: 'pencil',
            anchor: { type: 'absolute', x: 0, y: 0 },
            points: [{ x: 0, y: 0, pressure: 1, timeOffset: 0 }],
            pkDrawingBase64: 'BASE64BLOB==',
          },
        ],
      },
      contentLayer: { objects: [] },
      textContent: { body: '' },
    };
    const parsed = canvasDocumentSchema.parse(ipadStroke);
    expect(parsed.inkLayer.strokes[0].pkDrawingBase64).toBe('BASE64BLOB==');
  });

  it('accepts a paragraph-anchored stroke (reserved variant, not yet emitted by v1.5)', () => {
    const paragraphAnchored = {
      version: 1,
      inkLayer: {
        strokes: [
          {
            id: 'para-stroke',
            color: '#DCDDDE',
            width: 1,
            tool: 'highlighter',
            anchor: {
              type: 'paragraph',
              paragraphId: 'p-42',
              offsetX: 12,
              offsetY: 4,
            },
            points: [{ x: 0, y: 0, pressure: 0.3, timeOffset: 0 }],
          },
        ],
      },
      contentLayer: { objects: [] },
      textContent: { body: '' },
    };
    const parsed = canvasDocumentSchema.parse(paragraphAnchored);
    expect(parsed.inkLayer.strokes[0].anchor.type).toBe('paragraph');
  });

  it('parses a code content object in the content layer', () => {
    const withCode = {
      version: 1,
      inkLayer: { strokes: [] },
      contentLayer: {
        objects: [
          {
            type: 'code',
            id: 'code-1',
            x: 0,
            y: 0,
            width: 680,
            language: 'typescript',
            body: 'const x = 1;',
          },
        ],
      },
      textContent: { body: '' },
    };
    const parsed = canvasDocumentSchema.parse(withCode);
    expect(parsed.contentLayer.objects[0]).toMatchObject({
      type: 'code',
      language: 'typescript',
    });
  });

  it('serializeCanvasDocument re-validates and throws on malformed input', () => {
    const malformed = {
      version: 1,
      inkLayer: { strokes: [] },
      contentLayer: { objects: [] },
      // missing textContent
    } as unknown as CanvasDocument;
    expect(() => serializeCanvasDocument(malformed)).toThrow();
  });

  it('accepts a top-level inkLayer.pkDrawingBase64 for iPad dual-write (Stage 2)', () => {
    // Stage 2 (PencilKit extractor) dual-writes the opaque PKDrawing blob at
    // the ink layer root alongside the structured `strokes[]`. iPad re-opens
    // a note by feeding the blob back to PencilKit; desktop renders from the
    // strokes. Both must coexist in the same document without validation
    // failure.
    const doc = {
      version: 1,
      inkLayer: {
        strokes: [
          {
            id: 'pk-roundtrip',
            color: '#FFFFFF',
            width: 2,
            tool: 'pen',
            anchor: { type: 'absolute', x: 0, y: 0 },
            points: [{ x: 0, y: 0, pressure: 0.9, timeOffset: 0 }],
          },
        ],
        pkDrawingBase64: 'OPAQUE-PKDRAWING-BLOB==',
      },
      contentLayer: { objects: [] },
      textContent: { body: '' },
    };

    const parsed = canvasDocumentSchema.parse(doc);
    expect(parsed.inkLayer.pkDrawingBase64).toBe('OPAQUE-PKDRAWING-BLOB==');
    expect(parsed.inkLayer.strokes).toHaveLength(1);
  });

  it('treats inkLayer.pkDrawingBase64 as optional (desktop-authored documents omit it)', () => {
    const doc = {
      version: 1,
      inkLayer: {
        strokes: [
          {
            id: 'desktop-stroke',
            color: '#DCDDDE',
            width: 1,
            tool: 'marker',
            anchor: { type: 'absolute', x: 0, y: 0 },
            points: [{ x: 0, y: 0, pressure: 1, timeOffset: 0 }],
          },
        ],
        // no top-level pkDrawingBase64 — desktop doesn't produce one
      },
      contentLayer: { objects: [] },
      textContent: { body: '' },
    };
    const parsed = canvasDocumentSchema.parse(doc);
    expect(parsed.inkLayer.pkDrawingBase64).toBeUndefined();
  });
});
