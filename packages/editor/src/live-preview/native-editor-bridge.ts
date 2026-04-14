/**
 * Native (react-native-webview) editor bridge — Build 89.
 *
 * Exports the JavaScript snippets injected into the bundled native editor
 * page. There is intentionally NO `window.parent.postMessage` fallback: on
 * WKWebView `window.parent` is a read-only getter pointing at the same
 * window, and the Build 81-era `Object.defineProperty(window, 'parent', …)`
 * monkey-patch silently fails. Every outbound event uses
 * `window.ReactNativeWebView.postMessage` directly.
 *
 * These strings are STATIC source — they are concatenated into the bundled
 * `apps/mobile/assets/editor/editor.html` shell at bundle time by
 * `scripts/bundle-cm6.mjs`. They are NOT injected via `injectJavaScript` at
 * runtime and they do NOT depend on anything outside the editor page.
 *
 * Step 4 of the Build 89 plan: ONE function (`postToNative`) used by every
 * outbound event — `ready`, `change`, `height`, `active-formats`,
 * `command-applied`, `error`, and the optional boot `phase` markers.
 *
 * Step 5 of the Build 89 plan: ONE inbound message listener on
 * `window.addEventListener('message', …)`. The host calls
 * `webViewRef.current?.injectJavaScript(...)` with code that dispatches a
 * `MessageEvent` carrying the command — the listener below handles it.
 */

/**
 * Pre-runtime scaffold injected into the native editor HTML. Defines
 * `postToNative`, `reportError`, and the boot `postPhase` helper, then posts
 * phase 1. Runs synchronously inside the WebView before the CM6 bundle
 * executes so that any failure during the bundle stage still produces a
 * visible host-side error.
 */
export const NATIVE_EDITOR_PRE_RUNTIME_SCRIPT = `
(function () {
  // Build 89: the only host-post path on native. ReactNativeWebView is
  // injected by the WKWebView host; if it is missing the page is loaded in a
  // browser tab during local dev — silently no-op so the editor still boots.
  function postToNative(msg) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(
          typeof msg === 'string' ? msg : JSON.stringify(msg)
        );
      }
    } catch (_) {}
  }
  window.__graphitePostToNative = postToNative;

  function reportError(err) {
    var el = document.getElementById('status');
    if (el) {
      el.className = 'error';
      el.textContent =
        'Editor failed to load: ' +
        (err && err.message ? err.message : String(err));
    }
    postToNative({
      type: 'error',
      message: String((err && err.stack) || err),
    });
  }
  window.__graphiteReportError = reportError;

  window.addEventListener('error', function (e) {
    reportError(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    reportError(e.reason);
  });

  function postPhase(phase, label) {
    postToNative({ type: 'phase', phase: phase, label: label });
  }
  window.__graphitePostPhase = postPhase;
  postPhase(1, 'html-parsed');
})();
`;

/**
 * App bootstrap snippet appended after the CM6 IIFE attaches `window.CM6`.
 * Wires up the EditorView, installs the inbound message listener, and posts
 * the `ready` handshake. Sources its three helpers (`postToNative`,
 * `reportError`, `postPhase`) from the pre-runtime scaffold above.
 *
 * The body is identical to the iframe bootstrap (editorHtml.ts) for
 * editor behavior, but every outbound `post(...)` call is rewired to
 * `window.__graphitePostToNative` so there is zero dependence on
 * `window.parent`.
 *
 * The snippet is wrapped in an IIFE so it can `return` early and so all of
 * its locals (which would otherwise leak onto window) stay scoped.
 */
export function buildNativeEditorBootstrapScript(bodyScript: string): string {
  return `
(function () {
  var post = window.__graphitePostToNative;
  var reportError = window.__graphiteReportError;
  var postPhase = window.__graphitePostPhase;
  ${bodyScript}
})();
`;
}
