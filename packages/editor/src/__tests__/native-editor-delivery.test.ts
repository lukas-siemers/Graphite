/**
 * Build 89 build-time guardrail.
 *
 * The native editor's delivery path is architecturally narrow:
 *   - a static HTML asset bundled inside the iOS binary;
 *   - loaded via expo-asset Asset.fromModule -> Asset.localUri;
 *   - messaging via window.ReactNativeWebView.postMessage only.
 *
 * Builds 73–88 repeatedly regressed this narrow contract — e.g. re-inlining
 * the giant editor HTML through source={{ html }}, writing bundle copies
 * into FileSystem.cacheDirectory at first mount, or monkey-patching
 * window.parent to route CM6 postMessage. This test reads the files that
 * own the native editor boot and asserts NONE of those patterns have
 * crept back in. Any failure here blocks the next TestFlight build until
 * a human reviews the offending code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildEditorShellHtml } from '../live-preview/editorHtml';

/**
 * Read a source file and strip comments before asserting. These guardrails
 * must block the patterns from being CALLED — they should still be allowed
 * in comments that document why the pattern was removed, otherwise the
 * file's own "REMOVED foo" header would cause false failures.
 *
 * Strips:
 *   - /* … *\/ block comments (including multi-line JSDoc)
 *   - // line comments up to end-of-line
 *
 * Does NOT strip string literals, which is fine — none of our banned
 * patterns should ever appear inside a quoted string in this codebase.
 */
function read(p: string): string {
  const raw = readFileSync(resolve(__dirname, '..', p), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/(^|\s)\/\/[^\n]*/g, '$1'); // line comments (preserve preceding whitespace)
}

describe('native editor delivery — Build 89 guardrails', () => {
  const native = read('LivePreviewInput.native.tsx');
  const bridge = read('live-preview/native-editor-bridge.ts');
  const bootstrap = read('live-preview/native-editor-bootstrap.ts');

  it('source.html shell contains no <script> tags (Build 97 contract)', () => {
    // Build 97 proved WKWebView blocks every <script> tag in our shell HTML
    // (inline AND src-loaded). The native editor is now delivered entirely
    // via the injectedJavaScript prop (WKUserScript path). Guardrail: the
    // shell HTML literal in this file must not contain a <script tag.
    // The literal lives inside a template-string assignment to `html` —
    // we look for the substring '<script' anywhere in the file's source.
    // Whitespace-tolerant via regex.
    expect(native).not.toMatch(/<script[\s>]/);
  });

  it('native shell is minimal — theme owns all CM6 coloring (Build 110)', () => {
    // Build 110: shell CSS carries only the bare body/html/status rules
    // plus the color-scheme hint. All CM6 element coloring (.cm-editor,
    // .cm-scroller, .cm-content, .cm-line, .cm-cursor, .cm-placeholder,
    // .cm-selectionBackground, .cm-gutters, .cm-tooltip, .cm-panels) is
    // owned by EditorView.theme({...}, { dark: true }) in the bootstrap.
    // Builds 106-109 kept a mix of shell !important rules and theme rules
    // and ended up with patchy half-white editors because the two rule
    // sets fought at different specificity / !important levels. This test
    // asserts the shell stays minimal so that fight can't restart.
    expect(native).toMatch(/buildEditorShellHtml/);
    const shell = buildEditorShellHtml();
    // Positive: the two divs CM6 and the boot scaffold need.
    expect(shell).toContain('id="editor"');
    expect(shell).toContain('id="status"');
    expect(shell).not.toMatch(/<script[\s>]/);
    // Positive: color-scheme hint must be present so WKWebView doesn't
    // default to light mode (which made CM6 ignore our overrides).
    expect(shell).toMatch(/color-scheme:\s*dark/);
    expect(shell).toMatch(/<meta name="color-scheme" content="dark"/);
    // Positive: body/html dark background is in place so any uncovered
    // CM6 area reveals the correct color.
    expect(shell).toMatch(/html,body\s*\{[^}]*background:\s*#131313/);
    // Negative: shell MUST NOT carry .cm-* rules. That's the theme's job.
    // Lone exceptions are content references (e.g., ellipsis strings), but
    // no <style>-block CSS selectors should match.
    expect(shell).not.toMatch(/\.cm-editor\s*[\{,]/);
    expect(shell).not.toMatch(/\.cm-content\s*\{/);
    expect(shell).not.toMatch(/\.cm-scroller\s*\{/);
    expect(shell).not.toMatch(/\.cm-placeholder\s*\{/);
    // Negative guard: the Build 99 layout-collapse triggers must NEVER
    // reappear.
    expect(shell).not.toMatch(/overflow:\s*visible\s*!important/);
    expect(shell).not.toMatch(/min-height:\s*100vh/);
  });

  it('LivePreviewInput.native.tsx does not write editor runtime files to disk', () => {
    // The Builds 82–87 path wrote the runtime to cacheDirectory at first
    // mount. expo-file-system.writeAsStringAsync is the only API that can
    // cause that write; ban it outright in this file.
    expect(native).not.toMatch(/writeAsStringAsync/);
    // ensureEditorAssets was the helper name — block the symbol so the
    // helper cannot be reintroduced even under a different implementation.
    expect(native).not.toMatch(/ensureEditorAssets/);
  });

  it('LivePreviewInput.native.tsx does not use allowingReadAccessToURL', () => {
    // Build 87's WKWebView workaround is banned — it was only needed when
    // loading a cached file:// URL whose sibling resources lived outside
    // the sandbox. Build 89 loads a bundled asset, no workaround needed.
    expect(native).not.toMatch(/allowingReadAccessToURL/);
  });

  it('native bridge does not rely on window.parent.postMessage', () => {
    // On WKWebView window.parent is a read-only getter. Prior builds
    // monkey-patched it via Object.defineProperty(window, 'parent', …),
    // which silently no-oped and dropped every CM6 message. Ban the
    // monkey-patch form and the postMessage-via-parent call shape
    // in the native bridge and bootstrap composer.
    expect(bridge).not.toMatch(/Object\.defineProperty\s*\(\s*window\s*,\s*['"]parent['"]/);
    expect(bridge).not.toMatch(/window\.parent\.postMessage/);
    expect(bootstrap).not.toMatch(/Object\.defineProperty\s*\(\s*window\s*,\s*['"]parent['"]/);
    // The bootstrap reuses EDITOR_BOOTSTRAP_SCRIPT from editorHtml.ts,
    // which does NOT contain window.parent.postMessage anymore (Build 84
    // removed it in favor of postToHost). If that ever regresses, this
    // assertion fails here.
    expect(bootstrap).not.toMatch(/window\.parent\.postMessage/);
  });

  it('native bridge / bootstrap do not load runtime dependencies from CDNs', () => {
    // Build 80 loaded CodeMirror from esm.sh at runtime — that fetch
    // silently failed under WKWebView. CM6 must stay inlined / bundled.
    for (const src of [bridge, bootstrap, native]) {
      expect(src).not.toMatch(/https:\/\/esm\.sh/);
      expect(src).not.toMatch(/https:\/\/cdn\./);
    }
  });

  it('native editor is delivered via injectedJavaScript (Build 97)', () => {
    // Build 97 stopped using bundled assets at runtime entirely. The full
    // editor (pre-runtime + CM6 bundle + bootstrap) is now imported as TS
    // strings and concatenated into NATIVE_EDITOR_INJECT_JS, then passed
    // via the injectedJavaScript prop. WKWebView accepts this WKUserScript
    // path (proven by Build 96's phase 0.05 marker) but blocked every
    // <script> tag we tried.
    expect(native).toMatch(/NATIVE_EDITOR_INJECT_JS/);
    expect(native).toMatch(/injectedJavaScript=\{NATIVE_EDITOR_INJECT_JS\}/);
    // Negative: no <script> tag delivery path or stale HTML-asset reference.
    expect(native).not.toMatch(/assets\/editor\/editor\.html/);
    expect(native).not.toMatch(/assets\/editor\/editor-probe\.html/);
  });

  it('shipped native-editor.bundle contains the real rich editor', () => {
    // Build 93 swapped the shipped asset from editor.html to
    // native-editor.bundle (a single JS file containing pre-runtime +
    // CM6 bundle + bootstrap). This test reads the actual asset and
    // asserts it is the real editor generated by bundle-cm6.mjs.
    const assetPath = resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'apps',
      'mobile',
      'assets',
      'editor',
      'native-editor.bundle',
    );
    const shipped = readFileSync(assetPath, 'utf8');

    // Positive: must contain every rich-editor boot phase marker. These
    // come from native-editor-bridge.ts and native-editor-bootstrap.ts
    // which get concatenated into the bundle by bundle-cm6.mjs.
    expect(shipped).toContain('html-parsed');
    expect(shipped).toContain('cm6-bundle-executed');
    expect(shipped).toContain('cm6-destructured');
    expect(shipped).toContain('constructing-editor-view');
    expect(shipped).toContain('editor-view-constructed');

    // Negative: must NOT contain any Build 90 probe marker.
    expect(shipped).not.toContain('Native Editor Probe');
    expect(shipped).not.toContain('minimal-boot');
    expect(shipped).not.toContain('dom-wired');

    // Sanity: the real bundle is ~869 KB. A sub-100 KB file is a regression.
    expect(shipped.length).toBeGreaterThan(100_000);
  });
});
