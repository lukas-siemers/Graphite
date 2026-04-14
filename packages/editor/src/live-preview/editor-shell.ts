/**
 * Minimal HTML shell for the native (react-native-webview) editor host.
 *
 * Build 82 rationale: Build 81 inlined the 820KB CodeMirror IIFE directly
 * into the HTML as one giant `<script>${CM6_BUNDLE}</script>` tag. The
 * HTML was then shipped through `source={{ html }}` on `<WebView>`, which
 * ferries the entire payload through the RN→native bridge on every mount.
 * Under production WKWebView (TestFlight) that stalled silently — no
 * placeholder, no keyboard, no error banner.
 *
 * The shell produced here:
 *   - Includes the same CSS and app bootstrap JS as the web build
 *     (imported from editorHtml.ts so there is ONE source of truth).
 *   - Loads the CM6 runtime via a relative `<script src="editor-runtime.js">`
 *     tag instead of inlining it. LivePreviewInput.native.tsx writes the
 *     runtime and this HTML side-by-side under the cache directory at
 *     first mount, then points the WebView at the HTML file via file://.
 *     Only a small URI crosses the native bridge; the runtime loads
 *     directly from disk inside WebKit.
 *
 * Web is unaffected — the iframe still loads via srcdoc (no origin, no
 * relative-URL resolution), so it keeps inlining the bundle through
 * buildEditorHtml() in editorHtml.ts.
 */
import { EDITOR_CSS } from './editorHtml';

/**
 * Build 85: every script is loaded as an external file. Build 82-84 inlined
 * EDITOR_PRE_RUNTIME_SCRIPT and EDITOR_BOOTSTRAP_SCRIPT in <script>...</script>
 * tags; TestFlight's watchdog proved those inline scripts never executed
 * (phase 0 from BRIDGE_SHIM arrived, phase 1 at the top of the inline
 * pre-runtime never did). Moving all three scripts to external src tags
 * avoids whatever WKWebView restriction was blocking the inline path.
 *
 * Host must write all three JS files to the same directory as the HTML's
 * baseUrl so the src references resolve:
 *   - editor-pre-runtime.js  (error surfacing, postToHost helper, phase 1)
 *   - editor-runtime.js      (CM6 bundle — installs window.CM6)
 *   - editor-bootstrap.js    (reads window.CM6 and builds the editor view)
 */
export function buildEditorHtmlShell(): string {
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
<script src="editor-pre-runtime.js"></script>
<script src="editor-runtime.js"></script>
<script src="editor-bootstrap.js"></script>
</body>
</html>`;
}
