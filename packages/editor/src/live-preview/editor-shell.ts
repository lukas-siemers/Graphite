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
import {
  EDITOR_CSS,
  EDITOR_PRE_RUNTIME_SCRIPT,
  EDITOR_BOOTSTRAP_SCRIPT,
} from './editorHtml';
import { CM6_BUNDLE } from './editor-runtime-string.generated';

/**
 * Build 88: back to the Build 71-era inline-everything pattern that was
 * the last confirmed-working editor on TestFlight production. Build 82-87
 * moved to on-disk file:// delivery to work around what we thought was a
 * large-inline-script issue — but the Build 87 diagnostic proved the file
 * URL was never actually navigated to by WKWebView even with
 * allowingReadAccessToURL set.
 *
 * Going back to inline HTML + Build 84's postToHost bridge fix is the
 * combination we never actually tested. Build 81 had the inline pattern
 * but the window.parent override was broken; every CM6 postMessage was
 * lost in the void so the editor looked dead. Build 84 fixed the bridge.
 * This file glues the two together.
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
<script>${EDITOR_PRE_RUNTIME_SCRIPT}</script>
<script>${CM6_BUNDLE}</script>
<script>${EDITOR_BOOTSTRAP_SCRIPT}</script>
</body>
</html>`;
}
