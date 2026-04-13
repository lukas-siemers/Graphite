// Web stub for @shopify/react-native-skia.
// InkOverlay.web.tsx uses Canvas2D directly and does not import Skia, but
// this stub guards against accidental transitive imports on web and keeps
// the CanvasKit WASM payload out of the web bundle.
//
// Exports mirror the Skia surface used by InkOverlay.native.tsx:
//   Canvas, Path, Skia.Path.Make() → moveTo / lineTo / close
// plus an `SkPath` type placeholder via Proxy for any other accesses.
const makePath = () => ({
  moveTo: () => {},
  lineTo: () => {},
  close: () => {},
});

module.exports = {
  __esModule: true,
  Canvas: () => null,
  Path: () => null,
  Skia: {
    Path: {
      Make: makePath,
    },
  },
};
