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

    case 'h1': {
      // Operate on the current line containing `start`. Toggle off if the
      // line already begins with `# `.
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const nextNl = text.indexOf('\n', start);
      const lineEnd = nextNl === -1 ? text.length : nextNl;
      const line = text.slice(lineStart, lineEnd);

      const isH1 = line.startsWith('# ');
      if (isH1) {
        const stripped = line.slice(2);
        const newText = text.slice(0, lineStart) + stripped + text.slice(lineEnd);
        // Shift caret back by 2 if it was past the prefix, otherwise clamp.
        const shift = start >= lineStart + 2 ? -2 : -(start - lineStart);
        const newStart = Math.max(lineStart, start + shift);
        return {
          text: newText,
          selection: { start: newStart, end: newStart },
        };
      }

      const prefixed = '# ' + line;
      const newText = text.slice(0, lineStart) + prefixed + text.slice(lineEnd);
      const newStart = start + 2;
      return {
        text: newText,
        selection: { start: newStart, end: newStart },
      };
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
