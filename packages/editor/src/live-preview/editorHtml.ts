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
 *   { type: 'enable-block-heights' }   // opt-in for SpatialCanvasRenderer
 *
 * iframe → parent messages:
 *   { type: 'ready' }
 *   { type: 'change', value: string }
 *   { type: 'active-formats', formats: string[] }
 *   { type: 'height', height: number }
 *   { type: 'command-applied' }
 *   { type: 'block-heights', blocks: Array<{ lineStart, lineEnd, height }> }
 */
// Build 81: CodeMirror 6 is now bundled locally via scripts/bundle-cm6.mjs
// and inlined into the editor HTML as a single <script> tag. The previous
// `import { ... } from 'https://esm.sh/...'` approach worked in Expo Go's
// WebView but silently failed in TestFlight/standalone WKWebView — the
// editor never initialized, no placeholder, no input. CM6_BUNDLE is a
// minified IIFE (~800KB) that attaches `window.CM6` before the editor
// setup code runs.
//
// Build 82: this file still produces the inline-bundle HTML used by the
// web iframe (srcdoc can't resolve relative <script src>). The native
// WebView now uses editor-shell.ts which loads the bundle from a
// sibling file — see that file's header for the rationale.
import { CM6_BUNDLE } from './editor-runtime-string.generated';

export const EDITOR_CSS = `
  /* Build 82: Google Fonts @import removed. The remote stylesheet fetch
     added a runtime network dependency that could stall editor bootstrap
     in TestFlight / standalone WKWebView. System fonts below cover both
     body and monospace on iOS/macOS natively. */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: transparent;
    color: #DCDDDE;
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif;
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

  /* ── Fenced code block live preview ── */
  /* Idle state — the "finished" look. Clean, developer-tool aesthetic.
     Background matches bgSidebar (#252525). Width is driven at runtime by
     the fenceStylePlugin: it measures each line's scrollWidth in a
     requestMeasure pass and sets min-width on every line of a fence to
     the max of its siblings, producing one rectangular block whose right
     edge matches the widest line. white-space:pre keeps long lines from
     wrapping — they overflow horizontally up to the max-width cap. */
  .cm-fence-line {
    background: #252525;
    font-family: 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 13.5px;
    line-height: 20px;
    padding-left: 16px !important;
    padding-right: 16px !important;
    border-left: 1px solid #333;
    border-right: 1px solid #333;
    max-width: 100%;
    white-space: pre;
  }
  /* Body-line top/bottom borders — these sit on the first and last actual
     code content lines (NOT the fence marker lines), because in idle state
     the marker lines collapse to zero height and can't carry borders. */
  .cm-fence-body-first {
    padding-top: 6px !important;
    border-top: 1px solid #333;
  }
  .cm-fence-body-last {
    padding-bottom: 8px !important;
    border-bottom: 1px solid #333;
  }

  /* The opening/closing triple-backtick lines in idle state:
     characters stay in the flow (never hidden) but collapse to zero visual
     height. No display:none, no visibility:hidden — the line element stays
     addressable by cursor position, only its visual box is zeroed out.
     When the user clicks into the fence the .cm-fence-editing modifier is
     added and the companion rules below restore normal sizing. */
  .cm-fence-line.cm-fence-first:not(.cm-fence-editing),
  .cm-fence-line.cm-fence-last:not(.cm-fence-editing) {
    height: 0 !important;
    min-height: 0 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    font-size: 0 !important;
    line-height: 0 !important;
    overflow: hidden !important;
  }
  .cm-fence-line.cm-fence-first:not(.cm-fence-editing) {
    border-top-width: 0 !important;
  }
  .cm-fence-line.cm-fence-last:not(.cm-fence-editing) {
    border-bottom-width: 0 !important;
  }

  /* Editing state — the "raw markdown" look. One step brighter than idle
     (bgHover #2C2C2C vs bgSidebar #252525) to signal edit mode, fence
     markers at normal font size. Selectors match the specificity of the
     idle rules above (.cm-fence-line.cm-fence-first) so they reliably
     override them when .cm-fence-editing is present. */
  .cm-fence-line.cm-fence-editing {
    background: #2C2C2C;
  }
  .cm-fence-line.cm-fence-first.cm-fence-editing,
  .cm-fence-line.cm-fence-last.cm-fence-editing {
    height: auto !important;
    min-height: 0 !important;
    font-size: 13.5px !important;
    line-height: 20px !important;
    padding-top: 6px !important;
    padding-bottom: 6px !important;
    color: #8A8F98;
    opacity: 1;
    overflow: visible !important;
    border-top: 1px solid #333 !important;
    border-bottom: 1px solid #333 !important;
  }

  /* ── Fence copy-button overlay ──
     Plain DOM container appended to .cm-scroller. NOT a CodeMirror widget
     and NOT part of CM's decoration/measurement system — this sidesteps
     every cursor-jump and vanishing-character issue we had with the old
     FenceHeaderWidget. The container is pointer-events:none so clicks
     pass through to the code lines; only the buttons themselves are
     clickable. Each button is absolutely positioned in scroller-local
     coordinates (see scheduleOverlayMeasure in fenceStylePlugin). */
  .cm-fence-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 5;
  }
  .cm-fence-copy-btn {
    position: absolute;
    pointer-events: auto;
    font-family: 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: #FFB347;
    background: #252525;
    border: 1px solid #333;
    border-radius: 0;
    padding: 4px 8px;
    cursor: pointer;
    user-select: none;
    line-height: 12px;
    z-index: 6;
    transition: background 80ms ease, color 80ms ease;
  }
  .cm-fence-copy-btn:hover {
    background: #2C2C2C;
  }
  .cm-fence-copy-btn:active {
    background: #141414;
  }
  .cm-fence-copy-btn--copied {
    color: #A8D060;
    border-color: #A8D060;
  }
  .cm-fence-copy-btn--hidden {
    display: none;
  }

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
`;

/**
 * Pre-CM6 scaffold. Sets up error surfacing and posts the first boot phase
 * marker. Runs BEFORE the CM6 runtime script so that if the runtime itself
 * fails to load the host still sees phase 1.
 */
export const EDITOR_PRE_RUNTIME_SCRIPT = `
// Build 84: universal host-post helper. On native (WKWebView) window.parent
// is a read-only getter returning the same window, and BRIDGE_SHIM's
// Object.defineProperty override silently fails — so window.parent.postMessage
// goes into the void. Prefer ReactNativeWebView.postMessage when available
// (native) and fall back to window.parent.postMessage for the web iframe.
function postToHost(msg) {
  try {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
      return;
    }
  } catch (_) {}
  try { window.parent.postMessage(msg, '*'); } catch (_) {}
}

// Global error surfacing — any script failure shows inline + posts to parent
function reportError(err) {
  const el = document.getElementById('status');
  if (el) {
    el.className = 'error';
    el.textContent = 'Editor failed to load: ' + (err && err.message ? err.message : String(err));
  }
  postToHost({ type: 'error', message: String(err && err.stack || err) });
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

// Build 82: bootstrap phase markers. Each major step posts a 'phase' message
// so the host can pinpoint where boot stalls in production. The host RN
// timeout banner reports the last phase reached when the ready handshake
// never arrives.
function postPhase(phase, label) {
  postToHost({ type: 'phase', phase: phase, label: label });
}
postPhase(1, 'html-parsed');
`;

/**
 * App bootstrap script. Runs AFTER the CM6 runtime has attached
 * `window.CM6`. This is the entire editor setup: destructure CM6, define
 * the highlight style, fence plugin, block-heights plugin, build the
 * EditorView, install the message bridge.
 */
export const EDITOR_BOOTSTRAP_SCRIPT = `
// Build 82: phase 2 — the CM6 bundle <script> has executed.
postPhase(2, 'cm6-bundle-executed');
if (!window.CM6) {
  postToHost({ type: 'error', message: 'CM6 bundle ran but window.CM6 is undefined' });
}

// Destructure everything from the window.CM6 namespace that the bundle above
// installs. The names match what we previously imported from esm.sh so the
// rest of the editor setup code below is unchanged. If CM6 is missing here
// the bundle failed to load — surface that to the host and bail.
if (!window.CM6) {
  reportError('CM6 bundle did not attach to window — editor cannot start');
  throw new Error('CM6 bundle missing');
}
const {
  EditorState, Compartment,
  EditorView, keymap, placeholder, ViewPlugin, Decoration,
  defaultKeymap, history, historyKeymap, undo, redo, indentWithTab,
  markdown, markdownLanguage,
  HighlightStyle, syntaxHighlighting, LanguageDescription, LanguageSupport, StreamLanguage, syntaxTree,
  t,
  python, javascript, cpp, rust, java, htmlLang, cssLang, jsonLang, sql,
  csharp, kotlin, scala, objectiveC, shell, goMode, ruby, lua, yamlMode, tomlMode, swift,
} = window.CM6;
// Build 82: phase 3 — namespace destructure succeeded.
postPhase(3, 'cm6-destructured');

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
  // Build 84: route through the universal host-post helper defined in
  // EDITOR_PRE_RUNTIME_SCRIPT. On native WKWebView window.parent redirects
  // don't work, so direct ReactNativeWebView.postMessage is required.
  postToHost(msg);
}

// Shared clipboard writer. Used by the copy-code-block command and by the
// per-fence overlay COPY buttons. Promise-based with a textarea fallback
// for environments where navigator.clipboard is unavailable.
function writeClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (err) { reject(err); }
  });
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

  // In-fence detection: walk backwards counting lines that start a fence
  // marker. An odd count means the cursor is inside an unclosed fence. This
  // is cheaper than walking the syntax tree and avoids a syntaxTree import
  // in the detect path. The regex literal below must render at runtime as
  // /^\\s*\`\`\`/ — inside the outer template literal each backtick is
  // escaped as \\\`.
  const cursorLineNum = cursorLine.number;
  let fenceCount = 0;
  for (let i = 1; i < cursorLineNum; i++) {
    if (/^\\s*\`\`\`/.test(state.doc.line(i).text)) fenceCount++;
  }
  if (fenceCount % 2 === 1) formats.push('in-fence');

  return formats;
}

// ---------------------------------------------------------------------------
// Format command application
// ---------------------------------------------------------------------------

// Walk every line of the document, collect those whose text starts with a
// triple backtick, and pair them up as (opener, closer), (opener, closer)…
// If \`pos\` falls inside any such pair (inclusive of the opener and closer
// lines themselves — defensive for cursor-on-marker-line), return that pair.
// Otherwise return null.
//
// Pairing by document order (not by nesting) matches the CommonMark rule
// that fenced code blocks cannot nest: the first \`\`\` after an opener is
// always its closer. This keeps the helper O(n) in document lines and means
// we don't need a parser hook.
function findEnclosingFence(doc, pos) {
  const fenceLines = [];
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    if (/^\`\`\`/.test(l.text)) fenceLines.push(l);
  }
  for (let i = 0; i + 1 < fenceLines.length; i += 2) {
    const opener = fenceLines[i];
    const closer = fenceLines[i + 1];
    if (pos >= opener.from && pos <= closer.to) {
      return { openerLine: opener, closerLine: closer };
    }
  }
  return null;
}

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
    // Toggle-off: if the caret is already inside a fenced code block (or
    // defensively on the opener/closer marker line itself), unwrap the
    // fence instead of inserting a new one. Without this, the Code toolbar
    // button would insert a broken nested fence inside the current block.
    const enclosing = findEnclosingFence(doc, sel.head);
    if (enclosing) {
      const { openerLine, closerLine } = enclosing;
      // Replace the entire fence span [opener.from, closer.to) with just
      // the body text (lines strictly between opener and closer, joined
      // by \\n). Empty body → insertion is the empty string, which
      // collapses the whole fence to a single empty line when it was the
      // only content, or removes it cleanly when surrounded by other text.
      const bodyStart = openerLine.to + 1; // first char of first body line
      const bodyEnd = closerLine.from - 1; // last \\n before closer
      const body = bodyEnd >= bodyStart ? doc.sliceString(bodyStart, bodyEnd) : '';

      // Cursor mapping: line N inside the fence (N = 0 = opener line,
      // 1 = first body line, …) maps to line N-1 of the unwrapped body.
      // Implementation: clamp the original head to the body span, then
      // translate by (opener.from - bodyStart).
      let newHead;
      if (bodyEnd < bodyStart) {
        // Empty fence — no body. Cursor lands at the start of the (now
        // collapsed) fence region.
        newHead = openerLine.from;
      } else {
        const clamped = Math.min(Math.max(sel.head, bodyStart), bodyEnd);
        newHead = openerLine.from + (clamped - bodyStart);
      }

      view.dispatch({
        changes: { from: openerLine.from, to: closerLine.to, insert: body },
        selection: { anchor: newHead },
        effects: EditorView.scrollIntoView(newHead, { y: 'center' }),
      });
      view.focus();
      post({ type: 'command-applied' });
      return;
    }

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

  // Copy the body of the fence surrounding the cursor to the clipboard.
  // Walks outward from the current line to find the opener and closer fence
  // marker lines, joins everything strictly between them, and writes to the
  // clipboard. Posts an error message if the cursor is not inside a fence.
  if (command === 'copy-code-block') {
    const fenceRe = /^\\s*\`\`\`/;
    const totalLines = doc.lines;
    const currentLineNum = line.number;
    // Find opener: walk backwards from current line until we hit a fence
    // marker line.
    let openerLine = -1;
    for (let i = currentLineNum; i >= 1; i--) {
      if (fenceRe.test(doc.line(i).text)) { openerLine = i; break; }
    }
    if (openerLine === -1) {
      post({ type: 'error', message: 'Not inside a code block' });
      return;
    }
    // Find closer: first fence marker line after the opener. Falls through
    // to EOF when the fence is unclosed (we still copy whatever body exists).
    let closerLine = totalLines + 1;
    for (let i = openerLine + 1; i <= totalLines; i++) {
      if (fenceRe.test(doc.line(i).text)) { closerLine = i; break; }
    }
    const bodyLines = [];
    for (let i = openerLine + 1; i < closerLine; i++) {
      bodyLines.push(doc.line(i).text);
    }
    const body = bodyLines.join('\\n');
    // writeClipboard is a shared helper hoisted above applyFormat — used
    // by both this command and the per-fence overlay COPY buttons. The
    // drift-guard test asserts navigator.clipboard.writeText and
    // document.execCommand('copy') are still referenced in this source
    // file, which remains true via the helper.
    Promise.resolve(writeClipboard(body)).then(
      () => post({ type: 'command-applied' }),
      (err) => post({ type: 'error', message: 'Copy failed: ' + (err && err.message || err) })
    );
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
// Block-heights plugin — opt-in spatial block measurement.
//
// Splits the document into blank-line-delimited text blocks (headings always
// start a new block, matching the chunker in @graphite/canvas) and measures
// each block's rendered pixel height via DOM Range. Posts
//   { type: 'block-heights', blocks: [{ lineStart, lineEnd, height }] }
// to the parent whenever the boundaries or measured heights change.
//
// Dormant by default to avoid paying the layout cost for the legacy editor
// screen. The parent opts in by posting { type: 'enable-block-heights' }.
//
// Implementation mirrors the fenceStylePlugin measurement pattern:
//   update() -> scheduleMeasure() -> view.requestMeasure({ read, write })
// The read phase uses DOM Range on each line's rendered element to sum line
// heights. The write phase compares against a cached signature and posts
// only on real change — cheap for pure selection updates.
// ---------------------------------------------------------------------------

let blockHeightsEnabled = false;
// View reference captured once the editor is built. Used by the
// 'enable-block-heights' message handler to trigger an immediate
// measurement pass instead of waiting for the next doc/viewport change.
let capturedView = null;
function enableBlockHeights() {
  blockHeightsEnabled = true;
  // The plugin's scheduleMeasure guards on blockHeightsEnabled, so the
  // next update will naturally flush. For immediate feedback at enable
  // time we also schedule one pass right now.
  if (capturedView && capturedView.plugin) {
    const inst = capturedView.plugin(blockHeightsPlugin);
    if (inst) inst.scheduleMeasure(capturedView);
  }
}

function computeBlockBoundaries(doc) {
  // Returns [{ lineStart, lineEnd }] using the same rules as
  // chunksFromMarkdown in @graphite/canvas: blank lines split, headings
  // force a boundary, fenced code blocks are never split.
  const blocks = [];
  const total = doc.lines;
  const fenceRe = /^(\\s{0,3})(\`{3,}|~{3,})/;
  const headingRe = /^\\s{0,3}#{1,6}\\s/;
  let cur = null; // { lineStart, lineEnd }
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  const flush = () => {
    if (cur) { blocks.push(cur); cur = null; }
  };
  for (let n = 1; n <= total; n++) {
    const text = doc.line(n).text;
    if (inFence) {
      if (!cur) cur = { lineStart: n, lineEnd: n };
      cur.lineEnd = n;
      const m = text.match(fenceRe);
      if (m && m[2][0] === fenceChar && m[2].length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        flush();
      }
      continue;
    }
    const fenceOpen = text.match(fenceRe);
    if (fenceOpen) {
      flush();
      inFence = true;
      fenceChar = fenceOpen[2][0];
      fenceLen = fenceOpen[2].length;
      cur = { lineStart: n, lineEnd: n };
      continue;
    }
    if (text.trim() === '') { flush(); continue; }
    if (headingRe.test(text)) {
      flush();
      blocks.push({ lineStart: n, lineEnd: n });
      continue;
    }
    if (!cur) cur = { lineStart: n, lineEnd: n };
    else cur.lineEnd = n;
  }
  flush();
  return blocks;
}

const blockHeightsPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.lastSignature = '';
      this.lastEmitted = '';
      this.scheduleMeasure(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.scheduleMeasure(update.view);
      }
    }
    scheduleMeasure(view) {
      if (!blockHeightsEnabled) return;
      view.requestMeasure({
        read: () => {
          const doc = view.state.doc;
          const boundaries = computeBlockBoundaries(doc);
          // Measure each block's height by summing the getBoundingClientRect
          // of its contained line elements. Falls back to defaultLineHeight
          // (via view.defaultLineHeight) when a line is outside the rendered
          // viewport — CM only mounts lines inside visibleRanges, so blocks
          // below the fold may not have a DOM node yet.
          const defaultLH = view.defaultLineHeight || 24;
          const measured = boundaries.map((b) => {
            let h = 0;
            for (let ln = b.lineStart; ln <= b.lineEnd; ln++) {
              const linePos = doc.line(ln).from;
              let nodeRect = null;
              try {
                const coords = view.coordsAtPos(linePos);
                if (coords) {
                  // coordsAtPos gives top/bottom of the line box.
                  nodeRect = coords.bottom - coords.top;
                }
              } catch (_) { nodeRect = null; }
              h += (nodeRect && nodeRect > 0) ? nodeRect : defaultLH;
            }
            return { lineStart: b.lineStart, lineEnd: b.lineEnd, height: h };
          });
          const signature = measured
            .map((m) => m.lineStart + ':' + m.lineEnd + ':' + Math.round(m.height))
            .join('|');
          return { measured, signature };
        },
        write: ({ measured, signature }) => {
          if (!blockHeightsEnabled) return;
          if (signature === this.lastEmitted) return;
          this.lastEmitted = signature;
          post({ type: 'block-heights', blocks: measured });
        },
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Fence style plugin — Obsidian-style "finished vs editable" code blocks.
//
// Emits line decorations (no widgets, no replacements) that toggle CSS
// classes on each line of a FencedCode node. When the selection head is
// inside the fence, the "editing" modifier is added so the fence markers
// become normal size again; otherwise markers recede via CSS font-size.
// ---------------------------------------------------------------------------

function buildFenceDecorations(view, widthsById) {
  const ranges = [];
  // Signature captures fence identity + line ranges only (NOT the editing
  // flag). That way selection-only updates — which flip cm-fence-editing but
  // don't change geometry — don't force a re-measure.
  const sigParts = [];
  // Per-fence metadata collected during the walk. The overlay button pass
  // (see scheduleOverlayMeasure) consumes this to know which fences exist,
  // what text they contain, and whether each is currently in editing state.
  const fences = [];
  const head = view.state.selection.main.head;
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode') return;
        const editing = head >= node.from && head <= node.to;
        const startLine = view.state.doc.lineAt(node.from).number;
        const endLine = view.state.doc.lineAt(node.to).number;
        // Extract the body text (lines strictly between opener and closer)
        // for the per-fence overlay COPY button. Cheap — just a slice of
        // doc lines we already have a hot pointer to.
        const bodyParts = [];
        for (let ln = startLine + 1; ln <= endLine - 1; ln++) {
          bodyParts.push(view.state.doc.line(ln).text);
        }
        fences.push({
          id: String(startLine),
          startLine,
          endLine,
          fromPos: node.from,
          editing,
          body: bodyParts.join('\\n'),
        });
        // Fence id = opener line number. Stable within a single build and
        // sufficient to group sibling .cm-fence-line elements in the DOM.
        const fenceId = String(startLine);
        sigParts.push(startLine + ':' + endLine);
        // Body lines are the lines strictly between the opener and closer.
        // We tag the first and last body lines specifically so CSS can paint
        // the top/bottom borders there — in idle state the marker lines
        // collapse to zero height and cannot carry borders themselves.
        const bodyFirst = startLine + 1;
        const bodyLast = endLine - 1;
        // Previously-measured width for this fence. Embedding it directly
        // in the decoration's style attribute means newly-created lines
        // (from pressing Enter, splitting a line, etc.) render at the
        // correct width immediately — without a one-frame flash at full
        // parent width while the async requestMeasure catches up.
        const cachedWidth = widthsById.get(fenceId) || 0;
        for (let ln = startLine; ln <= endLine; ln++) {
          const line = view.state.doc.line(ln);
          const classes = ['cm-fence-line'];
          if (ln === startLine) classes.push('cm-fence-first');
          if (ln === endLine) classes.push('cm-fence-last');
          if (ln === bodyFirst && bodyFirst <= bodyLast) classes.push('cm-fence-body-first');
          if (ln === bodyLast && bodyFirst <= bodyLast) classes.push('cm-fence-body-last');
          if (editing) classes.push('cm-fence-editing');
          const attrs = {
            class: classes.join(' '),
            'data-fence-id': fenceId,
          };
          if (cachedWidth > 0) {
            attrs.style = 'width:' + cachedWidth + 'px';
          }
          ranges.push(
            Decoration.line({ attributes: attrs }).range(line.from)
          );
        }
      },
    });
  }
  return {
    decorations: Decoration.set(ranges, true),
    signature: sigParts.join('|'),
    fences,
  };
}

const fenceStylePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      // Map<fenceId, measured pixel width> — persists across updates so
      // newly-created lines can be rendered at the correct width the
      // moment they enter the DOM, eliminating the Enter-key flicker.
      this.widthsById = new Map();
      // Per-fence overlay state.
      // buttonsById : Map<fenceId, HTMLButtonElement> for O(1) reuse
      // bodiesById  : Map<fenceId, string> — latest body text (closure for click handler)
      // overlay    : <div class="cm-fence-overlay"> appended to scrollDOM
      this.buttonsById = new Map();
      this.bodiesById = new Map();
      this.overlay = document.createElement('div');
      this.overlay.className = 'cm-fence-overlay';
      view.scrollDOM.appendChild(this.overlay);
      const built = buildFenceDecorations(view, this.widthsById);
      this.decorations = built.decorations;
      this.signature = built.signature;
      this.fences = built.fences;
      this.lastMeasuredSignature = '';
      this.scheduleMeasure(view);
      this.scheduleOverlayMeasure(view);
    }
    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        const built = buildFenceDecorations(update.view, this.widthsById);
        this.decorations = built.decorations;
        this.signature = built.signature;
        this.fences = built.fences;
      }
      // Overlay needs to react to geometry, content, AND selection changes
      // (selection governs editing-state visibility of each button). It's
      // cheap — no layout reads until inside requestMeasure.
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
        this.scheduleOverlayMeasure(update.view);
      }
      // Gate measurement on geometry-affecting updates only. Pure
      // selectionSet flips cm-fence-editing (background only) and must NOT
      // trigger a measurement pass — that would thrash on every arrow key.
      // docChanged can change a line's content width; viewportChanged can
      // bring new fence lines into the DOM. Both warrant re-measuring.
      // Also re-measure if the signature ever drifts from what we last
      // wrote (covers the very first update after construction).
      if (
        update.docChanged ||
        update.viewportChanged ||
        this.signature !== this.lastMeasuredSignature
      ) {
        this.scheduleMeasure(update.view);
      }
    }
    scheduleMeasure(view) {
      const signatureAtSchedule = this.signature;
      view.requestMeasure({
        read: () => {
          // Measure the actual TEXT width of each fence line using a DOM
          // Range. We can't use el.scrollWidth here — .cm-fence-line is a
          // block-level element, so scrollWidth returns max(contentWidth,
          // clientWidth), and clientWidth is the parent's full width. That
          // makes every line "measure" as full-width and defeats the whole
          // purpose. A Range spanning the line's text content returns the
          // true rendered text width regardless of the element's box size.
          //
          // We also can't use min-width to constrain the line — block
          // elements default to width:auto which fills the parent, so
          // min-width only sets a floor and never prevents expansion. We
          // set style.width directly in the write phase to force the box
          // to exactly the measured value.
          //
          // Since box-sizing: border-box applies (from the reset), width
          // includes padding + border, so we add horizontal padding+border
          // to the measured text width. Values match CSS: 16+16 padding,
          // 1+1 border.
          const PADDING_AND_BORDER = 16 + 16 + 1 + 1;
          const nodes = view.dom.querySelectorAll(
            '.cm-fence-line[data-fence-id]'
          );
          const byId = new Map();
          // DO NOT clear el.style.width here. Range.getBoundingClientRect
          // measures the actual text glyphs, not the element box, so the
          // measurement is invariant to whatever width we set on the last
          // pass. Clearing would cause a visible full-width flicker
          // between read and write phases.
          for (const el of nodes) {
            const id = el.getAttribute('data-fence-id');
            const range = document.createRange();
            range.selectNodeContents(el);
            const rect = range.getBoundingClientRect();
            range.detach && range.detach();
            const textWidth = rect.width;
            // Empty (or collapsed marker) lines have textWidth 0 — skip
            // so they don't drag the max down. They're still included in
            // the visual block via the body-first/last borders.
            if (textWidth <= 0) continue;
            const w = textWidth + PADDING_AND_BORDER;
            const prev = byId.get(id) || 0;
            if (w > prev) byId.set(id, w);
          }
          return { byId, nodes };
        },
        write: ({ byId, nodes }) => {
          // Refresh the cache from the freshly-measured values and write
          // them imperatively to the current DOM nodes. The cache feeds
          // the next decoration build so newly-created lines get the
          // width embedded in their initial style attribute.
          let cacheChanged = false;
          for (const [id, max] of byId) {
            if (this.widthsById.get(id) !== max) {
              this.widthsById.set(id, max);
              cacheChanged = true;
            }
          }
          for (const el of nodes) {
            const id = el.getAttribute('data-fence-id');
            const max = byId.get(id);
            if (max && max > 0) {
              const target = max + 'px';
              if (el.style.width !== target) {
                el.style.width = target;
              }
            }
          }
          this.lastMeasuredSignature = signatureAtSchedule;
          // If the cache changed, the next decoration rebuild (on the
          // next update) will embed the new width in the style attribute.
          // We don't force a synchronous rebuild here because the current
          // DOM already has the correct width from the imperative write
          // above; the cache just needs to be in sync for the NEXT new
          // line creation.
          void cacheChanged;
        },
      });
    }

    // ---------------------------------------------------------------------
    // Per-fence COPY button overlay
    //
    // The overlay container is a plain <div> appended to view.scrollDOM
    // ONCE in the constructor. It is NOT a CodeMirror widget, decoration,
    // or replacement — CM has no knowledge of it. This is intentional:
    // the previous FenceHeaderWidget (Decoration.widget({ block: true }))
    // caused cursor jumps, measurement glitches, and vanishing characters
    // because it participated in CM's line-height/layout system. Plain
    // absolutely-positioned DOM elements inside the scroll container
    // scroll naturally with content and don't perturb layout at all.
    //
    // Lifecycle:
    //   - constructor: create overlay, schedule first measure
    //   - update:      on any doc/selection/viewport/geometry change, walk
    //                  this.fences (collected in buildFenceDecorations),
    //                  reuse existing buttons by fenceId, create missing
    //                  ones, remove stale ones.
    //   - destroy:     remove overlay and all button children.
    //
    // Position math: view.coordsAtPos(fromPos) returns viewport-relative
    // coords. To express them in scrollDOM-local coordinates (where the
    // overlay lives) we subtract scrollDOM.getBoundingClientRect() and
    // add scrollDOM.scrollTop/scrollLeft. The X position uses the cached
    // fence width (this.widthsById) so the button pins to the RIGHT edge
    // of the fence box, not the right edge of the scroll container.
    // ---------------------------------------------------------------------
    scheduleOverlayMeasure(view) {
      view.requestMeasure({
        read: () => {
          const fences = this.fences || [];
          const scrollRect = view.scrollDOM.getBoundingClientRect();
          const scrollTop = view.scrollDOM.scrollTop;
          const scrollLeft = view.scrollDOM.scrollLeft;
          // Find the left edge of .cm-content so the button's x anchor
          // tracks actual text, not the scroll container (which may have
          // gutters or padding).
          const contentEl = view.contentDOM;
          const contentRect = contentEl.getBoundingClientRect();
          const contentLeft = contentRect.left - scrollRect.left + scrollLeft;
          const positions = [];
          for (const f of fences) {
            let coords = null;
            try {
              coords = view.coordsAtPos(f.fromPos);
            } catch (_) { coords = null; }
            if (!coords) continue;
            const topInScroller = coords.top - scrollRect.top + scrollTop;
            const width = this.widthsById.get(f.id) || 0;
            positions.push({
              id: f.id,
              top: topInScroller,
              fenceWidth: width,
              contentLeft,
              editing: f.editing,
              body: f.body,
            });
          }
          return { positions };
        },
        write: ({ positions }) => {
          const BUTTON_MARGIN = 8;
          const TOP_INSET = 4;
          const seen = new Set();
          for (const p of positions) {
            seen.add(p.id);
            let btn = this.buttonsById.get(p.id);
            if (!btn) {
              btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'cm-fence-copy-btn';
              btn.textContent = 'COPY';
              btn.setAttribute('data-fence-id', p.id);
              btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                // Latest body lives on the button element itself (data
                // attribute) — avoids capturing a stale closure when the
                // fence contents change. We refresh it on every write pass.
                const body = this.bodiesById.get(p.id) || '';
                Promise.resolve(writeClipboard(body)).then(
                  () => {
                    btn.classList.add('cm-fence-copy-btn--copied');
                    const original = btn.textContent;
                    btn.textContent = 'COPIED';
                    setTimeout(() => {
                      btn.classList.remove('cm-fence-copy-btn--copied');
                      btn.textContent = original;
                    }, 1200);
                  },
                  (err) => post({ type: 'error', message: 'Copy failed: ' + (err && err.message || err) }),
                );
              });
              this.overlay.appendChild(btn);
              this.buttonsById.set(p.id, btn);
            }
            this.bodiesById.set(p.id, p.body);
            // Hide while the fence is being edited — copying mid-edit is
            // noisy and the button would overlap the caret target.
            if (p.editing) {
              btn.classList.add('cm-fence-copy-btn--hidden');
            } else {
              btn.classList.remove('cm-fence-copy-btn--hidden');
            }
            // Position: sit just OUTSIDE the fence box on the right side so
            // the button never covers the code text. If width hasn't been
            // measured yet (brand-new fence, one frame early), fall back to
            // contentLeft so the button is at least visible.
            const left = p.fenceWidth > 0
              ? p.contentLeft + p.fenceWidth + BUTTON_MARGIN
              : p.contentLeft + BUTTON_MARGIN;
            btn.style.top = (p.top + TOP_INSET) + 'px';
            btn.style.left = left + 'px';
          }
          // Remove stale buttons whose fence no longer exists (user deleted
          // it, or it scrolled out of the visible range).
          for (const [id, btn] of this.buttonsById) {
            if (!seen.has(id)) {
              btn.remove();
              this.buttonsById.delete(id);
              this.bodiesById.delete(id);
            }
          }
        },
      });
    }

    destroy() {
      // Tear down the overlay so it doesn't leak DOM nodes across editor
      // reloads. The plugin itself is GC'd by CM, but scrollDOM persists
      // if the whole editor is re-created inside the same iframe.
      for (const btn of this.buttonsById.values()) btn.remove();
      this.buttonsById.clear();
      this.bodiesById.clear();
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// ---------------------------------------------------------------------------
// Build the editor
// ---------------------------------------------------------------------------

// Compartment holding the readOnly extension so it can be reconfigured
// on the fly via set-readonly messages.
const readOnlyCompartment = new Compartment();

// Build 100: status div removal was moved to AFTER successful boot (see
// below, just before post({ type: 'ready' })). Previously the "Loading
// editor..." indicator was removed before new EditorView(...) ran, so any
// silent hang/throw in WKWebView's CM6 construction produced a completely
// blank screen with no visual breadcrumb. Now the status stays visible
// until we know boot fully succeeded.

// Build 82: phase 4 — about to construct the EditorView. If boot stalls
// here the crash is inside CM6 setup (extensions, plugins, initial state).
postPhase(4, 'constructing-editor-view');

// Build 104: guaranteed-valid parent resolution. On iPad WKWebView,
// react-native-webview fires injectedJavaScript at atDocumentEnd, but
// on iPad that can actually race with full HTML tree parsing — so
// document.getElementById('editor') can return null even though the
// shell HTML contains <div id="editor">. When null, CM6 silently
// creates a HEADLESS view (confirmed in @codemirror/view 6.26.0
// index.js line 7840: appendChild is skipped, no error, no warning;
// the view object is fully functional but view.dom lives in memory
// only, never in the page tree). This is Build 102's observed
// symptom exactly: phase 6 ready fires, toolbar commands work, but
// the editor is invisible and taps don't reach .cm-content.
//
// Fix: if #editor is missing at construction time, create it
// ourselves and append to document.body. Guarantees a valid, attached
// parent for CM6 regardless of HTML parse timing. Post phase 4.1 with
// the actual resolution path so the on-device pill confirms it.
var editorParent = document.getElementById('editor');
var parentStatus = 'parent-found';
if (!editorParent) {
  editorParent = document.createElement('div');
  editorParent.id = 'editor';
  if (document.body) {
    document.body.appendChild(editorParent);
    parentStatus = 'parent-created';
  } else {
    parentStatus = 'parent-no-body';
  }
}
postPhase(4.1, parentStatus);

// Capture the view so enableBlockHeights() can trigger an immediate
// measurement pass without waiting for the next CM update cycle.
const view = capturedView = new EditorView({
  parent: editorParent,
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
      fenceStylePlugin,
      blockHeightsPlugin,
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
        // Build 101 diagnostic: any time CM6 sees doc change, selection move,
        // or focus transition, ping the host so the on-device indicator can
        // surface a live input counter. If this stays at 0 after user taps,
        // CM6 is not receiving any input events — the failure is in
        // event plumbing between WKWebView and CM6's contentEditable.
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          post({ type: 'input-activity' });
        }
      }),
      // Build 109: dark editor theme with { dark: true } flag. Passing
      // dark:true as the second argument tells CM6 to merge this theme
      // with its DARK baseTheme defaults rather than the LIGHT ones,
      // which was the root cause of the white background surviving every
      // override attempt in Builds 105-108. CM6's baseTheme ships paired
      // light/dark variants; the { dark: true } flag flips the base
      // variant, so our overrides compose with dark defaults instead of
      // fighting light ones. Solid #131313 backgrounds (not transparent)
      // also dodge iPad WKWebView's opaque/transparent compositor skip.
      EditorView.theme({
        '&': {
          backgroundColor: '#131313',
          color: '#FFFFFF',
          fontSize: '16px',
          lineHeight: '24px',
          outline: 'none',
          border: 'none',
        },
        '&.cm-focused': {
          outline: 'none',
          boxShadow: 'none',
          border: 'none',
        },
        '.cm-scroller': {
          backgroundColor: '#131313',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        '.cm-content': {
          backgroundColor: '#131313',
          color: '#FFFFFF',
          caretColor: '#FF6A00',
          padding: '24px 0 48px 0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        },
        '.cm-cursor, .cm-cursor-primary': {
          borderLeftColor: '#FF6A00',
          borderLeftWidth: '3px',
        },
        '.cm-gutters': {
          backgroundColor: '#131313',
          border: 'none',
        },
        '.cm-line': {
          padding: '0',
        },
        '.cm-selectionBackground': {
          backgroundColor: 'rgba(242,133,0,0.25)',
        },
        '&.cm-focused .cm-selectionBackground': {
          backgroundColor: 'rgba(242,133,0,0.3)',
        },
        '.cm-placeholder': {
          color: '#8A8F98',
          fontStyle: 'italic',
        },
        '.cm-activeLine': {
          backgroundColor: '#131313',
        },
      }, { dark: true }),
    ],
  }),
});

// Build 104: defensive DOM attachment + forced measurement. Even though
// Build 104's parent-resolution step above already guarantees a valid
// parent, the CM6 constructor may still produce a detached view under
// race conditions — so we defensively re-check view.dom's attachment
// and append if needed. Then call view.requestMeasure() to force CM6's
// layout/paint cycle; on detached-then-attached views CM6 needs the
// explicit measure request to render the first frame.
try {
  var postAttachEditorEl = document.getElementById('editor') || editorParent;
  if (postAttachEditorEl && view && view.dom) {
    if (!postAttachEditorEl.contains(view.dom)) {
      postAttachEditorEl.appendChild(view.dom);
      postPhase(5.05, 'view-force-attached');
    } else {
      postPhase(5.05, 'view-already-attached');
    }
    // Force a measurement + paint pass now that view.dom is guaranteed
    // to be in the document tree.
    if (typeof view.requestMeasure === 'function') {
      view.requestMeasure();
    }
  } else {
    postPhase(5.05, 'editor-div-still-missing');
  }
} catch (e) {
  post({ type: 'error', message: 'attach:' + String(e && e.message || e) });
}

// Build 109: Build 108's post-CM6 style injection was REVERTED. That block
// appended a <style> element to document.head with a cm-editor * universal
// selector + background-color: transparent !important on every CM6
// descendant. It was meant to win source-order ties against CM6's
// late-injected baseTheme rules — but in practice it regressed the editor:
// user could no longer type after Build 108 shipped. The universal
// cm-editor * selector was too aggressive and appears to have broken
// something internal to CM6's contentEditable input pipeline. Dark theming
// is handled instead via EditorView.theme({...}, { dark: true }) above,
// which tells CM6 to apply its dark-theme baseline rather than the light
// default, and via the shell HTML's color-scheme:dark declaration.

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
    case 'enable-block-heights': {
      // Opt-in — turns the dormant block-heights plugin on. Idempotent:
      // re-enabling just requests another measurement pass so late
      // subscribers get an immediate snapshot.
      enableBlockHeights();
      break;
    }
  }
});

// ResizeObserver for dynamic height
const ro = new ResizeObserver(() => reportHeight());
ro.observe(document.body);

// Build 82: phase 5 — EditorView was constructed without throwing.
postPhase(5, 'editor-view-constructed');

// Auto-focus the editor so the user can start typing immediately
view.focus();

// Initial height report so the parent iframe sizes correctly
reportHeight();

// Build 100: now that EditorView is constructed, focused, and has reported
// an initial height, remove the "Loading editor…" status indicator. If boot
// stalled before this point the user sees the status message instead of a
// blank screen, which is a critical on-device diagnostic breadcrumb.
const statusEl = document.getElementById('status');
if (statusEl) statusEl.remove();

// Signal ready (phase 6, implicitly)
post({ type: 'ready' });
`;

/**
 * Web-side HTML builder. Inlines the CM6 runtime bundle directly into the
 * HTML as one giant <script> tag because the web iframe is loaded via
 * srcdoc (no origin, no sibling-file resolution).
 *
 * Native builds must NOT use this — see editor-shell.ts, which loads
 * the runtime from a sibling file on disk. The inline <script> approach
 * silently stalled under production WKWebView when shipped through the
 * react-native-webview bridge as source={{ html }} (Builds 76–81).
 */
export function buildEditorShellHtml(): string {
  // Build 107: root cause finally pinned down. Two compounding issues
  // kept producing a white editor surface despite Build 106's !important
  // overrides:
  //
  //   (1) WKWebView on iPad defaults to a LIGHT color scheme unless
  //       explicitly told otherwise. CM6 respects `color-scheme` and
  //       renders light-theme defaults when the UA reports light. Our
  //       !important rules may still be evaluated but CM6 also sets
  //       style properties via inline JS in light mode, winning the
  //       specificity fight even with !important.
  //
  //   (2) The shell body was hardcoded #1E1E1E, but the app's actual
  //       bgBase token is #131313. Even if the editor surface went
  //       transparent, it would reveal a slightly-off body color — not
  //       matching the surrounding app chrome the user expects.
  //
  // Fix: declare dark color-scheme via both <meta> (UA hint) and CSS
  // :root rule, plus force every CM6 element's background to transparent
  // with an aggressive override including `html[data-ui-theme="dark"]`.
  // Body background now #131313 to match the tokens.bgBase the RN side
  // paints everywhere else.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<style>
:root { color-scheme: dark; }
html,body{margin:0;padding:0;background:#131313 !important;color:#FFFFFF !important;font-family:-apple-system,sans-serif;}
#editor{background:transparent !important;}
.error{color:#F28500;padding:12px;}
#status{padding:8px 12px;font-size:11px;color:#8A8F98;}
.cm-editor,.cm-editor *{background-color:transparent !important;}
.cm-editor{color:#FFFFFF !important;outline:none !important;border:none !important;}
.cm-editor.cm-focused{outline:none !important;border:none !important;box-shadow:none !important;}
.cm-content{color:#FFFFFF !important;caret-color:#FF6A00 !important;}
.cm-cursor,.cm-cursor-primary{border-left-color:#FF6A00 !important;border-left-width:3px !important;}
.cm-selectionBackground{background:rgba(242,133,0,0.25) !important;}
.cm-focused .cm-selectionBackground{background:rgba(242,133,0,0.3) !important;}
.cm-selectionMatch{background:rgba(242,133,0,0.2) !important;}
.cm-activeLine{background:transparent !important;}
.cm-activeLineGutter{background:transparent !important;}
.cm-placeholder{color:#8A8F98 !important;font-style:italic !important;}
.cm-gutters{background:transparent !important;border:none !important;}
.cm-line{padding:0 !important;}
</style>
</head>
<body>
<div id="status">Loading editor…</div>
<div id="editor"></div>
</body>
</html>`;
}

export function buildEditorHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${EDITOR_CSS}</style>
</head>
<body>
<div id="status">Loading editor…</div>
<div id="editor"></div>

<script>${EDITOR_PRE_RUNTIME_SCRIPT}</script>

<!-- Build 81: inline the locally-bundled CodeMirror IIFE. Attaches window.CM6. -->
<script>${CM6_BUNDLE}</script>

<script>${EDITOR_BOOTSTRAP_SCRIPT}</script>
</body>
</html>`;
}
