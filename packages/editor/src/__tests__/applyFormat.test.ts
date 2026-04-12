/**
 * Unit tests for the pure `applyFormat` transform used by the plain
 * React Native TextInput editor body.
 *
 * These replace the old iframe / editorHtml.ts parity tests — the
 * WebView editor stack was removed in the emergency rewrite and the
 * toolbar now drives a pure (text, selection) -> (text, selection)
 * function on top of a single TextInput.
 */

import { describe, it, expect } from 'vitest';
import { applyFormat } from '../applyFormat';
import type { SelectionRange } from '../applyFormat';

function sel(start: number, end: number = start): SelectionRange {
  return { start, end };
}

describe('applyFormat — bold', () => {
  it('inserts **** with caret inside on an empty selection', () => {
    const result = applyFormat('', sel(0), 'bold');
    expect(result.text).toBe('****');
    expect(result.selection).toEqual({ start: 2, end: 2 });
  });

  it('wraps selection with ** and parks caret after the closing **', () => {
    const result = applyFormat('hello world', sel(0, 5), 'bold');
    expect(result.text).toBe('**hello** world');
    // Caret after '**hello**' (9 chars)
    expect(result.selection).toEqual({ start: 9, end: 9 });
  });

  it('preserves surrounding text when wrapping a middle selection', () => {
    const result = applyFormat('abc def ghi', sel(4, 7), 'bold');
    expect(result.text).toBe('abc **def** ghi');
  });
});

describe('applyFormat — italic', () => {
  it('inserts __ with caret inside on an empty selection', () => {
    const result = applyFormat('', sel(0), 'italic');
    expect(result.text).toBe('__');
    expect(result.selection).toEqual({ start: 1, end: 1 });
  });

  it('wraps selection with underscores', () => {
    const result = applyFormat('foo', sel(0, 3), 'italic');
    expect(result.text).toBe('_foo_');
    expect(result.selection).toEqual({ start: 5, end: 5 });
  });
});

describe('applyFormat — h1', () => {
  it('prepends "# " on a bare line', () => {
    const result = applyFormat('hello', sel(5), 'h1');
    expect(result.text).toBe('# hello');
    // Caret shifts right by 2 (length of "# ")
    expect(result.selection).toEqual({ start: 7, end: 7 });
  });

  it('toggles "# " off when the line already starts with it', () => {
    const result = applyFormat('# hello', sel(7), 'h1');
    expect(result.text).toBe('hello');
    expect(result.selection).toEqual({ start: 5, end: 5 });
  });

  it('only touches the current line in a multi-line doc', () => {
    const doc = 'line1\nline2\nline3';
    // Cursor on "line2"
    const result = applyFormat(doc, sel(6), 'h1');
    expect(result.text).toBe('line1\n# line2\nline3');
  });

  it('toggles "# " off on the current line only', () => {
    const doc = '# one\n# two\n# three';
    // Cursor on "# two"
    const result = applyFormat(doc, sel(6 + 2), 'h1');
    expect(result.text).toBe('# one\ntwo\n# three');
  });
});

describe('applyFormat — code', () => {
  it('wraps a single-line selection in inline backticks', () => {
    const result = applyFormat('see foo() here', sel(4, 9), 'code-inline');
    expect(result.text).toBe('see `foo()` here');
    // Caret after closing backtick
    expect(result.selection.start).toBe(11);
  });

  it('inserts `` with caret between on an empty selection via code-inline', () => {
    const result = applyFormat('x', sel(1), 'code-inline');
    expect(result.text).toBe('x``');
    expect(result.selection).toEqual({ start: 2, end: 2 });
  });

  it('emits a fenced block when the selection spans multiple lines', () => {
    const doc = 'foo\nbar';
    const result = applyFormat(doc, sel(0, 7), 'code-block');
    expect(result.text).toBe('```\nfoo\nbar\n```');
    // Cursor lands at end of body "foo\nbar"
    // openerEnd = 0 + 0 + 3 = 3; bodyStart = 4; body.length = 7 -> 11
    expect(result.selection.start).toBe(11);
  });

  it('emits a fenced block on an empty selection at start of an empty doc', () => {
    const result = applyFormat('', sel(0), 'code-block');
    expect(result.text).toBe('```\n\n```');
    // Empty body -> cursor sits at openerEnd = 3
    expect(result.selection.start).toBe(3);
  });

  it('splits a mid-line cursor when forcing a fenced block', () => {
    const result = applyFormat('hello world', sel(5), 'code-block');
    // Mid-line -> needs both leading and trailing \n
    expect(result.text).toBe('hello\n```\n\n```\n world');
    // openerEnd = 5 + 1 + 3 = 9 (empty body)
    expect(result.selection.start).toBe(9);
  });
});

describe('applyFormat — link', () => {
  it('inserts [text](url) with "text" selected on empty caret', () => {
    const result = applyFormat('', sel(0), 'link');
    expect(result.text).toBe('[text](url)');
    // Selection covers the word "text" so the user can replace it
    expect(result.selection).toEqual({ start: 1, end: 5 });
  });

  it('wraps a selection as [selected](url) with caret inside "url"', () => {
    const result = applyFormat('click here', sel(6, 10), 'link');
    expect(result.text).toBe('click [here](url)');
    // "url" substring sits at offsets 13..16
    expect(result.selection).toEqual({ start: 13, end: 16 });
  });
});

describe('applyFormat — unsupported command passthrough', () => {
  it('returns the input unchanged for strikethrough (not wired in v1)', () => {
    const result = applyFormat('foo', sel(0, 3), 'strikethrough');
    expect(result.text).toBe('foo');
    expect(result.selection).toEqual({ start: 0, end: 3 });
  });

  it('returns the input unchanged for undo (handled by the host component)', () => {
    const result = applyFormat('bar', sel(1), 'undo');
    expect(result.text).toBe('bar');
    expect(result.selection).toEqual({ start: 1, end: 1 });
  });
});

describe('applyFormat — selection clamping', () => {
  it('clamps out-of-range selections to the doc length', () => {
    const result = applyFormat('abc', sel(99, 200), 'bold');
    // Clamped to caret at end -> insert ****
    expect(result.text).toBe('abc****');
    expect(result.selection).toEqual({ start: 5, end: 5 });
  });

  it('handles selection with end before start defensively', () => {
    const result = applyFormat('abc', sel(2, 1), 'italic');
    // end clamped up to start -> empty selection at 2
    expect(result.text).toBe('ab__c');
    expect(result.selection).toEqual({ start: 3, end: 3 });
  });
});
