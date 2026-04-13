// Bundle script for the CodeMirror 6 IIFE consumed by editorHtml.ts.
//
// Reads src/live-preview/cm6-entry.ts, esbuilds it as a browser IIFE, and
// emits a sibling cm6-bundle.generated.ts that exports the resulting JS
// as a string constant. The .ts wrapper is the "import shape" that works
// identically in Metro (RN bundler), web/iframe, and Node/vitest.
//
// Run:  yarn --cwd packages/editor bundle-cm6
//
// The generated .ts is committed — CI and TestFlight builds do not need
// to run this script. Rerun whenever CodeMirror deps change.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/live-preview/cm6-entry.ts');
const outfile = resolve(here, '../src/live-preview/cm6-bundle.generated.js');
const tsOut = resolve(here, '../src/live-preview/cm6-bundle.generated.ts');

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outfile,
  sourcemap: false,
  legalComments: 'none',
});

const bundleJs = readFileSync(outfile, 'utf8');
writeFileSync(
  tsOut,
  '// GENERATED FILE — do not edit. Regenerate via `yarn --cwd packages/editor bundle-cm6`.\n' +
    '// Source: scripts/bundle-cm6.mjs + src/live-preview/cm6-entry.ts\n' +
    '/* eslint-disable */\n' +
    'export const CM6_BUNDLE = ' +
    JSON.stringify(bundleJs) +
    ';\n'
);

const { size } = statSync(outfile);
console.log('cm6 bundle js:', outfile, '(' + Math.round(size / 1024) + ' KB)');
console.log('cm6 bundle ts:', tsOut);
