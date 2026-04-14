// Bundle script for the CodeMirror 6 IIFE consumed by the Live Preview editor.
//
// Build 89 — produces the artifacts for both web and native editor delivery:
//
//   1. src/live-preview/cm6-bundle.generated.js
//      Raw IIFE JavaScript. The source of truth. Everything else derives
//      from it.
//
//   2. src/live-preview/editor-runtime-string.generated.ts
//      TS module exporting the IIFE as `CM6_BUNDLE: string`. Web's
//      editorHtml.ts inlines this string into its srcdoc HTML.
//
//   3. apps/mobile/assets/editor/editor.html
//      Static HTML shell that ships INSIDE the iOS app binary. Contains
//      CSS + pre-runtime scaffold + CM6 bundle + native bootstrap — every
//      script tag inline, NO sibling <script src=...> dependency. The
//      native LivePreviewInput uses expo-asset to resolve this file's
//      local URI and points the WKWebView at it via source.uri so the
//      page boots from disk inside the binary, not via runtime cache
//      writes and not via source.html (which serializes the entire HTML
//      through the RN bridge on every mount and stalled in TestFlight
//      Builds 76–81).
//
// Build 89 rationale: prior builds tried disk caching (82–87 wrote the
// runtime to cacheDirectory at first mount and pointed the WebView at a
// file:// URL there) and inline source.html (88, the Build 71 pattern).
// Both delivery paths had subtle WKWebView failure modes in production.
// Shipping a real on-disk asset inside the .ipa, loaded via the standard
// expo-asset machinery, removes both fragile codepaths.
//
// Run:  yarn --cwd packages/editor bundle-cm6
//
// The generated files are committed — CI and TestFlight builds do not
// need to run this script. Rerun whenever CodeMirror deps or editorHtml
// content changes.

import { build } from 'esbuild';
import {
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/live-preview/cm6-entry.ts');
const outJs = resolve(here, '../src/live-preview/cm6-bundle.generated.js');
const outTsNew = resolve(here, '../src/live-preview/editor-runtime-string.generated.ts');
// Legacy filename from Build 81 — delete on each run so stale copies don't
// linger in the repo and confuse imports.
const outTsLegacy = resolve(here, '../src/live-preview/cm6-bundle.generated.ts');

// Build 93: native editor delivers as ONE bundled JS asset referenced from a
// tiny inline HTML shell. Stops shipping editor.html entirely.
//   packages/editor/scripts -> ../../apps/mobile/assets/editor
const mobileEditorAssetsDir = resolve(
  here,
  '../../../apps/mobile/assets/editor',
);
const mobileNativeBundleFile = resolve(mobileEditorAssetsDir, 'native-editor.bundle');

// Stale assets to prune on each run so the binary stays clean.
const legacyMobileAssetsDir = resolve(here, '../../../apps/mobile/assets');
const legacyMobileAssetFile = resolve(legacyMobileAssetsDir, 'editor-runtime.js');
const legacyMobileEditorHtmlFile = resolve(mobileEditorAssetsDir, 'editor.html');
const legacyMobileEditorProbeHtmlFile = resolve(mobileEditorAssetsDir, 'editor-probe.html');
const legacyMobileEditorBackupHtmlFile = resolve(mobileEditorAssetsDir, 'editor.full.backup.html');

// 1. Build the CM6 IIFE.
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outfile: outJs,
  sourcemap: false,
  legalComments: 'none',
});

const bundleJs = readFileSync(outJs, 'utf8');

// 2. Emit the TS string wrapper (web inlines this).
writeFileSync(
  outTsNew,
  '// GENERATED FILE — do not edit. Regenerate via `yarn --cwd packages/editor bundle-cm6`.\n' +
    '// Source: scripts/bundle-cm6.mjs + src/live-preview/cm6-entry.ts\n' +
    '/* eslint-disable */\n' +
    'export const CM6_BUNDLE = ' +
    JSON.stringify(bundleJs) +
    ';\n',
);

// Remove the Build 81 filename if it still exists.
if (existsSync(outTsLegacy)) {
  try { unlinkSync(outTsLegacy); } catch (_) {}
}

// 3. Build the native editor JS bundle by transpiling a tiny composer entry
//    that imports the native bridge + bootstrap from their source files and
//    concatenates them with the CM6 IIFE. The output is a single, self-
//    contained JS asset that gets loaded by the WebView via <script src>.
const tempDir = tmpdir();
const composerEntry = resolve(tempDir, 'graphite-native-js-composer.ts');
const composerOut = resolve(tempDir, 'graphite-native-js-composer.cjs');
writeFileSync(
  composerEntry,
  [
    "import { NATIVE_EDITOR_PRE_RUNTIME_SCRIPT } from " +
      JSON.stringify(
        resolve(here, '../src/live-preview/native-editor-bridge.ts'),
      ) +
      ";",
    "import { buildNativeBootstrapScript } from " +
      JSON.stringify(
        resolve(here, '../src/live-preview/native-editor-bootstrap.ts'),
      ) +
      ";",
    "export function buildJs(cm6Bundle) {",
    "  return [",
    "    '// Graphite native editor — generated by bundle-cm6.mjs.',",
    "    '// Loaded as a single .bundle asset via <script src=\"file://...\">',",
    "    '// in a tiny HTML shell from LivePreviewInput.native.tsx.',",
    "    NATIVE_EDITOR_PRE_RUNTIME_SCRIPT,",
    "    cm6Bundle,",
    "    buildNativeBootstrapScript(),",
    "  ].join('\\n');",
    "}",
  ].join('\n'),
);

await build({
  entryPoints: [composerEntry],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  outfile: composerOut,
  sourcemap: false,
  legalComments: 'none',
  plugins: [
    {
      name: 'stub-cm6-string',
      setup(b) {
        b.onResolve({ filter: /editor-runtime-string\.generated/ }, (args) => ({
          path: args.path,
          namespace: 'cm6-stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'cm6-stub' }, () => ({
          contents: 'export const CM6_BUNDLE = "";',
          loader: 'js',
        }));
      },
    },
  ],
});

const composerUrl = new URL('file://' + composerOut.replace(/\\/g, '/'));
const composer = await import(composerUrl);
const nativeEditorJs = composer.buildJs(bundleJs);

if (!existsSync(mobileEditorAssetsDir)) {
  mkdirSync(mobileEditorAssetsDir, { recursive: true });
}
writeFileSync(mobileNativeBundleFile, nativeEditorJs);

// Cleanup stale assets from earlier iteration paths.
for (const stale of [
  legacyMobileAssetFile,          // Build 82 editor-runtime.js
  legacyMobileEditorHtmlFile,     // Builds 89-91 editor.html
  legacyMobileEditorProbeHtmlFile,// Build 90 probe
  legacyMobileEditorBackupHtmlFile,// Build 90 backup
]) {
  if (existsSync(stale)) {
    try { unlinkSync(stale); } catch (_) {}
  }
}

// Cleanup tmp composer files.
try { unlinkSync(composerEntry); } catch (_) {}
try { unlinkSync(composerOut); } catch (_) {}

const { size: jsSize } = statSync(outJs);
const { size: bundleSize } = statSync(mobileNativeBundleFile);
console.log('cm6 bundle js   :', outJs, '(' + Math.round(jsSize / 1024) + ' KB)');
console.log('cm6 bundle ts   :', outTsNew);
console.log('native bundle   :', mobileNativeBundleFile, '(' + Math.round(bundleSize / 1024) + ' KB)');
