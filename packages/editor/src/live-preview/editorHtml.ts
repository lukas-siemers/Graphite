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
  // Markdown token styling — applied by the markdown extension to the
  // tokens it parses (headings, emphasis, strong, links, etc.) including
  // content nested inside fenced code blocks.
  { tag: t.heading1,                                                         color: '#FFFFFF', fontWeight: '700' },
  { tag: t.heading2,                                                         color: '#FFFFFF', fontWeight: '700' },
  { tag: t.heading3,                                                         color: '#FFFFFF', fontWeight: '600' },
  { tag: t.strong,                                                           color: '#FFFFFF', fontWeight: '700' },
  { tag: t.emphasis,                                                         fontStyle: 'italic' },
  { tag: t.strikethrough,                                                    color: '#8A8F98', textDecoration: 'line-through' },
  { tag: t.link,                                                             color: '#F28500', textDecoration: 'underline' },
  { tag: t.url,                                                              color: '#F28500' },
  { tag: t.monospace,                                                        color: '#FFB347' },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg) {
  window.parent.postMessage(msg, '*');
}

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
      // Ensure the newly inserted fence is actually visible. Without this,
      // inserting a block near the viewport edge (or via toolbar when the
      // cursor was just off-screen) could leave the user staring at the old
      // viewport with no visible change — which reads as "the button did
      // nothing".
      effects: EditorView.scrollIntoView(cursorPos, { y: 'center' }),
    });
    // Re-focus so the user can immediately type the language identifier.
    view.focus();
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

