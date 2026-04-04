// Web stub for @shopify/react-native-skia
// The drawing canvas detects web/Expo Go and renders a fallback — these exports
// just need to exist so Metro can resolve the module without crashing.
module.exports = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === '__esModule') return true;
      // Return a no-op component for any named export
      const noop = () => null;
      noop.displayName = `SkiaStub(${String(prop)})`;
      return noop;
    },
  }
);
