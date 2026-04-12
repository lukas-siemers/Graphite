// Canvas document schema (v1) — source of truth for every notes.canvas_json row.
//
// This schema is consumed by:
//   - iPad: Skia ink overlay + PencilKit stroke extractor
//   - Desktop: SVG ink renderer
//
// Design notes:
//   - version is pinned to literal 1 so future reshapes branch cleanly in parsers.
//   - StrokeAnchor is a discriminated union from day one (per
//     project_stroke_anchor_schema). v1.5 emits only "absolute", but the
//     "paragraph" branch is reserved so we never need a data migration just to
//     introduce paragraph-anchored strokes.
//   - pkDrawingBase64 is optional on strokes: iPad-authored strokes carry the
//     blob for PencilKit round-trip fidelity; desktop-authored strokes don't.
//   - ContentObject is a discriminated union (text | code). Images (Phase 4)
//     and wikilinks (Phase 5) extend the union when they arrive. Do NOT add
//     placeholder variants in v1.

import { z } from 'zod';

// -------- Ink layer --------

export const strokePointSchema = z.object({
  x: z.number(),
  y: z.number(),
  pressure: z.number(),      // 0..1, normalized from PKStrokePoint.force
  timeOffset: z.number(),    // ms since stroke start
  azimuth: z.number().optional(),   // radians (iOS-only source)
  altitude: z.number().optional(),  // radians (iOS-only source)
});

export const strokeToolSchema = z.enum([
  'pen',
  'pencil',
  'marker',
  'highlighter',
  'eraser',
]);

export const strokeAnchorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('absolute'),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('paragraph'),
    paragraphId: z.string(),
    offsetX: z.number(),
    offsetY: z.number(),
  }),
]);

export const inkStrokeSchema = z.object({
  id: z.string(),
  points: z.array(strokePointSchema),
  color: z.string(),         // hex e.g. "#FFFFFF"
  width: z.number(),         // base stroke width in canvas units
  tool: strokeToolSchema,
  anchor: strokeAnchorSchema,
  pkDrawingBase64: z.string().optional(),
});

export const inkLayerSchema = z.object({
  strokes: z.array(inkStrokeSchema),
  // Opaque PKDrawing.dataRepresentation() base64 blob emitted by
  // react-native-pencil-kit. Stored alongside `strokes[]` during the Stage 2
  // dual-write: iPad uses the blob for lossless PencilKit re-edit fidelity,
  // desktop uses `strokes[]` for cross-platform rendering.
  pkDrawingBase64: z.string().optional(),
});

// -------- Content layer --------

const textObjectSchema = z.object({
  type: z.literal('text'),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  body: z.string(),
});

const codeObjectSchema = z.object({
  type: z.literal('code'),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  language: z.string(),
  body: z.string(),
});

export const contentObjectSchema = z.discriminatedUnion('type', [
  textObjectSchema,
  codeObjectSchema,
]);

export const contentLayerSchema = z.object({
  objects: z.array(contentObjectSchema),
});

// -------- Text content (flowing column) --------

export const textContentSchema = z.object({
  body: z.string(),
});

// -------- Canvas document root --------

export const canvasDocumentSchema = z.object({
  version: z.literal(1),
  inkLayer: inkLayerSchema,
  contentLayer: contentLayerSchema,
  textContent: textContentSchema,
});

// -------- Inferred TS types --------

export type StrokePoint = z.infer<typeof strokePointSchema>;
export type StrokeTool = z.infer<typeof strokeToolSchema>;
export type StrokeAnchor = z.infer<typeof strokeAnchorSchema>;
export type InkStroke = z.infer<typeof inkStrokeSchema>;
export type InkLayer = z.infer<typeof inkLayerSchema>;
export type ContentObject = z.infer<typeof contentObjectSchema>;
export type ContentLayer = z.infer<typeof contentLayerSchema>;
export type TextContent = z.infer<typeof textContentSchema>;
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;

// -------- Helpers --------

/**
 * Default empty canvas document. Used for new notes and legacy null rows.
 */
export function emptyCanvasDocument(): CanvasDocument {
  return {
    version: 1,
    inkLayer: { strokes: [] },
    contentLayer: { objects: [] },
    textContent: { body: '' },
  };
}

/**
 * Parse a raw canvas_json value. Handles legacy null / empty string by
 * returning an empty default — does NOT throw.
 *
 * Anything else is passed to Zod. Invalid payloads throw ZodError so callers
 * can decide whether to fall back or surface the error.
 */
export function parseCanvasDocument(raw: unknown): CanvasDocument {
  if (raw === null || raw === undefined || raw === '') {
    return emptyCanvasDocument();
  }
  const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return canvasDocumentSchema.parse(input);
}

/**
 * Serialize a canvas document to a JSON string suitable for writing into
 * notes.canvas_json. Re-validates on the way out so we never persist malformed
 * documents.
 */
export function serializeCanvasDocument(doc: CanvasDocument): string {
  const validated = canvasDocumentSchema.parse(doc);
  return JSON.stringify(validated);
}
