/**
 * Self-contained CodeMirror 6 HTML bundle for the Live Preview editor.
 *
 * Loaded into an iframe via srcdoc — no Metro bundling needed.
 * Communicates with the parent via postMessage.
 *
 * Parent → iframe messages:
 *   { type: 'set-value', value: string }
 *   { type: 'apply-format', command: string }
 *   { type: 'focus' }
 *   { type: 'set-readonly', readonly: boolean }
 *
 * iframe → parent messages:
 *   { type: 'ready' }
 *   { type: 'change', value: string }
 *   { type: 'active-formats', formats: string[] }
 *   { type: 'height', height: number }
 *   { type: 'command-applied' }
 */
export function buildEditorHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: transparent;
    color: #DCDDDE;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 16px;
    line-height: 24px;
    min-height: 100vh;
    overflow-x: hidden;
  }

  #editor {
    padding: 0 32px 48px 32px;
    min-height: 100vh;
  }

  /* ── CodeMirror shell — fully transparent, no box ── */
  .cm-editor {
    background: transparent !important;
    color: #DCDDDE;
    font-size: 16px;
    line-height: 24px;
    outline: none !important;
    border: none !important;
  }
  .cm-editor.cm-focused { outline: none !important; box-shadow: none !important; border: none !important; }
  .cm-scroller {
    background: transparent !important;
    overflow: visible !important;
    padding: 0;
  }
  .cm-content {
    background: transparent !important;
    caret-color: #FF6A00 !important;
    padding: 24px 0 48px 0;
    min-height: 100vh;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .cm-cursor, .cm-cursor-primary {
    border-left-color: #FF6A00 !important;
    border-left-width: 3px !important;
  }
  .cm-gutters { background: transparent !important; border: none !important; }
  .cm-line { padding: 0; }
  .cm-dropCursor {
    border-left: 2px solid #F28500 !important;
  }
  .cm-selectionBackground { background: rgba(242,133,0,0.25) !important; }
  .cm-focused .cm-selectionBackground { background: rgba(242,133,0,0.3) !important; }

  /* ── Live-preview hidden marks ── */
  .cm-md-hidden {
    display: none;
  }

  /* ── Heading styles (applied via line decoration) ── */
  .cm-md-h1 { font-size: 26px !important; font-weight: 700 !important; color: #FFFFFF !important; line-height: 36px !important; }
  .cm-md-h2 { font-size: 22px !important; font-weight: 700 !important; color: #FFFFFF !important; line-height: 30px !important; }
  .cm-md-h3 { font-size: 18px !important; font-weight: 600 !important; color: #FFFFFF !important; line-height: 26px !important; }

  /* ── Inline styles (applied via mark decoration) ── */
  .cm-md-bold   { font-weight: 700; color: #FFFFFF; }
  .cm-md-italic { font-style: italic; }
  .cm-md-strike { text-decoration: line-through; color: #8A8F98; }
  .cm-md-code   { font-family: 'Courier New', monospace; font-size: 14px; color: #FFB347; background: #141414; padding: 1px 4px; border-radius: 2px; }
  .cm-md-link   { color: #F28500; text-decoration: underline; }
  .cm-md-blockquote-line { border-left: 3px solid #F28500; padding-left: 12px; color: #8A8F98; }
  .cm-md-bullet   { color: #F28500; }

  /* ── Fenced code blocks (spec: docs/specs/code-block.md) ──
     Rendered via a block widget (header) + line decorations (body lines).
     All values come from the Digital Monolith spec — 0px radius, sharp,
     tonal stacking, no shadows. */

  /* Header widget: language pill (left) + copy button (right) */
  .cm-graphite-codeblock__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 8px;
    background: #252525;
    border: 1px solid #333333;
    border-bottom: 1px solid #333333;
    margin-top: 16px;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  .cm-graphite-codeblock__lang {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    background: #2C1800;
    color: #FFB347;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    border: none;
    border-radius: 0;
  }
  .cm-graphite-codeblock__copy {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    background: transparent;
    color: #8A8F98;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    border: none;
    border-radius: 0;
    cursor: pointer;
    transition: none;
  }
  .cm-graphite-codeblock__copy:hover {
    background: #2C2C2C;
    color: #DCDDDE;
  }
  .cm-graphite-codeblock__copy:active {
    background: #D4730A;
    color: #1E1E1E;
  }
  .cm-graphite-codeblock__copy:focus-visible {
    outline: 2px solid #F28500;
    outline-offset: 0;
    border-radius: 0;
  }
  .cm-graphite-codeblock__copy--copied,
  .cm-graphite-codeblock__copy--copied:hover {
    background: transparent;
    color: #F28500;
  }

  /* Body lines — shared background, left/right border, Courier stack.
     The header owns the top border (via its border-bottom acting as the
     seam), and the last body line owns the bottom border. */
  .cm-md-fence-line {
    background: #141414 !important;
    color: #DCDDDE;
    font-family: "SF Mono", Menlo, Consolas, "Courier New", Courier, monospace !important;
    font-size: 13px !important;
    line-height: 20.15px !important; /* 13 * 1.55 */
    padding: 0 16px !important;
    border-left: 1px solid #333333;
    border-right: 1px solid #333333;
    white-space: pre !important;
    overflow-x: auto;
    overflow-y: hidden;
    tab-size: 2;
  }
  .cm-md-fence-line::-webkit-scrollbar { height: 8px; }
  .cm-md-fence-line::-webkit-scrollbar-track { background: transparent; }
  .cm-md-fence-line::-webkit-scrollbar-thumb { background: #333333; }
  .cm-md-fence-line::-webkit-scrollbar-thumb:hover { background: #555558; }

  /* Opening fence line — extra top padding */
  .cm-md-fence-first {
    padding-top: 12px !important;
  }
  /* Closing fence line — extra bottom padding + bottom border */
  .cm-md-fence-last {
    padding-bottom: 12px !important;
    border-bottom: 1px solid #333333;
    margin-bottom: 16px;
  }
  /* The opening/closing triple-backtick markers must remain editable so
     the cursor can land on them. Dim them to near-invisibility without
     collapsing them so measure layout stays stable. */
  .cm-md-fence-first, .cm-md-fence-last {
    color: #555558;
  }

  /* Empty-state placeholder — shown on an otherwise blank content line
     that sits alone between the opener and the closer. */
  .cm-md-fence-empty::after {
    content: "// write code here";
    color: #555558;
    font-style: normal;
    pointer-events: none;
  }

  /* ── Placeholder ── */
  .cm-placeholder { color: #8A8F98 !important; font-style: italic; }

  /* ── Loading / error state ── */
  #status {
    position: fixed;
    top: 16px;
    left: 24px;
    right: 24px;
    color: #8A8F98;
    font-size: 13px;
    pointer-events: none;
  }
  #status.error { color: #FF6B6B; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="status">Loading editor…</div>
<div id="editor"></div>

<script>
// Global error surfacing — any script failure shows inline + posts to parent
function reportError(err) {
  const el = document.getElementById('status');
  if (el) {
    el.className = 'error';
    el.textContent = 'Editor failed to load: ' + (err && err.message ? err.message : String(err));
  }
  try { window.parent.postMessage({ type: 'error', message: String(err && err.stack || err) }, '*'); } catch (_) {}
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
</script>

<script type="module">
import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state@6';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  keymap,
  placeholder,
} from 'https://esm.sh/@codemirror/view@6';
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo,
  redo,
  indentWithTab,
} from 'https://esm.sh/@codemirror/commands@6';
import { markdown, markdownLanguage } from 'https://esm.sh/@codemirror/lang-markdown@6';
import {
  syntaxTree,
  HighlightStyle,
  syntaxHighlighting,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from 'https://esm.sh/@codemirror/language@6';
import { tags as t } from 'https://esm.sh/@lezer/highlight@1';

// ---------------------------------------------------------------------------
// Static language imports — @codemirror/language-data uses dynamic import()
// which does not work reliably via esm.sh in an iframe srcdoc without an
// import map. Importing the grammars directly is a few more kB but avoids
// the duplicate-@codemirror/state runtime error.
// ---------------------------------------------------------------------------
import { python }     from 'https://esm.sh/@codemirror/lang-python@6';
import { javascript } from 'https://esm.sh/@codemirror/lang-javascript@6';
import { cpp }        from 'https://esm.sh/@codemirror/lang-cpp@6';
import { rust }       from 'https://esm.sh/@codemirror/lang-rust@6';
import { java }       from 'https://esm.sh/@codemirror/lang-java@6';
import { html as htmlLang } from 'https://esm.sh/@codemirror/lang-html@6';
import { css as cssLang }   from 'https://esm.sh/@codemirror/lang-css@6';
import { json as jsonLang } from 'https://esm.sh/@codemirror/lang-json@6';
import { sql }        from 'https://esm.sh/@codemirror/lang-sql@6';
// C# / Kotlin / Scala / Objective-C via the StreamLanguage clike parser
import { csharp, kotlin, scala, objectiveC } from 'https://esm.sh/@codemirror/legacy-modes@6/mode/clike';
import { shell }      from 'https://esm.sh/@codemirror/legacy-modes@6/mode/shell';
import { go as goMode } from 'https://esm.sh/@codemirror/legacy-modes@6/mode/go';
import { ruby }       from 'https://esm.sh/@codemirror/legacy-modes@6/mode/ruby';
import { lua }        from 'https://esm.sh/@codemirror/legacy-modes@6/mode/lua';
import { yaml as yamlMode } from 'https://esm.sh/@codemirror/legacy-modes@6/mode/yaml';
import { toml as tomlMode } from 'https://esm.sh/@codemirror/legacy-modes@6/mode/toml';
import { swift }      from 'https://esm.sh/@codemirror/legacy-modes@6/mode/swift';

// Build a LanguageDescription list. The load function is async but we
// resolve synchronously from closures — CodeMirror awaits the promise
// internally and caches the result. Aliases let users write shorthand.
const legacy = (mode) => new LanguageSupport(StreamLanguage.define(mode));
const codeLanguageList = [
  LanguageDescription.of({ name: 'python',     alias: ['py'],             load: async () => python() }),
  LanguageDescription.of({ name: 'javascript', alias: ['js'],             load: async () => javascript() }),
  LanguageDescription.of({ name: 'typescript', alias: ['ts'],             load: async () => javascript({ typescript: true }) }),
  LanguageDescription.of({ name: 'jsx',                                   load: async () => javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'tsx',                                   load: async () => javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'cpp',        alias: ['c++', 'c'],       load: async () => cpp() }),
  LanguageDescription.of({ name: 'csharp',     alias: ['c#', 'cs'],       load: async () => legacy(csharp) }),
  LanguageDescription.of({ name: 'java',                                   load: async () => java() }),
  LanguageDescription.of({ name: 'kotlin',     alias: ['kt'],             load: async () => legacy(kotlin) }),
  LanguageDescription.of({ name: 'scala',                                  load: async () => legacy(scala) }),
  LanguageDescription.of({ name: 'objective-c', alias: ['objc'],          load: async () => legacy(objectiveC) }),
  LanguageDescription.of({ name: 'rust',       alias: ['rs'],             load: async () => rust() }),
  LanguageDescription.of({ name: 'go',         alias: ['golang'],         load: async () => legacy(goMode) }),
  LanguageDescription.of({ name: 'ruby',       alias: ['rb'],             load: async () => legacy(ruby) }),
  LanguageDescription.of({ name: 'lua',                                    load: async () => legacy(lua) }),
  LanguageDescription.of({ name: 'swift',                                  load: async () => legacy(swift) }),
  LanguageDescription.of({ name: 'shell',      alias: ['bash', 'sh', 'zsh'], load: async () => legacy(shell) }),
  LanguageDescription.of({ name: 'sql',                                    load: async () => sql() }),
  LanguageDescription.of({ name: 'html',                                   load: async () => htmlLang() }),
  LanguageDescription.of({ name: 'css',                                    load: async () => cssLang() }),
  LanguageDescription.of({ name: 'json',                                   load: async () => jsonLang() }),
  LanguageDescription.of({ name: 'yaml',       alias: ['yml'],            load: async () => legacy(yamlMode) }),
  LanguageDescription.of({ name: 'toml',                                   load: async () => legacy(tomlMode) }),
];

// ---------------------------------------------------------------------------
// Graphite syntax highlight style — matches the Digital Monolith design system
// ---------------------------------------------------------------------------
const graphiteHighlight = HighlightStyle.define([
  { tag: t.keyword,                                                         color: '#FFB347', fontWeight: '600' },
  { tag: [t.string, t.special(t.string), t.character],                       color: '#A8D060' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment],           color: '#555558', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom],                                 color: '#F28500' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)],           color: '#FFFFFF' },
  { tag: [t.definition(t.variableName), t.definition(t.function(t.variableName))], color: '#FFFFFF', fontWeight: '600' },
  { tag: [t.typeName, t.className],                                          color: '#FFB347' },
  { tag: [t.variableName, t.propertyName],                                   color: '#DCDDDE' },
  { tag: t.operator,                                                         color: '#8A8F98' },
  { tag: [t.punctuation, t.bracket, t.squareBracket, t.paren, t.brace],      color: '#8A8F98' },
  { tag: [t.tagName, t.angleBracket],                                        color: '#FFB347' },
  { tag: t.attributeName,                                                    color: '#A8D060' },
  { tag: t.attributeValue,                                                   color: '#A8D060' },
  { tag: t.regexp,                                                           color: '#F28500' },
  { tag: t.escape,                                                           color: '#F28500' },
  { tag: t.meta,                                                             color: '#8A8F98' },
  { tag: t.invalid,                                                          color: '#FF6B6B', textDecoration: 'underline' },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg) {
  window.parent.postMessage(msg, '*');
}

// ---------------------------------------------------------------------------
// Live-preview decorations plugin
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fence header widget — language chip + copy button rendered above each
// fenced code block as a block decoration.
// ---------------------------------------------------------------------------
class FenceHeaderWidget extends WidgetType {
  constructor(language, content) {
    super();
    this.language = language || '';
    this.content = content || '';
  }
  eq(other) {
    // Memoization guard: only rebuild the DOM when the displayed language
    // label or the clipboard content actually change. This avoids measure
    // glitches on every keystroke inside an unrelated part of the document.
    return other.language === this.language && other.content === this.content;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-graphite-codeblock__header';
    wrap.contentEditable = 'false';
    wrap.setAttribute('spellcheck', 'false');

    // Language pill — uppercase language name or the "CODE" fallback.
    // Unknown languages (info strings not in the registry) still display
    // their uppercase name — per spec 5.3, only the empty / missing case
    // falls back to "CODE".
    const rawLang = (this.language || '').trim();
    const displayLang = rawLang ? rawLang.toUpperCase() : 'CODE';
    const langEl = document.createElement('span');
    langEl.className = 'cm-graphite-codeblock__lang';
    langEl.setAttribute('role', 'img');
    langEl.setAttribute('aria-label', 'Language: ' + displayLang);
    langEl.textContent = displayLang;

    // COPY button on the right
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-graphite-codeblock__copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');
    btn.textContent = 'COPY';

    const content = this.content;
    let resetTimer = null;
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const done = () => {
        btn.classList.add('cm-graphite-codeblock__copy--copied');
        btn.textContent = 'COPIED';
        btn.setAttribute('aria-label', 'Code copied');
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          btn.classList.remove('cm-graphite-codeblock__copy--copied');
          btn.textContent = 'COPY';
          btn.setAttribute('aria-label', 'Copy code to clipboard');
          resetTimer = null;
        }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(content).then(done).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = content;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); done(); } catch (_) {}
          document.body.removeChild(ta);
        });
      }
    });

    wrap.appendChild(langEl);
    wrap.appendChild(btn);
    return wrap;
  }
  ignoreEvent() { return false; }
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.build(view);
  }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = this.build(update.view);
    }
  }
  build(view) {
    const doc = view.state.doc;
    const selection = view.state.selection.main;

    // Collect all decorations; Decoration.set sorts them at the end
    const decos = [];

    syntaxTree(view.state).iterate({
      enter(node) {
        const { from, to, name } = node;

        // Determine if cursor is on same line as this node
        const nodeLine = doc.lineAt(from).number;
        const cursorLine = doc.lineAt(selection.head).number;
        const cursorOnLine = nodeLine === cursorLine;

        // Marks to hide when cursor is elsewhere
        const hiddenWhenAway = [
          'HeaderMark',
          'EmphasisMark',
          'CodeMark',
          'StrikethroughMark',
          'QuoteMark',
        ];

        if (hiddenWhenAway.includes(name) && !cursorOnLine) {
          decos.push({ from, to, deco: Decoration.mark({ class: 'cm-md-hidden' }) });
          return;
        }

        // Link URL — hide when cursor is not on this line
        if (name === 'URL' && !cursorOnLine) {
          decos.push({ from, to, deco: Decoration.mark({ class: 'cm-md-hidden' }) });
          return;
        }

        // Heading line decorations
        if (name === 'ATXHeading1') {
          decos.push({ from, to: from, deco: Decoration.line({ class: 'cm-md-h1' }) });
        } else if (name === 'ATXHeading2') {
          decos.push({ from, to: from, deco: Decoration.line({ class: 'cm-md-h2' }) });
        } else if (name === 'ATXHeading3') {
          decos.push({ from, to: from, deco: Decoration.line({ class: 'cm-md-h3' }) });
        }

        // Bold / Strong
        if (name === 'StrongEmphasis') {
          decos.push({ from, to, deco: Decoration.mark({ class: 'cm-md-bold' }) });
        }

        // Italic / Emphasis
        if (name === 'Emphasis') {
          decos.push({ from, to, deco: Decoration.mark({ class: 'cm-md-italic' }) });
        }

        // Strikethrough
        if (name === 'Strikethrough') {
          decos.push({ from, to, deco: Decoration.mark({ class: 'cm-md-strike' }) });
        }

        // Inline code
        if (name === 'InlineCode') {
          decos.push({ from, to, deco: Decoration.mark({ class: 'cm-md-code' }) });
        }

        // Link
        if (name === 'Link') {
          decos.push({ from, to, deco: Decoration.mark({ class: 'cm-md-link' }) });
        }

        // Blockquote lines
        if (name === 'Blockquote') {
          // Iterate each line in the blockquote
          let pos = from;
          while (pos <= to) {
            const line = doc.lineAt(pos);
            decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-md-blockquote-line' }) });
            if (line.to >= to) break;
            pos = line.to + 1;
          }
        }

        // Fence rendering is handled in a separate fencePlugin to keep
        // block widgets and inline/line decorations in different providers
        // (avoids "ranges must be added in sorted order" crashes).
      },
    });

    // Use Decoration.set(ranges, sort=true) instead of RangeSetBuilder —
    // it handles mixed line/mark/block-widget decorations with the correct
    // startSide ordering automatically, avoiding "ranges must be added in
    // sorted order" errors when block widgets overlap line decorations.
    const ranges = decos.map(({ from, to, deco }) => deco.range(from, to));
    return Decoration.set(ranges, true);
  }
}, { decorations: v => v.decorations });

// ---------------------------------------------------------------------------
// Fence plugin — renders the header widget above every fenced code block
// and styles the content lines. Uses the FencedCode node from the markdown
// syntax tree for closed fences, plus a small regex fallback for the
// unclosed fence at end-of-document (so live preview renders immediately
// when the user types the opener).
//
// Kept in a SEPARATE plugin from livePreviewPlugin so the block widget
// decorations don't collide with livePreviewPlugin's line/mark decorations.
// Both plugins return independent decoration sets; CodeMirror merges them.
// ---------------------------------------------------------------------------
const fencePlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.build(view);
  }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.build(update.view);
    }
  }
  build(view) {
    const doc = view.state.doc;
    const decos = [];
    // Track which line numbers are already inside a closed fence so the
    // fallback scanner doesn't double-render them.
    const handled = new Set();

    // Closed fences via syntax tree
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name !== 'FencedCode') return;
        const fromLine = doc.lineAt(node.from);
        const toLine = doc.lineAt(node.to);

        // Extract language from the first line (text after the opening fence)
        const openText = fromLine.text;
        const langMatch = openText.match(new RegExp('^\\\\s*' + '\`'.repeat(3) + '(.*)$'));
        const lang = langMatch ? (langMatch[1] || '').trim() : '';

        // Collect content lines (between opener and closer) for copy
        const contentLines = [];
        for (let ln = fromLine.number + 1; ln < toLine.number; ln++) {
          contentLines.push(doc.line(ln).text);
        }
        const codeContent = contentLines.join('\\n');

        // Block widget above opener
        decos.push({
          pos: fromLine.from,
          side: -1,
          block: true,
          deco: Decoration.widget({
            widget: new FenceHeaderWidget(lang, codeContent),
            side: -1,
            block: true,
          }),
        });

        // Empty-state detection — the fence has zero content lines, or
        // exactly one blank content line. Either way, decorate the first
        // content line (or the closer if there is none) with the empty
        // class so the placeholder "// write code here" renders.
        const contentLineCount = toLine.number - fromLine.number - 1;
        const onlyBlank = contentLineCount === 1
          && doc.line(fromLine.number + 1).text.trim() === '';
        const isEmptyBlock = contentLineCount <= 0 || onlyBlank;

        // Line decorations for every line in the fence
        for (let ln = fromLine.number; ln <= toLine.number; ln++) {
          handled.add(ln);
          const line = doc.line(ln);
          const isFirst = ln === fromLine.number;
          const isLast  = ln === toLine.number;
          let cls = 'cm-md-fence-line';
          if (isFirst) cls += ' cm-md-fence-first';
          if (isLast)  cls += ' cm-md-fence-last';
          // Mark the (single) blank content line for the empty placeholder.
          if (isEmptyBlock && onlyBlank && ln === fromLine.number + 1) {
            cls += ' cm-md-fence-empty';
          }
          decos.push({
            pos: line.from,
            side: 0,
            block: false,
            deco: Decoration.line({ attributes: { class: cls } }),
          });
        }
      },
    });

    // Note: we intentionally do NOT render unclosed fences. Block widgets
    // that appear/disappear while the user is typing cause cursor jumps and
    // measure glitches. The fence snaps into place once the user types the
    // closing triple-backtick and the FencedCode node is parsed.

    // Sort: by position ascending, then block widgets (side -1) before
    // line decorations (side 0) at the same position. This is the ordering
    // CodeMirror's RangeSet expects.
    decos.sort((a, b) => {
      if (a.pos !== b.pos) return a.pos - b.pos;
      if (a.side !== b.side) return a.side - b.side;
      // block widgets come before inline at same pos+side
      if (a.block !== b.block) return a.block ? -1 : 1;
      return 0;
    });

    const ranges = decos.map(({ pos, deco }) => deco.range(pos, pos));
    return Decoration.set(ranges, true);
  }
}, { decorations: v => v.decorations });

// ---------------------------------------------------------------------------
// Active format detection (for toolbar highlighting)
// ---------------------------------------------------------------------------

function detectActiveFormats(state) {
  const formats = [];
  const sel = state.selection.main;
  const cursorLine = state.doc.lineAt(sel.head);
  const lineText = cursorLine.text;

  // Heading
  if (/^# /.test(lineText)) formats.push('h1');
  if (/^## /.test(lineText)) formats.push('h2');
  if (/^### /.test(lineText)) formats.push('h3');

  // Blockquote
  if (/^> /.test(lineText)) formats.push('blockquote');

  // Bullet list
  if (/^[\\-*] /.test(lineText)) formats.push('bullet-list');

  // Ordered list
  if (/^\\d+\\. /.test(lineText)) formats.push('numbered-list');

  // Inline checks around cursor
  const textBefore = cursorLine.text.slice(0, sel.head - cursorLine.from);
  const boldCount = (textBefore.match(/\\*\\*/g) || []).length;
  if (boldCount % 2 === 1) formats.push('bold');

  const codeCount = (textBefore.match(/\`/g) || []).length;
  if (codeCount % 2 === 1) formats.push('code-inline');

  const strikeCount = (textBefore.match(/~~/g) || []).length;
  if (strikeCount % 2 === 1) formats.push('strikethrough');

  return formats;
}

// ---------------------------------------------------------------------------
// Format command application
// ---------------------------------------------------------------------------

function applyFormat(view, command) {
  const state = view.state;
  const sel = state.selection.main;
  const doc = state.doc;

  if (command === 'undo') {
    undo(view);
    post({ type: 'command-applied' });
    return;
  }
  if (command === 'redo') {
    redo(view);
    post({ type: 'command-applied' });
    return;
  }

  const line = doc.lineAt(sel.head);
  const lineText = line.text;
  const selectedText = doc.sliceString(sel.from, sel.to);

  let changes = null;

  // Line-level prefixes
  const linePrefixMap = {
    'h1': '# ',
    'h2': '## ',
    'h3': '### ',
    'blockquote': '> ',
    'bullet-list': '- ',
    'numbered-list': '1. ',
  };

  if (linePrefixMap[command]) {
    const prefix = linePrefixMap[command];
    if (lineText.startsWith(prefix)) {
      // Toggle off
      changes = { from: line.from, to: line.from + prefix.length, insert: '' };
    } else {
      // Remove any existing prefix first, then add new one
      const existingPrefixMatch = lineText.match(/^(#{1,3} |> |- |\\d+\\. )/);
      if (existingPrefixMatch) {
        changes = { from: line.from, to: line.from + existingPrefixMatch[0].length, insert: prefix };
      } else {
        changes = { from: line.from, to: line.from, insert: prefix };
      }
    }
  }

  // Code block — inserts a GitHub-style fenced block whose resulting text
  // is byte-identical to what a user would type manually (parity guarantee:
  // the surrounding parse produces a FencedCode node at the expected span).
  //
  // Edge cases handled:
  //   - cursor at start of doc / start of line   → no leading newline
  //   - cursor mid-line                          → leading newline splits the line
  //   - cursor at end of line / end of doc       → no trailing newline
  //   - selection wraps existing text            → that text becomes the body
  //   - selection body ends with \\n             → strip one trailing \\n to avoid
  //                                                a double blank line before closer
  //   - selection body contains triple backticks → we still emit the fence; caller
  //                                                gets the same output a manual
  //                                                paste would produce. Flagged for QA.
  if (command === 'code-block') {
    const atLineStart = sel.from === line.from;
    const endLine = doc.lineAt(sel.to);
    const atLineEnd = sel.to === endLine.to;
    const leadingBreak = atLineStart ? '' : '\\n';
    const trailingBreak = atLineEnd ? '' : '\\n';

    // Normalize the body: strip at most one trailing newline so we don't
    // produce a spurious blank line between body and closer when the user's
    // selection happened to include the line terminator.
    let body = selectedText || '';
    if (body.endsWith('\\n')) body = body.slice(0, -1);

    const opening = '\`\`\`';
    const closing = '\`\`\`';
    // Opening fence, body (or blank), closing fence — each on its own line.
    // The insertion always contains: opener\\nBODY\\ncloser so the markdown
    // parser sees a closed FencedCode node identical to manual entry.
    const fence = leadingBreak + opening + '\\n' + body + '\\n' + closing + trailingBreak;

    // Cursor position:
    //   - empty selection  → just after the opening backticks, ready for
    //                        the user to type the language identifier.
    //   - non-empty wrap  → at the end of the inserted body so the user
    //                        can continue typing inside the fence.
    const openerEnd = sel.from + leadingBreak.length + opening.length;
    const bodyStart = openerEnd + 1; // after the \\n that ends the opener line
    const cursorPos = body.length === 0
      ? openerEnd
      : bodyStart + body.length;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: fence },
      selection: { anchor: cursorPos },
    });
    post({ type: 'command-applied' });
    return;
  }

  // Inline wrappers
  const inlineWrapMap = {
    'bold': '**',
    'italic': '_',
    'strikethrough': '~~',
    'code-inline': '\`',
  };

  if (inlineWrapMap[command]) {
    const wrap = inlineWrapMap[command];
    // Toggle: if selection is already wrapped, unwrap
    const before = doc.sliceString(Math.max(0, sel.from - wrap.length), sel.from);
    const after = doc.sliceString(sel.to, Math.min(doc.length, sel.to + wrap.length));
    if (before === wrap && after === wrap) {
      view.dispatch({
        changes: [
          { from: sel.from - wrap.length, to: sel.from, insert: '' },
          { from: sel.to, to: sel.to + wrap.length, insert: '' },
        ],
      });
      post({ type: 'command-applied' });
      return;
    }
    const wrapped = wrap + (selectedText || '') + wrap;
    // Cursor lands between the two wrap markers when selection was empty,
    // or just after the closing marker when text was selected.
    const cursorPos = selectedText.length === 0
      ? sel.from + wrap.length
      : sel.from + wrapped.length;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: wrapped },
      selection: { anchor: cursorPos },
    });
    post({ type: 'command-applied' });
    return;
  }

  // Link
  if (command === 'link') {
    const linkText = selectedText || 'link text';
    changes = { from: sel.from, to: sel.to, insert: '[' + linkText + '](url)' };
  }

  if (changes) {
    view.dispatch({ changes });
  }

  post({ type: 'command-applied' });
}

// ---------------------------------------------------------------------------
// Height reporter
// ---------------------------------------------------------------------------

let lastReportedHeight = 0;
function reportHeight() {
  const h = document.body.scrollHeight;
  if (h !== lastReportedHeight) {
    lastReportedHeight = h;
    post({ type: 'height', height: h });
  }
}

// ---------------------------------------------------------------------------
// Build the editor
// ---------------------------------------------------------------------------

// Compartment holding the readOnly extension so it can be reconfigured
// on the fly via set-readonly messages.
const readOnlyCompartment = new Compartment();

// Hide the loading banner now that the module has executed
const statusEl = document.getElementById('status');
if (statusEl) statusEl.remove();

const view = new EditorView({
  parent: document.getElementById('editor'),
  state: EditorState.create({
    doc: '',
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({
        base: markdownLanguage,
        // Static language list. codeLanguages accepts either an array or
        // a resolver function — the array form matches info strings against
        // each LanguageDescription's name + aliases automatically.
        codeLanguages: codeLanguageList,
      }),
      syntaxHighlighting(graphiteHighlight),
      placeholder('Start writing...'),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      livePreviewPlugin,
      fencePlugin,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const value = update.state.doc.toString();
          post({ type: 'change', value });
          reportHeight();
        }
        if (update.selectionSet || update.docChanged) {
          const formats = detectActiveFormats(update.state);
          post({ type: 'active-formats', formats });
        }
      }),
      EditorView.theme({
        '&': { background: 'transparent' },
        '.cm-scroller': { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
      }),
    ],
  }),
});

// ---------------------------------------------------------------------------
// Message bridge
// ---------------------------------------------------------------------------

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'set-value': {
      const current = view.state.doc.toString();
      if (current !== msg.value) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: msg.value },
        });
      }
      break;
    }
    case 'apply-format':
      applyFormat(view, msg.command);
      break;
    case 'focus':
      view.focus();
      break;
    case 'set-readonly': {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          EditorState.readOnly.of(!!msg.readonly)
        ),
      });
      break;
    }
  }
});

// ResizeObserver for dynamic height
const ro = new ResizeObserver(() => reportHeight());
ro.observe(document.body);

// Auto-focus the editor so the user can start typing immediately
view.focus();

// Initial height report so the parent iframe sizes correctly
reportHeight();

// Signal ready
post({ type: 'ready' });
</script>
</body>
</html>`;
}
