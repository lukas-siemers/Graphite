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

  it('LivePreviewInput.native.tsx does not use source={{ html }} (Builds 76–88 pattern)', () => {
    // Match the JSX form. Any reintroduction of inline HTML delivery through
    // the RN bridge is banned. We match both whitespace-tolerant variants.
    expect(native).not.toMatch(/source\s*=\s*\{\s*\{\s*html\s*:/);
    expect(native).not.toMatch(/source\s*=\s*\{\s*\{\s*html\s*\}\s*\}/);
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

  it('native editor is delivered via expo-asset Asset.fromModule', () => {
    // Positive assertion — if the delivery mechanism is silently swapped
    // (e.g. back to source.html) this breaks too.
    expect(native).toMatch(/Asset\.fromModule/);
    expect(native).toMatch(/require\([^)]*assets\/editor\/editor\.html[^)]*\)/);
  });

  it('shipped editor.html contains the real rich editor, not the Build 90 probe', () => {
    // Build 90 swapped the rich editor HTML for a tiny diagnostic page. The
    // app shipped the probe instead of the editor. This test reads the
    // actual asset that gets bundled into the iOS binary and asserts it is
    // the real editor generated by bundle-cm6.mjs, never the probe.
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
      'editor.html',
    );
    const shipped = readFileSync(assetPath, 'utf8');

    // Positive: must contain every rich-editor boot phase marker. These
    // come from native-editor-bridge.ts and native-editor-bootstrap.ts.
    expect(shipped).toContain('html-parsed');
    expect(shipped).toContain('cm6-bundle-executed');
    expect(shipped).toContain('cm6-destructured');
    expect(shipped).toContain('constructing-editor-view');
    expect(shipped).toContain('editor-view-constructed');

    // Negative: must NOT contain any probe marker. Any match means the
    // probe HTML was committed to the release path by mistake.
    expect(shipped).not.toContain('Native Editor Probe');
    expect(shipped).not.toContain('minimal-boot');
    expect(shipped).not.toContain('dom-wired');

    // Sanity: the real editor asset is big. The probe was ~1.5 KB, the real
    // editor is ~876 KB. A sub-100 KB file is almost certainly not the real
    // editor even if it somehow contained the markers as substrings.
    expect(shipped.length).toBeGreaterThan(100_000);
  });
});
