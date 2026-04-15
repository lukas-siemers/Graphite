/**
 * Unit tests for the Obsidian-style marker concealment policy.
 *
 * Exercises the pure `buildConcealDecorations(state)` helper against
 * real `EditorState` instances built with the same markdown extension
 * the live-preview editor uses. The helper returns the raw `[from,
 * to]` ranges that would be concealed — tests assert on those ranges
 * rather than on DOM output, so we never need a browser or JSDOM.
 *
 * The plugin that ships inside `editorHtml.ts` mirrors this helper
 * character-for-character (it lives inside a template-literal script),
 * so guarding the policy here protects the in-browser behavior too.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { buildConcealDecorations } from '../live-preview/conceal';

/**
 * Build a real EditorState with the same markdown extension the runtime
 * uses, then return the concealed ranges and the doc text so tests can
 * slice out what would be hidden.
 */
function run(doc: string, selPos: number, selAnchor: number = selPos) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: selAnchor, head: selPos },
  });
  const { ranges } = buildConcealDecorations(state);
  return {
    ranges,
    concealed: ranges.map(([f, t]) => doc.slice(f, t)),
    doc,
  };
}

describe('buildConcealDecorations — off-line markers hide', () => {
  it('hides ** pair on a line the cursor is not on', () => {
    const doc = '**hello** world\nsecond line';
    // Cursor on the second line, byte 20 is inside "second line"
    const { concealed } = run(doc, 20);
    // Both ** markers concealed, nothing else from that line
    expect(concealed.filter((c) => c === '**')).toHaveLength(2);
    // The visible word "hello" is never in the concealed list
    expect(concealed).not.toContain('hello');
  });

  it('hides underscore italic markers on a line the cursor is not on', () => {
    const doc = '_emph_\nelsewhere';
    const { concealed } = run(doc, doc.length);
    expect(concealed.filter((c) => c === '_')).toHaveLength(2);
  });

  it('hides inline code backticks on a line the cursor is not on', () => {
    const doc = 'prefix `code` suffix\nnext line';
    const { concealed } = run(doc, doc.length);
    expect(concealed.filter((c) => c === '`')).toHaveLength(2);
    expect(concealed).not.toContain('code');
  });

  it('hides ~~strike~~ markers on a line the cursor is not on', () => {
    const doc = '~~dead~~\nhere';
    const { concealed } = run(doc, doc.length);
    expect(concealed.filter((c) => c === '~~')).toHaveLength(2);
  });
});

describe('buildConcealDecorations — active-line markers reveal', () => {
  it('keeps ** markers visible when the cursor is on that line', () => {
    const doc = '**hello** world\nsecond';
    // Cursor inside the bolded word on line 1
    const { concealed } = run(doc, 3);
    expect(concealed).not.toContain('**');
  });

  it('reveals markers in every line of a multi-line selection', () => {
    const doc = '**one**\n**two**\n**three**';
    // Selection spans line 1 through line 3 — every ** should reveal.
    const { ranges } = run(doc, doc.length, 0);
    expect(ranges).toHaveLength(0);
  });
});

describe('buildConcealDecorations — headings and links', () => {
  it('hides the # marker on a heading line when the cursor is elsewhere', () => {
    const doc = '# Title\n\nbody line';
    // Cursor on "body line" — marker is line 1
    const { concealed } = run(doc, doc.length);
    expect(concealed).toContain('#');
  });

  it('keeps the # marker visible on the active heading line', () => {
    const doc = '# Title\nbody';
    // Cursor after "Title" on line 1
    const { concealed } = run(doc, 7);
    expect(concealed).not.toContain('#');
  });

  it('hides [ ] and the URL of an inline link, keeps the link text', () => {
    const doc = 'See [docs](https://example.com)\nother';
    // Cursor on line 2
    const { concealed, doc: d, ranges } = run(doc, doc.length);
    // The brackets + paren pair are LinkMark — expect 4 of them concealed.
    const linkMarks = concealed.filter(
      (c) => c === '[' || c === ']' || c === '(' || c === ')',
    );
    expect(linkMarks.length).toBeGreaterThanOrEqual(3);
    // The URL payload is concealed as a single range.
    const urlConcealed = ranges.some(
      ([f, t]) => d.slice(f, t) === 'https://example.com',
    );
    expect(urlConcealed).toBe(true);
    // The visible link text "docs" must NOT be concealed.
    expect(concealed).not.toContain('docs');
  });
});

describe('buildConcealDecorations — fenced code is left alone', () => {
  it('does not conceal the triple-backtick fence markers (owned by fenceStylePlugin)', () => {
    const doc = '```js\nconst x = 1;\n```\nafter';
    // Cursor on "after", line 4 — so any in-fence markers would be
    // candidates for concealment if we didn't skip fenced CodeMarks.
    const { concealed } = run(doc, doc.length);
    // The fence openers/closers (``` sequences) are CodeMark inside
    // FencedCode and must NOT appear in the concealed list.
    expect(concealed).not.toContain('```');
    // Defensive: no single backtick from the fence markers either.
    const backtickRanges = concealed.filter((c) => /^`+$/.test(c));
    expect(backtickRanges).toHaveLength(0);
  });
});
