const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all workspace packages so Metro picks up changes in packages/*
config.watchFolders = [monorepoRoot];

// Resolve packages from both the app's node_modules and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Disable the experimental package exports field resolution.
// When enabled, Metro picks ESM builds (e.g. zustand/esm/index.mjs, nanoid/index.js)
// via the "import" condition in package.json exports — those files contain
// import.meta which Metro's CommonJS bundler cannot parse.
// With this off, Metro falls back to resolverMainFields ['react-native','browser','main']
// which resolves to CJS builds for all third-party packages.
config.resolver.unstable_enablePackageExports = false;

// ---------------------------------------------------------------------------
// Web stubs — native-only modules that must be replaced on web.
// Using extraNodeModules avoids the infinite-loop risk of a custom
// resolveRequest that falls back to context.resolveRequest (which in
// Metro SDK 54 IS the current resolver, causing a stack overflow).
// ---------------------------------------------------------------------------
const stubDir = path.resolve(projectRoot, 'stubs');

config.resolver.extraNodeModules = {
  '@shopify/react-native-skia':   path.join(stubDir, 'react-native-skia-stub.js'),
  'react-native-worklets-core':   path.join(stubDir, 'react-native-worklets-stub.js'),
  'expo-file-system':             path.join(stubDir, 'expo-file-system-stub.js'),
  'expo-file-system/legacy':      path.join(stubDir, 'expo-file-system-stub.js'),
  'expo-sqlite':                  path.join(stubDir, 'expo-sqlite-stub.js'),
  'tldraw':                       path.join(stubDir, 'tldraw-stub.js'),
  'tldraw/tldraw.css':            path.join(stubDir, 'empty.js'),
  'nanoid':                       path.join(stubDir, 'nanoid-stub.js'),
  'nanoid/non-secure':            path.join(stubDir, 'nanoid-stub.js'),
  'nanoid/async':                 path.join(stubDir, 'nanoid-stub.js'),
  // Redirect zustand to its CJS build — the ESM build (esm/index.mjs) uses
  // import.meta.env which Metro's CommonJS bundler cannot parse.
  'zustand':                      path.resolve(projectRoot, 'node_modules/zustand/index.js'),
  'zustand/react':                path.resolve(projectRoot, 'node_modules/zustand/index.js'),
  'zustand/traditional':          path.resolve(projectRoot, 'node_modules/zustand/traditional.js'),
  'zustand/vanilla':              path.resolve(projectRoot, 'node_modules/zustand/vanilla.js'),
  'zustand/middleware':           path.resolve(projectRoot, 'node_modules/zustand/middleware.js'),
  'zustand/shallow':              path.resolve(projectRoot, 'node_modules/zustand/shallow.js'),
};

// ---------------------------------------------------------------------------
// Transform ESM-only packages in node_modules through Babel so Metro's
// CommonJS output mode can handle bare `export` / `import` syntax.
// nanoid v5 and its sub-paths use ESM exports that Metro cannot parse
// without this exception.
// ---------------------------------------------------------------------------
config.transformer.transformIgnorePatterns = [
  'node_modules/(?!(nanoid|@graphite)/)',
];

module.exports = config;
