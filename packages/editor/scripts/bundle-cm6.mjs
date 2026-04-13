// Bundle script for the CodeMirror 6 IIFE consumed by the Live Preview editor.
//
// Reads src/live-preview/cm6-entry.ts, esbuilds it as a browser IIFE, and
// emits three artifacts:
//
//   1. src/live-preview/cm6-bundle.generated.js
//      Raw IIFE JavaScript. The source of truth. Everything else derives
//      from it.
//
//   2. src/live-preview/editor-runtime-string.generated.ts
//      TS module exporting the IIFE as `CM6_BUNDLE: string`. Web's
//      editorHtml.ts inlines this string into its srcdoc HTML. The native
//      WebView ALSO imports it — not to inline, but to write the runtime
//      out to the iOS cache directory at first mount (see
//      LivePreviewInput.native.tsx).
//
//   3. apps/mobile/assets/editor-runtime.js (COPIED, not written from TS)
//      Physical asset packaged into the iOS .ipa. React Native/Expo
//      processes apps/mobile/assets/* during `expo prebuild` / the
//      production export step. The native editor writes this file's
//      contents (via the string import) to the cache dir so the WebView
//      can load it as a sibling of the shell HTML.
//
// Build 82 rationale: Build 81 shipped CM6 by inlining its 820KB bundle
// as a single <script>${CM6_BUNDLE}</script> inside source={{ html }}.
// Every editor mount pushed that blob through the RN->native bridge,
// which stalled silently in production WKWebView. The native path now
// writes the runtime to disk once (first mount) and loads it via
// <script src="editor-runtime.js"> from file://, so only a tiny URI
// crosses the bridge.
//
// Run:  yarn --cwd packages/editor bundle-cm6
//
// The generated files are committed — CI and TestFlight builds do not
// need to run this script. Rerun whenever CodeMirror deps change.

import { build } from 'esbuild';
import {
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/live-preview/cm6-entry.ts');
const outJs = resolve(here, '../src/live-preview/cm6-bundle.generated.js');
const outTsNew = resolve(here, '../src/live-preview/editor-runtime-string.generated.ts');
// Legacy filename from Build 81 — delete on each run so stale copies don't
// linger in the repo and confuse imports.
const outTsLegacy = resolve(here, '../src/live-preview/cm6-bundle.generated.ts');

// Mobile asset destination. Resolved relative to this script location:
//   packages/editor/scripts -> ../../apps/mobile/assets
const mobileAssetsDir = resolve(here, '../../../apps/mobile/assets');
const mobileAssetFile = resolve(mobileAssetsDir, 'editor-runtime.js');

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

// Emit the TS string wrapper that editorHtml.ts + LivePreviewInput.native
// import. JSON.stringify produces a safe JS string literal (handles quotes,
// newlines, backslashes).
writeFileSync(
  outTsNew,
  '// GENERATED FILE — do not edit. Regenerate via `yarn --cwd packages/editor bundle-cm6`.\n' +
    '// Source: scripts/bundle-cm6.mjs + src/live-preview/cm6-entry.ts\n' +
    '/* eslint-disable */\n' +
    'export const CM6_BUNDLE = ' +
    JSON.stringify(bundleJs) +
    ';\n',
);

// Remove the Build 81 filename if it still exists so there's no ambiguity
// about which TS module is live.
if (existsSync(outTsLegacy)) {
  try { unlinkSync(outTsLegacy); } catch (_) {}
}

// Copy the raw IIFE into apps/mobile/assets so it's packaged with the iOS
// build. Silent skip when apps/mobile isn't present (e.g. running the
// script in a standalone packages/editor checkout).
let assetSize = -1;
if (existsSync(mobileAssetsDir)) {
  copyFileSync(outJs, mobileAssetFile);
  assetSize = statSync(mobileAssetFile).size;
} else if (!existsSync(mobileAssetsDir)) {
  // Parent exists but assets/ may not — create and copy anyway when the
  // mobile app is present.
  const mobileRoot = resolve(here, '../../../apps/mobile');
  if (existsSync(mobileRoot)) {
    mkdirSync(mobileAssetsDir, { recursive: true });
    copyFileSync(outJs, mobileAssetFile);
    assetSize = statSync(mobileAssetFile).size;
  }
}

const { size } = statSync(outJs);
console.log('cm6 bundle js:', outJs, '(' + Math.round(size / 1024) + ' KB)');
console.log('cm6 bundle ts:', outTsNew);
if (assetSize > 0) {
  console.log('mobile asset :', mobileAssetFile, '(' + Math.round(assetSize / 1024) + ' KB)');
} else {
  console.log('mobile asset : skipped (apps/mobile not present)');
}
