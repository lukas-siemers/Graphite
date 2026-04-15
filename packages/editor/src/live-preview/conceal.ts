/**
 * Obsidian-style marker concealment for the CodeMirror 6 live-preview
 * editor.
 *
 * Policy
 * ------
 * A marker is a Lezer markdown node whose CHARACTERS are syntax-only —
 * `**`, `*`, `_`, `` ` `` (inline), `~~`, `#`/`##`/`###` at line start,
 * and the `[`, `]`, `(`, `)` plus the URL text inside an inline link.
 * When the user's selection is NOT on the same line as the marker, the
 * marker is replaced with an empty inline decoration so the rendered
 * output looks like the formatted text only. When the selection (head
 * or any line in a multi-line range) touches the marker's line, the
 * marker is revealed so it can be edited.
 *
 * Non-goals
 * ---------
 *   - Block widgets are BANNED in this codebase (commit 3455e9f
 *     cursor-jump fix). This module only emits inline
 *     `Decoration.replace()` ranges, never `Decoration.widget()` and
 *     never a replace that spans a whole line.
 *   - Fenced code block markers (the ``` opener/closer) are handled by
 *     the separate `fenceStylePlugin` — we skip any `CodeMark` that
 *     lives inside a `FencedCode` node so the two systems don't fight.
 *   - List bullets / numbers are structural; we do not conceal them.
 *
 * Shape
 * -----
 *   - `buildConcealDecorations(state)` walks `syntaxTree(state)` ONCE
 *     and returns a sorted `DecorationSet` of inline replacements.
 *   - The plugin inside `editorHtml.ts` wraps this in a `ViewPlugin`
 *     that rebuilds on doc/selection/viewport change. That wrapper is
 *     duplicated inside the bootstrap string — this module is the
 *     single source of truth for the concealment policy and the one
 *     that the Vitest suite exercises.
 */
import { EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

/**
 * Inline replace decoration — empty inclusive=false range makes the
 * marker characters invisible without removing them from the document.
 * The parent node (Emphasis, StrongEmphasis, Link, …) keeps its text
 * children so the visible content still renders, just without the
 * syntax punctuation.
 */
const concealMark = Decoration.replace({});

/**
 * Line range touched by the primary selection. In multi-line selections
 * we reveal markers on EVERY line the selection crosses — matches the
 * Obsidian behavior of "if the caret is anywhere on this line, show
 * the source".
 */
function selectionLineRange(state: EditorState): { from: number; to: number } {
  const sel = state.selection.main;
  const headLine = state.doc.lineAt(sel.head).number;
  const anchorLine = state.doc.lineAt(sel.anchor).number;
  return {
    from: Math.min(headLine, anchorLine),
    to: Math.max(headLine, anchorLine),
  };
}

/**
 * True when the node sits anywhere inside a `FencedCode` ancestor. The
 * fence plugin owns those markers; we must not double-decorate them.
 */
function insideFencedCode(node: SyntaxNode): boolean {
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent) {
    if (p.name === 'FencedCode') return true;
  }
  return false;
}

/**
 * The marker node names we conceal when off-line. HeaderMark is
 * included but a separate rule in the walker keeps heading markers
 * visible on their own line anyway; this list is the "candidates" set.
 *
 * NOTE: CodeMark covers both inline backticks AND fenced openers. We
 * keep it here and filter fenced ones via `insideFencedCode()` below.
 */
const MARK_NODE_NAMES = new Set<string>([
  'EmphasisMark',
  'StrongEmphasisMark', // older parser versions — harmless if absent
  'CodeMark',
  'StrikethroughMark',
  'HeaderMark',
  'LinkMark',
]);

/**
 * The URL *content* of an inline link `[text](url)` is concealed when
 * off-line — we keep the visible link text, hide the URL payload. This
 * mirrors the Obsidian "only the link title shows" behavior.
 */
const URL_NODE_NAME = 'URL';

export interface BuildResult {
  decorations: DecorationSet;
  /** For tests — raw list of `[from, to]` ranges that were concealed. */
  ranges: Array<[number, number]>;
}

/**
 * Walk the syntax tree and build the concealment decoration set.
 *
 * Performance: one tree.iterate() pass, constant work per node. The
 * builder runs on every doc / selection / viewport change so it must
 * stay cheap — no allocations inside the hot loop other than the
 * per-range decoration spec itself.
 */
export function buildConcealDecorations(state: EditorState): BuildResult {
  const tree = syntaxTree(state);
  const doc = state.doc;
  const { from: selLineFrom, to: selLineTo } = selectionLineRange(state);
  const raw: Array<[number, number]> = [];

  tree.iterate({
    enter: (ref) => {
      const name = ref.name;
      const from = ref.from;
      const to = ref.to;

      // Zero-width ranges can't carry a replace decoration.
      if (to <= from) return;

      if (name === URL_NODE_NAME) {
        // Hide the URL payload (inside the parentheses) when the link's
        // line is not the active line. Keep it visible so the user can
        // edit when they move the cursor onto the link.
        const lineNum = doc.lineAt(from).number;
        if (lineNum < selLineFrom || lineNum > selLineTo) {
          raw.push([from, to]);
        }
        return;
      }

      if (!MARK_NODE_NAMES.has(name)) return;

      // Fenced code markers are the fence plugin's job — leave them.
      if (name === 'CodeMark' && ref.node && insideFencedCode(ref.node)) {
        return;
      }

      const lineNum = doc.lineAt(from).number;
      if (lineNum >= selLineFrom && lineNum <= selLineTo) {
        // On the active line → reveal (no decoration).
        return;
      }

      raw.push([from, to]);
    },
  });

  // Decoration.set() requires ranges sorted by `from` ascending. The
  // Lezer iterate callback already visits nodes in document order, so
  // the raw list is already sorted — but we re-sort defensively in
  // case tree traversal order ever changes upstream.
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const decos = raw.map(([f, t]) => concealMark.range(f, t));
  return {
    decorations: Decoration.set(decos, /* sort */ true),
    ranges: raw,
  };
}
