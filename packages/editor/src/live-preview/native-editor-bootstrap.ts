/**
 * Native editor bootstrap composer — Build 89.
 *
 * Returns the JS source assembled into the bundled native editor HTML at
 * build time. The output is a single `<script>` tag's worth of code that
 * runs after `window.CM6` has been attached by the bundled CM6 IIFE.
 *
 * This composer purposely reuses the proven `EDITOR_BOOTSTRAP_SCRIPT` body
 * from `editorHtml.ts` so the editor's CodeMirror setup, fence plugin,
 * block-heights plugin, and message handler stay byte-identical between
 * web and native. The only difference is the post path: on native the
 * `post(...)` helper is aliased to `window.__graphitePostToNative` (defined
 * in `native-editor-bridge.ts` → `NATIVE_EDITOR_PRE_RUNTIME_SCRIPT`), so
 * there is zero dependence on `window.parent`.
 *
 * Importantly: this module only runs at BUILD TIME inside
 * `scripts/bundle-cm6.mjs`. At runtime in the WebView, the editor sees only
 * a static HTML file shipped inside the iOS app binary.
 */
import { EDITOR_BOOTSTRAP_SCRIPT } from './editorHtml';

/**
 * Build the native bootstrap snippet. The wrapper aliases `postToHost` to
 * the native bridge function so the unmodified `EDITOR_BOOTSTRAP_SCRIPT`
 * (which calls `postToHost` indirectly through its local `post` helper)
 * routes every outbound message through `window.ReactNativeWebView`.
 *
 * NOTE: the wrapper is NOT an IIFE — `EDITOR_BOOTSTRAP_SCRIPT` declares
 * top-level `const`s and an event listener that must persist on the page.
 * Declaring them inside an IIFE would scope them away from later
 * `injectJavaScript` calls.
 */
export function buildNativeBootstrapScript(): string {
  return [
    '// Build 89 native bootstrap — alias postToHost onto the native bridge',
    '// so the shared editor body in EDITOR_BOOTSTRAP_SCRIPT routes outbound',
    '// messages through ReactNativeWebView.postMessage.',
    'var postToHost = window.__graphitePostToNative;',
    EDITOR_BOOTSTRAP_SCRIPT,
  ].join('\n');
}
