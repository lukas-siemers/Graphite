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

// Build 89 native editor HTML destination. Resolved relative to this script:
//   packages/editor/scripts -> ../../apps/mobile/assets/editor
const mobileEditorAssetsDir = resolve(
  here,
  '../../../apps/mobile/assets/editor',
);
const mobileEditorHtmlFile = resolve(mobileEditorAssetsDir, 'editor.html');

// Legacy mobile asset path from Build 82 — delete on each run so the old
// runtime file doesn't linger in the binary.
const legacyMobileAssetsDir = resolve(here, '../../../apps/mobile/assets');
const legacyMobileAssetFile = resolve(legacyMobileAssetsDir, 'editor-runtime.js');

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

// 3. Build the native editor HTML by transpiling a tiny composer entry
//    that imports the editor CSS / scaffold / bootstrap from editorHtml.ts
//    and the native bridge scaffold/bootstrap from the new bridge files.
//    esbuild handles the .ts -> .js transpile and we eval the result in
//    a sandboxed Function to extract the assembled HTML string.
const tempDir = tmpdir();
const composerEntry = resolve(tempDir, 'graphite-editor-html-composer.ts');
const composerOut = resolve(tempDir, 'graphite-editor-html-composer.cjs');
writeFileSync(
  composerEntry,
  [
    "import { EDITOR_CSS } from " +
      JSON.stringify(resolve(here, '../src/live-preview/editorHtml.ts')) +
      ";",
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
    "export function buildHtml(cm6Bundle) {",
    "  return [",
    "    '<!DOCTYPE html>',",
    "    '<html lang=\"en\">',",
    "    '<head>',",
    "    '<meta charset=\"utf-8\" />',",
    "    '<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />',",
    "    '<style>' + EDITOR_CSS + '</style>',",
    "    '</head>',",
    "    '<body>',",
    "    '<div id=\"status\">Loading editor…</div>',",
    "    '<div id=\"editor\"></div>',",
    "    '<script>' + NATIVE_EDITOR_PRE_RUNTIME_SCRIPT + '</script>',",
    "    '<script>' + cm6Bundle + '</script>',",
    "    '<script>' + buildNativeBootstrapScript() + '</script>',",
    "    '</body>',",
    "    '</html>',",
    "  ].join('\\n');",
    "}",
  ].join('\n'),
);

// Bundle the composer to a single CJS file we can require() from this Node
// process. Mark editor-runtime-string.generated.ts as external — it imports
// the same bundleJs we already have in memory, no need to re-embed it.
await build({
  entryPoints: [composerEntry],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  outfile: composerOut,
  sourcemap: false,
  legalComments: 'none',
  // editorHtml.ts imports the CM6 bundle via editor-runtime-string.generated.
  // We don't need its exports during HTML assembly, but esbuild will follow
  // the import. Replace it with an empty stub via the alias mechanism so
  // bundling stays fast and the giant generated string isn't pulled twice.
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

// Load the composer via dynamic import. Convert Windows path to a file URL
// so import() doesn't choke on backslashes.
const composerUrl = new URL('file://' + composerOut.replace(/\\/g, '/'));
const composer = await import(composerUrl);
const editorHtml = composer.buildHtml(bundleJs);

if (!existsSync(mobileEditorAssetsDir)) {
  // Parent directory may already exist (apps/mobile/assets is a normal
  // assets folder); just ensure the editor subfolder is present.
  mkdirSync(mobileEditorAssetsDir, { recursive: true });
}
writeFileSync(mobileEditorHtmlFile, editorHtml);

// Cleanup the legacy Build 82 runtime asset if it still exists. Stale assets
// confuse the reviewer and bloat the binary.
if (existsSync(legacyMobileAssetFile)) {
  try { unlinkSync(legacyMobileAssetFile); } catch (_) {}
}

// Cleanup tmp composer files. Best-effort — if cleanup fails the OS will
// reclaim them eventually.
try { unlinkSync(composerEntry); } catch (_) {}
try { unlinkSync(composerOut); } catch (_) {}

const { size: jsSize } = statSync(outJs);
const { size: htmlSize } = statSync(mobileEditorHtmlFile);
console.log('cm6 bundle js   :', outJs, '(' + Math.round(jsSize / 1024) + ' KB)');
console.log('cm6 bundle ts   :', outTsNew);
console.log('native editor   :', mobileEditorHtmlFile, '(' + Math.round(htmlSize / 1024) + ' KB)');
