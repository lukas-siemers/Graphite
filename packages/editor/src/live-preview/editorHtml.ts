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

  /* ── Fenced code blocks ── */
  .cm-md-fence-line  { background: #141414; font-family: 'Courier New', monospace; font-size: 14px; color: #FFB347; }
  .cm-md-fence-first { background: #141414; color: #555558; font-size: 10px; letter-spacing: 0.8px; text-transform: uppercase; padding-top: 8px; }
  .cm-md-fence-last  { background: #141414; padding-bottom: 8px; }

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
import { EditorState, Compartment, RangeSetBuilder } from 'https://esm.sh/@codemirror/state@6';
import {
  EditorView,
  ViewPlugin,
  Decoration,
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
import { syntaxTree } from 'https://esm.sh/@codemirror/language@6';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg) {
  window.parent.postMessage(msg, '*');
}

// ---------------------------------------------------------------------------
// Live-preview decorations plugin
// ---------------------------------------------------------------------------

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
    const builder = new RangeSetBuilder();
    const doc = view.state.doc;
    const selection = view.state.selection.main;

    // Collect all decorations first, then add them sorted
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

        // Fenced code blocks — style each line
        if (name === 'FencedCode') {
          let lineNum = doc.lineAt(from).number;
          const lastLineNum = doc.lineAt(to).number;
          while (lineNum <= lastLineNum) {
            const line = doc.line(lineNum);
            const cls = lineNum === doc.lineAt(from).number
              ? 'cm-md-fence-first'
              : lineNum === lastLineNum
              ? 'cm-md-fence-last'
              : 'cm-md-fence-line';
            decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }) });
            lineNum++;
          }
        }
      },
    });

    // Sort by position (line decorations first within same range to avoid overlap errors)
    decos.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      // Line decorations (from===to) before mark decorations
      const aIsLine = a.from === a.to;
      const bIsLine = b.from === b.to;
      if (aIsLine && !bIsLine) return -1;
      if (!aIsLine && bIsLine) return 1;
      return a.to - b.to;
    });

    for (const { from, to, deco } of decos) {
      builder.add(from, to, deco);
    }

    return builder.finish();
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

  // Code block
  if (command === 'code-block') {
    const fence = '\`\`\`\\n' + (selectedText || '') + '\\n\`\`\`';
    changes = { from: sel.from, to: sel.to, insert: fence };
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
    const wrapped = wrap + (selectedText || '') + wrap;
    // Toggle: if selection is already wrapped, unwrap
    const before = doc.sliceString(Math.max(0, sel.from - wrap.length), sel.from);
    const after = doc.sliceString(sel.to, Math.min(doc.length, sel.to + wrap.length));
    if (before === wrap && after === wrap) {
      changes = [
        { from: sel.from - wrap.length, to: sel.from, insert: '' },
        { from: sel.to, to: sel.to + wrap.length, insert: '' },
      ];
    } else {
      changes = { from: sel.from, to: sel.to, insert: wrapped };
    }
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
      markdown({ base: markdownLanguage }),
      placeholder('Start writing...'),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      livePreviewPlugin,
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
