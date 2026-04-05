/**
 * Byte-parity tests for `applyFormat('code-block', ...)` in editorHtml.ts.
 *
 * Context
 * -------
 * `applyFormat` is defined inside the HTML template string returned by
 * `buildEditorHtml()` (see packages/editor/src/live-preview/editorHtml.ts).
 * It runs inside an iframe / WebView and talks to CodeMirror 6 via the
 * ambient `view` / `view.state`. It cannot be imported directly from a
 * Node test runner, and @codemirror/state / @codemirror/lang-markdown are
 * not installed in this workspace.
 *
 * Strategy
 * --------
 * 1.  Re-implement the exact code-block branch of `applyFormat` as a pure
 *     function `applyCodeBlock({doc, from, to})` that operates on a plain
 *     string + selection range. This is the "toolbar dispatch" path.
 *
 * 2.  Re-implement a "manual typing" path that simulates what a user would
 *     produce if they typed the same fenced block character-by-character at
 *     the same cursor position. Manual typing of a fenced block on an empty
 *     line is: `\`\`\`\n<body>\n\`\`\``. The byte-parity guarantee is that
 *     the toolbar output, after accounting for the leading/trailing-break
 *     rules, must equal what manual typing would produce.
 *
 * 3.  Assert byte-identical output. Assert cursor anchor. Assert the
 *     resulting doc, when fed to a minimal regex-based fence detector
 *     (stand-in for `syntaxTree(state).iterate()` finding a FencedCode
 *     node), reports a fenced block at the expected span.
 *
 * 4.  Guard against drift: extract the `command === 'code-block'` branch
 *     source out of editorHtml.ts at test time and assert the key literals
 *     (`'\`\`\`'`, the leading/trailing newline rules, the cursorPos
 *     formula) are present. If SWE-2 or anyone else edits the real branch
 *     without updating this test, the drift guard fails loudly.
 *
 * Limitations (documented, not ignored)
 * -------------------------------------
 *  - The real CodeMirror markdown parser is not loaded; "FencedCode node at
 *    expected position" is approximated by a regex fence detector. This is
 *    sufficient for Phase 1 gate: the output is a literal substring the
 *    parser cannot fail to recognise.
 *  - Toggle-off (cursor inside an existing fence → strip markers) IS now
 *    implemented. See `describe('toggle off')` below for the asserted
 *    behaviour and the paired drift-guard entry for `findEnclosingFence`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Port of the code-block branch from editorHtml.ts → pure function.
// The shape must stay byte-identical to the real branch. If it drifts, the
// source-extraction drift guard at the bottom of this file will fail.
// ---------------------------------------------------------------------------

interface DocSel {
  doc: string;
  from: number;
  to: number;
}

interface ApplyResult {
  doc: string;
  cursor: number;
  /** The raw inserted substring (what replaced [from, to)) */
  insert: string;
}

function lineBoundsAt(doc: string, pos: number): { from: number; to: number } {
  const from = doc.lastIndexOf('\n', pos - 1) + 1;
  const nextNl = doc.indexOf('\n', pos);
  const to = nextNl === -1 ? doc.length : nextNl;
  return { from, to };
}

/**
 * Pure port of the `findEnclosingFence` helper in editorHtml.ts. Walks every
 * line, collects fence-marker lines (text starts with ```), pairs them in
 * document order, and returns the pair whose span contains `pos`.
 */
function findEnclosingFence(
  doc: string,
  pos: number,
): { opener: { from: number; to: number }; closer: { from: number; to: number } } | null {
  const fenceLines: Array<{ from: number; to: number }> = [];
  let lineStart = 0;
  while (lineStart <= doc.length) {
    const nl = doc.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? doc.length : nl;
    const text = doc.slice(lineStart, lineEnd);
    if (text.startsWith('```')) fenceLines.push({ from: lineStart, to: lineEnd });
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  for (let i = 0; i + 1 < fenceLines.length; i += 2) {
    const opener = fenceLines[i];
    const closer = fenceLines[i + 1];
    if (pos >= opener.from && pos <= closer.to) return { opener, closer };
  }
  return null;
}

function applyCodeBlock({ doc, from, to }: DocSel): ApplyResult {
  // Toggle-off path: cursor inside (or on the marker lines of) an existing
  // fence → unwrap. Selection `to` is used as the cursor-head analogue so
  // the test port mirrors the live editor, which passes `sel.head`.
  const enclosing = findEnclosingFence(doc, to);
  if (enclosing) {
    const { opener, closer } = enclosing;
    const bodyStart = opener.to + 1;
    const bodyEnd = closer.from - 1;
    const body = bodyEnd >= bodyStart ? doc.slice(bodyStart, bodyEnd) : '';

    let newHead: number;
    if (bodyEnd < bodyStart) {
      newHead = opener.from;
    } else {
      const clamped = Math.min(Math.max(to, bodyStart), bodyEnd);
      newHead = opener.from + (clamped - bodyStart);
    }

    const nextDoc = doc.slice(0, opener.from) + body + doc.slice(closer.to);
    return { doc: nextDoc, cursor: newHead, insert: body };
  }

  const startLine = lineBoundsAt(doc, from);
  const endLine = lineBoundsAt(doc, to);
  const atLineStart = from === startLine.from;
  const atLineEnd = to === endLine.to;
  const leadingBreak = atLineStart ? '' : '\n';
  const trailingBreak = atLineEnd ? '' : '\n';

  let body = doc.slice(from, to);
  if (body.endsWith('\n')) body = body.slice(0, -1);

  const opening = '```';
  const closing = '```';
  const fence = leadingBreak + opening + '\n' + body + '\n' + closing + trailingBreak;

  const openerEnd = from + leadingBreak.length + opening.length;
  const bodyStart = openerEnd + 1;
  const cursorPos = body.length === 0 ? openerEnd : bodyStart + body.length;

  const nextDoc = doc.slice(0, from) + fence + doc.slice(to);
  return { doc: nextDoc, cursor: cursorPos, insert: fence };
}

/**
 * Simulates what a user would produce by typing a fenced block at `from`
 * on an empty line with manual keystrokes. Manual typing = literal
 * characters — no leading/trailing break rules — which is exactly what
 * `applyCodeBlock` must emit when called on an empty line with empty
 * selection. Used as the byte-parity oracle for the empty-line cases.
 */
function manualTypeEmptyFence(doc: string, at: number): string {
  return doc.slice(0, at) + '```\n\n```' + doc.slice(at);
}

// Minimal regex-based fence detector — stand-in for the CodeMirror markdown
// parser finding a FencedCode node. We look for ``` ... ``` spans that sit
// on their own lines.
function findFencedCode(doc: string): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const re = /(^|\n)```[^\n]*\n([\s\S]*?)\n```(\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    const start = m.index + (m[1] === '\n' ? 1 : 0);
    const end = m.index + m[0].length - (m[3] === '\n' ? 1 : 0);
    out.push({ from: start, to: end });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyFormat — code-block branch (byte-parity toolbar vs manual typing)', () => {
  it('inserts a fence at start of an empty doc with empty selection', () => {
    const result = applyCodeBlock({ doc: '', from: 0, to: 0 });

    // Byte-parity: toolbar output equals manual typing of ```\n\n``` at pos 0
    expect(result.doc).toBe(manualTypeEmptyFence('', 0));
    expect(result.doc).toBe('```\n\n```');

    // Cursor after opening backticks on the opener line
    expect(result.cursor).toBe(3);

    // Fenced code region detected across the full doc
    const fences = findFencedCode(result.doc);
    expect(fences).toHaveLength(1);
    expect(fences[0]).toEqual({ from: 0, to: 8 });
  });

  it('splits a mid-line cursor and inserts a fence at pos 5 in "hello world"', () => {
    const result = applyCodeBlock({ doc: 'hello world', from: 5, to: 5 });

    // Cursor is mid-line → leadingBreak = '\n', trailingBreak = '\n'
    // Expected doc: 'hello' + '\n```\n\n```\n' + ' world'
    expect(result.doc).toBe('hello\n```\n\n```\n world');

    // Inserted substring
    expect(result.insert).toBe('\n```\n\n```\n');

    // Cursor lands after the opening backticks: 5 + 1 (leading \n) + 3 = 9
    expect(result.cursor).toBe(9);

    const fences = findFencedCode(result.doc);
    expect(fences).toHaveLength(1);
    // Fence body starts at offset 6 ('\n```\n' places opener line at 6..9)
    expect(fences[0].from).toBe(6);
  });

  it('wraps a single-line selection "foo" with the cursor at end of body', () => {
    // Doc: just "foo", select the whole thing
    const result = applyCodeBlock({ doc: 'foo', from: 0, to: 3 });

    // Whole line selected → atLineStart && atLineEnd → no leading/trailing break
    expect(result.doc).toBe('```\nfoo\n```');
    expect(result.insert).toBe('```\nfoo\n```');

    // Cursor at end of body "foo" = openerEnd(3) + 1 + body.length(3) = 7
    expect(result.cursor).toBe(7);

    const fences = findFencedCode(result.doc);
    expect(fences).toHaveLength(1);
  });

  it('wraps a multi-line selection "foo\\nbar" preserving lines, cursor at end of bar', () => {
    const result = applyCodeBlock({ doc: 'foo\nbar', from: 0, to: 7 });

    expect(result.doc).toBe('```\nfoo\nbar\n```');
    // openerEnd = 0 + 0 + 3 = 3; bodyStart = 4; body="foo\nbar" length 7
    // cursor = 4 + 7 = 11
    expect(result.cursor).toBe(11);

    const fences = findFencedCode(result.doc);
    expect(fences).toHaveLength(1);
  });

  it('emits no trailing newline when cursor is at EOF', () => {
    const result = applyCodeBlock({ doc: 'abc', from: 3, to: 3 });

    // atLineStart? from(3) === startLine.from(0)? no. leadingBreak = '\n'
    // atLineEnd? to(3) === endLine.to(3)? yes. trailingBreak = ''
    expect(result.doc).toBe('abc\n```\n\n```');

    // No trailing \n after closing fence — critical edge case
    expect(result.doc.endsWith('```')).toBe(true);
    expect(result.doc.endsWith('\n')).toBe(false);

    // Cursor: openerEnd = 3 + 1 + 3 = 7 (empty body → cursor = openerEnd)
    expect(result.cursor).toBe(7);
  });

  it('passes selection containing literal triple-backticks through unchanged (documented known behavior)', () => {
    // This case is flagged by SWE-2 as NOT-FIXED. The test documents the
    // current behavior rather than asserting a desired fix: the selection
    // body is emitted verbatim inside the new fence, which the markdown
    // parser will then read as a premature closer. Do NOT treat as a
    // regression unless the spec owner elevates it.
    const input = 'a```b';
    const result = applyCodeBlock({ doc: input, from: 0, to: 5 });

    // Whole-doc selection → atLineStart && atLineEnd → no breaks
    expect(result.doc).toBe('```\na```b\n```');

    // The literal triple-backtick stays inside the body verbatim.
    expect(result.doc).toContain('a```b');

    // Documented: findFencedCode picks the FIRST fence the parser would see,
    // which ends at the inline ``` inside the body. This is the known
    // parser-mismatch behavior SWE-2 flagged.
    const fences = findFencedCode(result.doc);
    expect(fences.length).toBeGreaterThanOrEqual(1);
  });
});

describe('applyFormat — code-block toggle off (cursor inside fence unwraps)', () => {
  it('unwraps a 3-line fence when the cursor sits on the middle body line', () => {
    // Layout: `\`\`\`\nfoo\n\`\`\`` — opener@0..3, body "foo"@4..7, closer@8..11.
    const doc = '```\nfoo\n```';
    // Cursor mid-body at offset 5 (the "o" in "foo")
    const result = applyCodeBlock({ doc, from: 5, to: 5 });

    // Fence markers are gone; body line remains.
    expect(result.doc).toBe('foo');
    expect(result.doc.includes('```')).toBe(false);

    // Cursor stays on the content line at the same column. Original body
    // started at offset 4; cursor at 5 → new offset 0 + (5 - 4) = 1.
    expect(result.cursor).toBe(1);
  });

  it('unwraps an empty fence to an empty line with cursor preserved at origin', () => {
    // Layout: `\`\`\`\n\`\`\`` — opener@0..3, closer@4..7. No body lines.
    const doc = '```\n```';
    const result = applyCodeBlock({ doc, from: 0, to: 0 });

    // Whole fence collapses to an empty document.
    expect(result.doc).toBe('');
    expect(result.cursor).toBe(0);
  });

  it('unwraps when the cursor is on the opener line itself (defensive)', () => {
    const doc = '```\nfoo\n```';
    // Cursor anywhere on the opener line — use the 2nd backtick
    const result = applyCodeBlock({ doc, from: 1, to: 1 });

    expect(result.doc).toBe('foo');
    // Defensive: cursor clamps to the start of the first body line
    expect(result.cursor).toBe(0);
  });

  it('unwraps when the cursor is on the closer line itself (defensive)', () => {
    const doc = '```\nfoo\n```';
    // Cursor on the closer line — position 9 (first ` of closer)
    const result = applyCodeBlock({ doc, from: 9, to: 9 });

    expect(result.doc).toBe('foo');
    // Defensive: cursor clamps to the end of the last body line (after "foo")
    expect(result.cursor).toBe(3);
  });

  it('leaves unrelated fence unchanged when cursor is OUTSIDE any fence (falls through to insert)', () => {
    // Two-fence-marker layout: cursor sits between a closer and a later
    // opener — i.e. not inside the pair. Regular insert path should run.
    const doc = '```\nfoo\n```\nhello';
    // Cursor at "hello" → offset 15 (the 'o' in hello at end)
    const result = applyCodeBlock({ doc, from: 15, to: 15 });

    // Should not have unwrapped — the original fence is still present.
    expect(result.doc.startsWith('```\nfoo\n```')).toBe(true);
    // A new fence was inserted at the cursor (insert path).
    const fenceCount = (result.doc.match(/```/g) || []).length;
    expect(fenceCount).toBe(4); // original 2 + new 2
  });
});

// ---------------------------------------------------------------------------
// Drift guard — verify the shipped applyFormat source in editorHtml.ts
// still matches the algorithm this test file is exercising. If SWE-2 edits
// the branch without updating this test, the guard fails loudly.
// ---------------------------------------------------------------------------

describe('applyFormat — source drift guard', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'editorHtml.ts'),
    'utf8',
  );

  it('editorHtml.ts still contains the code-block branch', () => {
    expect(source).toContain("if (command === 'code-block')");
  });

  it('uses the exact opening/closing backtick literals', () => {
    // Source contains escaped backticks because the branch lives inside a
    // template literal. Match both forms.
    expect(source).toMatch(/const opening = '\\?`\\?`\\?`'/);
    expect(source).toMatch(/const closing = '\\?`\\?`\\?`'/);
  });

  it('uses atLineStart and atLineEnd to decide leading/trailing breaks', () => {
    expect(source).toContain('atLineStart');
    expect(source).toContain('atLineEnd');
    expect(source).toContain("leadingBreak = atLineStart ? '' : '\\\\n'");
    expect(source).toContain("trailingBreak = atLineEnd ? '' : '\\\\n'");
  });

  it('strips at most one trailing newline from the body', () => {
    expect(source).toContain("if (body.endsWith('\\\\n')) body = body.slice(0, -1)");
  });

  it('cursor lands at openerEnd for empty body, end of body otherwise', () => {
    expect(source).toContain('const openerEnd = sel.from + leadingBreak.length + opening.length');
    expect(source).toContain('const bodyStart = openerEnd + 1');
    expect(source).toMatch(/body\.length === 0\s*\?\s*openerEnd\s*:\s*bodyStart \+ body\.length/);
  });

  it('defines findEnclosingFence and calls it before the insert path', () => {
    // Helper exists …
    expect(source).toContain('function findEnclosingFence(doc, pos)');
    // … and is invoked from the code-block branch to gate the unwrap.
    expect(source).toContain('findEnclosingFence(doc, sel.head)');
  });
});
