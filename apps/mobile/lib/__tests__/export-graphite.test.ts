import { describe, it, expect } from 'vitest';
import {
  deserializeFromGraphite,
  serializeToGraphite,
  createEmptySpatialCanvas,
} from '@graphite/canvas';
import { buildGraphiteExport } from '../export-graphite-utils';
import { buildExportAsync } from '../export-markdown-utils';

describe('buildGraphiteExport', () => {
  it('reuses the stored blob verbatim for v2 notes', async () => {
    const spatial = createEmptySpatialCanvas();
    spatial.blocks = [
      { id: 'b1', type: 'text', yPosition: 0, height: 24, content: '# Hello' },
      { id: 'b2', type: 'text', yPosition: 40, height: 24, content: 'World' },
    ];
    const blob = await serializeToGraphite(spatial);

    const { filename, bytes } = await buildGraphiteExport({
      id: 'n1',
      title: 'My Note',
      body: '',
      canvasJson: null,
      graphiteBlob: blob,
      canvasVersion: 2,
    });

    expect(filename).toBe('my-note.graphite');
    // Same bytes — no re-serialization for v2 notes with an existing blob.
    expect(bytes).toBe(blob);
  });

  it('migrates a v1 note on the fly and produces a valid .graphite archive', async () => {
    const { filename, bytes } = await buildGraphiteExport({
      id: 'n2',
      title: 'Legacy',
      body: '# Title\n\nParagraph one.\n\nParagraph two.',
      canvasJson: null,
      graphiteBlob: null,
      canvasVersion: 1,
    });

    expect(filename).toBe('legacy.graphite');
    const doc = await deserializeFromGraphite(bytes);
    expect(doc.version).toBe(2);
    // Three chunks: heading + two paragraphs.
    expect(doc.blocks).toHaveLength(3);
    expect(doc.blocks[0].content).toBe('# Title');
    expect(doc.blocks[1].content).toBe('Paragraph one.');
    expect(doc.blocks[2].content).toBe('Paragraph two.');
  });

  it('falls back to the body text when canvasJson is malformed', async () => {
    const { bytes } = await buildGraphiteExport({
      id: 'n3',
      title: 'Broken',
      body: 'fallback body',
      canvasJson: '{not valid json',
      graphiteBlob: null,
      canvasVersion: 1,
    });
    const doc = await deserializeFromGraphite(bytes);
    expect(doc.blocks.map((b) => b.content).join('\n')).toBe('fallback body');
  });
});

describe('buildExportAsync — v2 markdown export path', () => {
  it('joins text blocks via markdownFromChunks for v2 notes', async () => {
    const spatial = createEmptySpatialCanvas();
    spatial.blocks = [
      { id: 'b1', type: 'text', yPosition: 0, height: 24, content: '# Heading' },
      { id: 'b2', type: 'text', yPosition: 40, height: 24, content: 'Body line.' },
    ];
    const blob = await serializeToGraphite(spatial);

    const payload = await buildExportAsync({
      id: 'n1',
      title: 'Round Trip',
      body: 'LEGACY BODY — must not be used',
      canvasVersion: 2,
      graphiteBlob: blob,
    });

    expect(payload.filename).toBe('round-trip.md');
    // Title heading + two blocks joined with blank lines.
    expect(payload.content).toBe('# Round Trip\n\n# Heading\n\nBody line.\n');
  });

  it('falls through to the synchronous path for v1 notes', async () => {
    const payload = await buildExportAsync({
      id: 'n2',
      title: 'V1 Note',
      body: 'hello world',
      canvasVersion: 1,
      graphiteBlob: null,
    });
    expect(payload.content).toBe('# V1 Note\n\nhello world\n');
  });
});
