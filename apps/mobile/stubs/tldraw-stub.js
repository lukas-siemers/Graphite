// Web stub for tldraw — replaced by native Skia canvas on mobile.
// This stub prevents tldraw (and its ESM-only dependencies) from being
// bundled into the Expo mobile/web build where it is not needed.
module.exports = new Proxy(
  {},
  { get: (_t, prop) => (prop === '__esModule' ? true : () => null) }
);
