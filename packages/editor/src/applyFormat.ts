/**
 * Pure string-transform layer for the editor body's formatting toolbar.
 *
 * This module has zero dependencies on CodeMirror, React, React Native,
 * or any DOM — it's a plain (text, selection) -> (text, selection) function
 * that the editor component feeds with the current TextInput value and
 * cursor range. That keeps it exhaustively unit-testable under Vitest in
 * Node without any DOM or native shims.
 *
 * Commands supported in v1 (toolbar):
 *   bold         -> wraps selection in `**...**`; caret inside if empty
 *   italic       -> wraps selection in `_..._`; caret inside if empty
 *   h1           -> toggles `# ` prefix on the current line
 *   code-inline  -> wraps selection in single backticks
 *   code-block   -> fenced code block, splitting the current line as needed
 *   link         -> wraps selection in `[text](url)`, caret placed for quick edit
 *
 * Anything that is not a supported command returns the input untouched.
 */

import type { FormatCommand } from './types';

/** A cursor range inside a text document. `start === end` means a caret. */
export interface SelectionRange {
  start: number;
  end: number;
}

/** The result of applying a format command: the new text and new selection. */
export interface FormatResult {
  text: string;
  selection: SelectionRange;
}

/**
 * Apply `command` to `text` at `selection`. Returns a new string + selection.
 * Pure — never mutates its inputs.
 */
export function applyFormat(
  text: string,
  selection: SelectionRange,
  command: FormatCommand,
): FormatResult {
  const start = Math.max(0, Math.min(text.length, selection.start));
  const end = Math.max(start, Math.min(text.length, selection.end));
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const hasSelection = start !== end;

  switch (command) {
    case 'bold': {
      if (!hasSelection) {
        // Insert **** and place caret between the pairs.
        const insert = '****';
        return {
          text: before + insert + after,
          selection: { start: start + 2, end: start + 2 },
        };
      }
      const wrapped = `**${selected}**`;
      return {
        text: before + wrapped + after,
        selection: { start: start + wrapped.length, end: start + wrapped.length },
      };
    }

    case 'italic': {
      if (!hasSelection) {
        const insert = '__';
        return {
          text: before + insert + after,
          selection: { start: start + 1, end: start + 1 },
        };
      }
      const wrapped = `_${selected}_`;
      return {
        text: before + wrapped + after,
        selection: { start: start + wrapped.length, end: start + wrapped.length },
      };
    }

    case 'strikethrough': {
      if (!hasSelection) {
        const insert = '~~~~';
        return {
          text: before + insert + after,
          selection: { start: start + 2, end: start + 2 },
        };
      }
      const wrapped = `~~${selected}~~`;
      return {
        text: before + wrapped + after,
        selection: { start: start + wrapped.length, end: start + wrapped.length },
      };
    }

    case 'h1':
    case 'h2':
    case 'h3': {
      const level = command === 'h1' ? 1 : command === 'h2' ? 2 : 3;
      const prefix = '#'.repeat(level) + ' ';
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const nextNl = text.indexOf('\n', start);
      const lineEnd = nextNl === -1 ? text.length : nextNl;
      const line = text.slice(lineStart, lineEnd);

      const headingMatch = line.match(/^(#{1,6}) /);
      const existingPrefix = headingMatch ? headingMatch[0] : '';
      const bodyWithoutHeading = line.slice(existingPrefix.length);

      if (existingPrefix === prefix) {
        const newText = text.slice(0, lineStart) + bodyWithoutHeading + text.slice(lineEnd);
        const rawStart = start - prefix.length;
        const newStart = Math.max(lineStart, Math.min(newText.length, rawStart));
        return { text: newText, selection: { start: newStart, end: newStart } };
      }

      const prefixed = prefix + bodyWithoutHeading;
      const newText = text.slice(0, lineStart) + prefixed + text.slice(lineEnd);
      const delta = prefix.length - existingPrefix.length;
      const rawStart = start + delta;
      const newStart = Math.max(lineStart, Math.min(newText.length, rawStart));
      return { text: newText, selection: { start: newStart, end: newStart } };
    }

    case 'bullet-list':
    case 'numbered-list':
    case 'blockquote': {
      // Operate on every line touched by the selection (or the caret's line).
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const nextNlAfterEnd = text.indexOf('\n', end);
      const lineEnd = nextNlAfterEnd === -1 ? text.length : nextNlAfterEnd;
      const block = text.slice(lineStart, lineEnd);
      const lines = block.split('\n');

      const bulletRe = /^- /;
      const numberedRe = /^\d+\. /;
      const quoteRe = /^> /;
      const matcher =
        command === 'bullet-list'
          ? bulletRe
          : command === 'numbered-list'
          ? numberedRe
          : quoteRe;

      // If every non-empty line already has the prefix, toggle off.
      const nonEmptyLines = lines.filter((l) => l.length > 0);
      const allPrefixed =
        nonEmptyLines.length > 0 && nonEmptyLines.every((l) => matcher.test(l));

      const transformed = allPrefixed
        ? lines.map((l) => l.replace(matcher, ''))
        : lines.map((l, i) => {
            if (l.length === 0) return l;
            // Strip any other list/quote prefix first so toggling between styles replaces cleanly.
            const stripped = l.replace(bulletRe, '').replace(numberedRe, '').replace(quoteRe, '');
            if (command === 'numbered-list') return `${i + 1}. ${stripped}`;
            if (command === 'bullet-list') return `- ${stripped}`;
            return `> ${stripped}`;
          });

      const newBlock = transformed.join('\n');
      const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
      const delta = newBlock.length - block.length;
      const rawEnd = end + delta;
      const newEnd = Math.max(0, Math.min(newText.length, rawEnd));
      return { text: newText, selection: { start: newEnd, end: newEnd } };
    }

    case 'code-inline':
    case 'code-block': {
      // Single pathway that auto-picks inline vs fenced.
      const isMultiLine = selected.includes('\n');
      const forceFence = command === 'code-block';
      const forceInline = command === 'code-inline';

      if (!forceFence && (forceInline || (hasSelection && !isMultiLine))) {
        // Inline backtick wrap. If no selection, insert `` and sit between.
        if (!hasSelection) {
          const insert = '``';
          return {
            text: before + insert + after,
            selection: { start: start + 1, end: start + 1 },
          };
        }
        const wrapped = '`' + selected + '`';
        return {
          text: before + wrapped + after,
          selection: {
            start: start + wrapped.length,
            end: start + wrapped.length,
          },
        };
      }

      // Fenced block. Respect line boundaries so the fences always sit on
      // their own lines. If the selection is empty, drop the caret between
      // the fences on a blank body line.
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const atLineStart = start === lineStart;
      const lineEndAbs = end === text.length || text[end] === '\n' ? end : -1;
      const atLineEnd = lineEndAbs === end;

      const leadingBreak = atLineStart ? '' : '\n';
      const trailingBreak = atLineEnd ? '' : '\n';

      let body = selected;
      if (body.endsWith('\n')) body = body.slice(0, -1);

      const fence = `${leadingBreak}\`\`\`\n${body}\n\`\`\`${trailingBreak}`;
      const newText = before + fence + after;
      // Cursor: end of body (or just after the opener on an empty body).
      const openerEnd = start + leadingBreak.length + 3;
      const bodyStart = openerEnd + 1;
      const cursor = body.length === 0 ? openerEnd : bodyStart + body.length;
      return {
        text: newText,
        selection: { start: cursor, end: cursor },
      };
    }

    case 'link': {
      if (!hasSelection) {
        // [text](url) with `text` selected so the user can type over it.
        const insert = '[text](url)';
        return {
          text: before + insert + after,
          selection: { start: start + 1, end: start + 5 },
        };
      }
      const prefix = '[';
      const middle = `${selected}](`;
      const suffix = 'url)';
      const wrapped = prefix + middle + suffix;
      // Put caret at "url" so it's ready to be replaced.
      const urlStart = start + prefix.length + middle.length;
      const urlEnd = urlStart + 3; // "url"
      return {
        text: before + wrapped + after,
        selection: { start: urlStart, end: urlEnd },
      };
    }

    // Anything else — no-op, return the input unchanged.
    default:
      return { text, selection: { start, end } };
  }
}
