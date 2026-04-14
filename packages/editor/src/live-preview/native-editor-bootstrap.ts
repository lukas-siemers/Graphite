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
 * Build the native bootstrap snippet. The wrapper aliases the three helpers
 * (`postToHost`, `postPhase`, `reportError`) onto the native bridge functions
 * exposed on `window` by `NATIVE_EDITOR_PRE_RUNTIME_SCRIPT` so the unmodified
 * `EDITOR_BOOTSTRAP_SCRIPT` (which calls these as free variables) resolves
 * them and routes every outbound message through `window.ReactNativeWebView`.
 *
 * NOTE: the wrapper is NOT an IIFE — `EDITOR_BOOTSTRAP_SCRIPT` declares
 * top-level `const`s and an event listener that must persist on the page.
 * Declaring them inside an IIFE would scope them away from later
 * `injectJavaScript` calls.
 *
 * Build 98: the `postPhase` + `reportError` aliases were added after Build 97
 * shipped and died at `postPhase(2, 'cm6-bundle-executed')` with a silent
 * ReferenceError — `NATIVE_EDITOR_PRE_RUNTIME_SCRIPT` scopes both helpers
 * inside an IIFE and only exposes them as `window.__graphite*`, so bare
 * references in the bootstrap could not resolve. The watchdog banner
 * showed `phase 1 (html-parsed)` as the last successful phase.
 */
export function buildNativeBootstrapScript(): string {
  return [
    '// Build 98 native bootstrap — alias the three helpers onto the native',
    '// bridge so the shared EDITOR_BOOTSTRAP_SCRIPT (which uses bare',
    '// postToHost / postPhase / reportError references) resolves them to',
    '// the bridge functions exposed by NATIVE_EDITOR_PRE_RUNTIME_SCRIPT.',
    'var postToHost = window.__graphitePostToNative;',
    'var postPhase = window.__graphitePostPhase;',
    'var reportError = window.__graphiteReportError;',
    EDITOR_BOOTSTRAP_SCRIPT,
  ].join('\n');
}
