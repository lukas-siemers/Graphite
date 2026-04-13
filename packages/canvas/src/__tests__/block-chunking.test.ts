import { describe, it, expect } from 'vitest';
import {
  assignYPositions,
  chunksFromMarkdown,
  markdownFromChunks,
  shiftBlocksBelow,
} from '../block-chunking';

describe('chunksFromMarkdown', () => {
  it('returns empty array for empty input', () => {
    expect(chunksFromMarkdown('')).toEqual([]);
  });

  it('splits on blank lines', () => {
    const md = 'alpha\n\nbeta\n\ngamma';
    const chunks = chunksFromMarkdown(md);
    expect(chunks.map((c) => c.content)).toEqual(['alpha', 'beta', 'gamma']);
    expect(chunks.every((c) => c.id.length > 0)).toBe(true);
  });

  it('keeps multi-line paragraphs together', () => {
    const md = 'line one\nline two\nline three\n\nnext paragraph';
    const chunks = chunksFromMarkdown(md);
    expect(chunks.map((c) => c.content)).toEqual([
      'line one\nline two\nline three',
      'next paragraph',
    ]);
  });

  it('starts a new chunk on headings', () => {
    const md = 'intro paragraph\n# Big Heading\nmore body';
    const chunks = chunksFromMarkdown(md);
    expect(chunks.map((c) => c.content)).toEqual([
      'intro paragraph',
      '# Big Heading',
      'more body',
    ]);
  });

  it('treats ### headings as block boundaries', () => {
    const md = 'alpha\n### Section\nbeta';
    expect(chunksFromMarkdown(md).map((c) => c.content)).toEqual([
      'alpha',
      '### Section',
      'beta',
    ]);
  });

  it('never splits a fenced code block', () => {
    const md = 'intro\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\ntail';
    const chunks = chunksFromMarkdown(md);
    expect(chunks.map((c) => c.content)).toEqual([
      'intro',
      '```js\nconst x = 1;\n\nconst y = 2;\n```',
      'tail',
    ]);
  });

  it('handles tilde fences', () => {
    const md = '~~~\nraw\n\nraw\n~~~';
    const chunks = chunksFromMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('~~~\nraw\n\nraw\n~~~');
  });

  it('does not consider heading-like text inside fences as boundaries', () => {
    const md = '```\n# not a heading\n```';
    const chunks = chunksFromMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('```\n# not a heading\n```');
  });

  it('round-trips normalized markdown losslessly', () => {
    const md = 'one\n\ntwo\n\n# three\n\nfour';
    const chunks = chunksFromMarkdown(md);
    expect(markdownFromChunks(chunks)).toBe(md);
  });
});

describe('assignYPositions', () => {
  it('stacks blocks with gaps based on line count', () => {
    const chunks = [
      { id: 'a', content: 'one line' },
      { id: 'b', content: 'two\nlines' },
      { id: 'c', content: 'three\nseparate\nlines' },
    ];
    const blocks = assignYPositions(chunks, 24, 16);
    expect(blocks[0]).toMatchObject({ id: 'a', yPosition: 0, height: 24 });
    expect(blocks[1]).toMatchObject({ id: 'b', yPosition: 24 + 16, height: 48 });
    expect(blocks[2]).toMatchObject({
      id: 'c',
      yPosition: 24 + 16 + 48 + 16,
      height: 72,
    });
  });

  it('marks every block as text type by default', () => {
    const blocks = assignYPositions(
      [{ id: 'a', content: 'x' }],
      20,
      8,
    );
    expect(blocks[0].type).toBe('text');
  });

  it('returns empty array for empty input', () => {
    expect(assignYPositions([], 24, 16)).toEqual([]);
  });
});

describe('shiftBlocksBelow', () => {
  const blocks = [
    { id: 'a', type: 'text' as const, yPosition: 0, height: 24, content: 'a' },
    { id: 'b', type: 'text' as const, yPosition: 40, height: 24, content: 'b' },
    { id: 'c', type: 'text' as const, yPosition: 80, height: 24, content: 'c' },
  ];

  it('shifts only blocks at or below the insertion point', () => {
    const shifted = shiftBlocksBelow(blocks, 40, 100);
    expect(shifted.map((b) => b.yPosition)).toEqual([0, 140, 180]);
  });

  it('leaves all blocks untouched when insertion is past the last', () => {
    const shifted = shiftBlocksBelow(blocks, 1000, 50);
    expect(shifted.map((b) => b.yPosition)).toEqual([0, 40, 80]);
  });

  it('handles negative delta', () => {
    const shifted = shiftBlocksBelow(blocks, 40, -20);
    expect(shifted.map((b) => b.yPosition)).toEqual([0, 20, 60]);
  });

  it('does not mutate the input', () => {
    shiftBlocksBelow(blocks, 40, 100);
    expect(blocks.map((b) => b.yPosition)).toEqual([0, 40, 80]);
  });
});
